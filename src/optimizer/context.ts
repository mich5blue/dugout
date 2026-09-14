import { playerName, playerShortName } from '@/domain/factories';
import { emptyFairnessDebt, emptySeasonUsage } from '@/domain/season';
import type { FairnessDebt, PlayerSeasonUsage } from '@/domain/season';
import { ABILITY_VALUE } from '@/domain/types';
import type {
  Eligibility,
  PositionDefinition,
  PositionGroup,
  TeamSettings,
  Weights,
} from '@/domain/types';
import { Rng } from './rng';
import type { OptimizationInput } from './types';

/** Tuning constants for how season debt influences a single game. */
export const DEBT_TUNING = {
  /** Fraction of outstanding debt the optimizer tries to recover in one game. */
  recoveryRate: 0.5,
  /** Never shift a player's target by more than this many innings in one game. */
  maxShiftInnings: 1.5,
  /** Extra target innings granted by a "prioritize next game" flag. */
  priorityShiftInnings: 1.0,
} as const;

export interface SolverPlayer {
  idx: number;
  id: string;
  name: string;
  shortName: string;
  /** Per inning index (0 = inning 1). */
  available: boolean[];
  availableInnings: number;
  /** Per position index. */
  eligibility: Eligibility[];
  allowedAt: boolean[];
  ability: number[];
  offensive: number;
  overall: number;
  maxPitching: number;
  maxCatching: number;
  preferredPitcher: boolean;
  preferredCatcher: boolean;
  debt: FairnessDebt;
  usage: PlayerSeasonUsage;
  /** Fair-share defensive innings for this game, after debt adjustment. */
  target: number;
  /** Fair-share defensive innings for this game ignoring season debt. */
  equalShare: number;
  /** Development-goal pull per position index. */
  goalPull: number[];
  /** Positions where a goal asks for at least one inning this game. */
  goalAtLeastOne: boolean[];
  canPlayInfield: boolean;
  /**
   * Expected share of this player's defensive innings per group, based on the
   * positions they are actually eligible for rather than the formation as a
   * whole. A player who cannot pitch, catch or play first base must take all
   * of their innings from the remaining spots, and should not be judged
   * against a split they can never achieve.
   */
  groupShare: Record<PositionGroup, number>;
  priority: {
    defensive: boolean;
    infield: boolean;
    bench: boolean;
    batting: boolean;
  };
}

export interface SolverContext {
  input: OptimizationInput;
  settings: TeamSettings;
  weights: Weights;
  rng: Rng;
  innings: number;
  positions: PositionDefinition[];
  nPos: number;
  players: SolverPlayer[];
  nPlayers: number;
  byId: Map<string, SolverPlayer>;
  groupOf: PositionGroup[];
  critical: number[];
  pitcherPositions: number[];
  catcherPositions: number[];
  infieldPositions: number[];
  outfieldPositions: number[];
  batteryPositions: number[];
  /** locked[inning][pos] = player index, or -1. Includes the pitching plan. */
  locked: number[][];
  slotsPerInning: number;
  totalSlots: number;
  /** Required minimum defensive innings, or 0 when it is only a target. */
  requiredMinInnings: number;
  requiredInfieldInnings: number;
  /**
   * Seed-derived tie-break, indexed [playerIdx][positionIdx]. Scaled far below
   * any meaningful cost difference, so it only decides between genuinely equal
   * lineups. This is what makes "Generate Another" return a different valid
   * lineup for a new seed while keeping any single seed fully reproducible.
   */
  tieBreak: number[][];
}

/**
 * Projects base targets onto the set {sum = total, lower <= x <= upper} by
 * bisecting a uniform shift. Keeps relative ordering from the debt adjustment
 * while guaranteeing the targets add up to the innings actually available.
 */
export function projectTargets(
  base: number[],
  lower: number[],
  upper: number[],
  total: number,
): number[] {
  const clampAll = (lambda: number) =>
    base.map((b, i) => Math.min(upper[i], Math.max(lower[i], b + lambda)));
  const sumOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  const minSum = sumOf(lower);
  const maxSum = sumOf(upper);
  if (total <= minSum) return lower.slice();
  if (total >= maxSum) return upper.slice();

  let lo = -Math.max(...upper) - 1;
  let hi = Math.max(...upper) + 1;
  let result = clampAll(0);
  for (let iter = 0; iter < 60; iter++) {
    const mid = (lo + hi) / 2;
    result = clampAll(mid);
    const s = sumOf(result);
    if (Math.abs(s - total) < 1e-9) break;
    if (s < total) lo = mid;
    else hi = mid;
  }
  return result;
}

export function buildContext(input: OptimizationInput): SolverContext {
  const positions = [...input.formation.positions].sort((a, b) => a.sortOrder - b.sortOrder);
  const nPos = positions.length;
  const innings = input.innings;
  const posIndexById = new Map(positions.map((p, i) => [p.id, i]));

  const gamePlayerById = new Map(input.gamePlayers.map((gp) => [gp.playerId, gp]));
  const overrideSet = new Set(
    input.eligibilityOverrides.map((o) => `${o.playerId}|${o.positionId}`),
  );

  const pitcherPositions: number[] = [];
  const catcherPositions: number[] = [];
  const infieldPositions: number[] = [];
  const outfieldPositions: number[] = [];
  const batteryPositions: number[] = [];
  const groupOf: PositionGroup[] = [];
  const critical: number[] = [];

  positions.forEach((p, i) => {
    groupOf.push(p.group);
    critical.push(p.criticalWeight);
    if (p.role === 'PITCHER') pitcherPositions.push(i);
    if (p.role === 'CATCHER') catcherPositions.push(i);
    if (p.group === 'INFIELD') infieldPositions.push(i);
    if (p.group === 'OUTFIELD') outfieldPositions.push(i);
    if (p.group === 'BATTERY') batteryPositions.push(i);
  });

  const goalsByPlayer = new Map<string, typeof input.developmentGoals>();
  for (const goal of input.developmentGoals) {
    if (!goal.active) continue;
    const list = goalsByPlayer.get(goal.playerId) ?? [];
    list.push(goal);
    goalsByPlayer.set(goal.playerId, list);
  }

  const flagsByPlayer = new Map<string, Set<string>>();
  for (const flag of input.priorityFlags) {
    const set = flagsByPlayer.get(flag.playerId) ?? new Set<string>();
    set.add(flag.kind);
    flagsByPlayer.set(flag.playerId, set);
  }

  const players: SolverPlayer[] = [];

  for (const player of input.players) {
    const gp = gamePlayerById.get(player.id);
    if (!gp || !gp.available || !player.active) continue;

    const arrival = gp.arrivalInning ?? 1;
    const departure = gp.departureInning ?? innings;
    const available: boolean[] = [];
    for (let inn = 1; inn <= innings; inn++) {
      available.push(inn >= arrival && inn <= departure);
    }
    const availableInnings = available.filter(Boolean).length;
    if (availableInnings === 0) continue;

    const eligibility: Eligibility[] = [];
    const allowedAt: boolean[] = [];
    const ability: number[] = [];

    positions.forEach((pos, posIdx) => {
      const rating = player.positionRatings[pos.id];
      const elig: Eligibility = rating?.eligibility ?? 'ALLOWED';
      eligibility.push(elig);

      const overridden = overrideSet.has(`${player.id}|${pos.id}`);
      let allowed = elig !== 'NEVER' || overridden;
      // Role gates: the coach's can-pitch / can-catch flags behave like NEVER.
      if (pos.role === 'PITCHER' && !player.canPitch && !overridden) allowed = false;
      if (pos.role === 'CATCHER' && !player.canCatch && !overridden) allowed = false;
      allowedAt.push(allowed);

      const tier = rating?.abilityTier ?? player.overallTier;
      ability.push(ABILITY_VALUE[tier]);
      void posIdx;
    });

    const settingsPitchCap = input.settings.maxPitchingInningsPerPlayer ?? Infinity;
    const settingsCatchCap = input.settings.maxCatcherInningsPerPlayer ?? Infinity;
    const maxPitching = Math.min(
      gp.maxPitchingInnings ?? Infinity,
      player.maxPitchingInnings ?? Infinity,
      settingsPitchCap,
    );
    const maxCatching = Math.min(player.maxCatchingInnings ?? Infinity, settingsCatchCap);

    const goalPull = new Array<number>(nPos).fill(0);
    const goalAtLeastOne = new Array<boolean>(nPos).fill(false);
    for (const goal of goalsByPlayer.get(player.id) ?? []) {
      const applyTo = (posIdx: number) => {
        if (goal.goalType === 'FEWER_REPS') goalPull[posIdx] -= goal.priority;
        else goalPull[posIdx] += goal.priority;
        if (goal.goalType === 'AT_LEAST_ONE_INNING') goalAtLeastOne[posIdx] = true;
      };
      if (goal.positionId) {
        const idx = posIndexById.get(goal.positionId);
        if (idx !== undefined) applyTo(idx);
      } else if (goal.positionGroup) {
        positions.forEach((pos, idx) => {
          if (pos.group === goal.positionGroup) applyTo(idx);
        });
      }
    }

    const flags = flagsByPlayer.get(player.id) ?? new Set<string>();

    players.push({
      idx: players.length,
      id: player.id,
      name: playerName(player),
      shortName: playerShortName(player),
      available,
      availableInnings,
      eligibility,
      allowedAt,
      ability,
      offensive: ABILITY_VALUE[player.offensiveTier],
      overall: ABILITY_VALUE[player.overallTier],
      maxPitching,
      maxCatching,
      preferredPitcher: player.preferredPitcher,
      preferredCatcher: player.preferredCatcher,
      debt: input.fairnessDebt[player.id] ?? emptyFairnessDebt(player.id),
      usage: input.seasonUsage[player.id] ?? emptySeasonUsage(player.id),
      target: 0,
      equalShare: 0,
      goalPull,
      goalAtLeastOne,
      canPlayInfield: infieldPositions.some((i) => allowedAt[i]),
      groupShare: groupShareFor(positions, allowedAt),
      priority: {
        defensive: flags.has('DEFENSIVE_INNINGS'),
        infield: flags.has('INFIELD'),
        bench: flags.has('BENCH'),
        batting: flags.has('BATTING'),
      },
    });
  }

  const byId = new Map(players.map((p) => [p.id, p]));

  // Locked assignments: explicit locks, the pitching plan, and frozen innings.
  const locked: number[][] = Array.from({ length: innings + 1 }, () =>
    new Array<number>(nPos).fill(-1),
  );

  const applyLock = (inning: number, positionId: string, playerId: string) => {
    if (inning < 1 || inning > innings) return;
    const posIdx = posIndexById.get(positionId);
    if (posIdx === undefined) return;
    const player = byId.get(playerId);
    if (!player) return;
    if (!player.available[inning - 1]) return;
    locked[inning][posIdx] = player.idx;
  };

  for (const lock of input.lockedAssignments) applyLock(lock.inning, lock.positionId, lock.playerId);
  for (const frozen of input.frozenAssignments) {
    if (frozen.inning <= input.frozenInnings) {
      applyLock(frozen.inning, frozen.positionId, frozen.playerId);
    }
  }
  for (const [inningKey, playerId] of Object.entries(input.pitchingPlan)) {
    const inning = Number(inningKey);
    const primaryPitcher = pitcherPositions[0];
    if (primaryPitcher === undefined) continue;
    applyLock(inning, positions[primaryPitcher].id, playerId);
  }

  const slotsPerInning = nPos;
  const totalSlots = innings * nPos;

  // ---- Fair-share targets -------------------------------------------------
  const seasonPull =
    (input.weights.seasonFairness / 100) * DEBT_TUNING.recoveryRate;

  const totalAvailability = Math.max(
    1,
    sum(players.map((q) => q.availableInnings)),
  );
  const proportional = players.map(
    (p) => totalSlots * (p.availableInnings / totalAvailability),
  );
  const base = players.map((p, i) => {
    let shift = clamp(
      p.debt.defensiveDebt * seasonPull,
      -DEBT_TUNING.maxShiftInnings,
      DEBT_TUNING.maxShiftInnings,
    );
    if (p.priority.defensive) shift += DEBT_TUNING.priorityShiftInnings;
    return proportional[i] + shift;
  });

  const minMode = input.settings.minDefensiveInningsMode;
  const minInnings = input.settings.minDefensiveInnings;
  const lower = players.map((p) => Math.min(minInnings, p.availableInnings));
  const upper = players.map((p) => p.availableInnings);
  const targets = projectTargets(base, lower, upper, totalSlots);
  const equalShares = projectTargets(proportional, lower, upper, totalSlots);
  players.forEach((p, i) => {
    p.target = targets[i];
    p.equalShare = equalShares[i];
  });

  const requiredMinInnings = minMode === 'REQUIRED' ? minInnings : 0;
  const requiredInfieldInnings =
    input.settings.infieldOpportunity.mode === 'REQUIRED'
      ? input.settings.infieldOpportunity.innings
      : 0;

  const tieBreakRng = new Rng(input.seed * 2654435761 + 17);
  const tieBreak = players.map(() =>
    Array.from({ length: nPos }, () => tieBreakRng.next()),
  );

  return {
    input,
    settings: input.settings,
    weights: input.weights,
    rng: new Rng(input.seed),
    tieBreak,
    innings,
    positions,
    nPos,
    players,
    nPlayers: players.length,
    byId,
    groupOf,
    critical,
    pitcherPositions,
    catcherPositions,
    infieldPositions,
    outfieldPositions,
    batteryPositions,
    locked,
    slotsPerInning,
    totalSlots,
    requiredMinInnings,
    requiredInfieldInnings,
  };
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function groupShareFor(
  positions: PositionDefinition[],
  allowedAt: boolean[],
): Record<PositionGroup, number> {
  const counts: Record<PositionGroup, number> = {
    BATTERY: 0,
    INFIELD: 0,
    OUTFIELD: 0,
    BENCH: 0,
  };
  let total = 0;
  positions.forEach((position, index) => {
    if (!allowedAt[index]) return;
    counts[position.group]++;
    total++;
  });
  if (total === 0) return counts;
  return {
    BATTERY: counts.BATTERY / total,
    INFIELD: counts.INFIELD / total,
    OUTFIELD: counts.OUTFIELD / total,
    BENCH: 0,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
