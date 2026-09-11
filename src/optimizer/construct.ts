import type { PositionGroup } from '@/domain/types';
import { clamp, type SolverContext } from './context';
import { minCostAssignment } from './hungarian';
import { effectiveRules, TUNING, type EffectiveRules } from './objective';
import type { Rng } from './rng';
import { createEmptySolution, EMPTY, type Solution } from './solution';

/**
 * Construction phase: walk the innings in order, solving each inning as an
 * exact minimum-cost assignment of positions to players. Costs are derived
 * from the same coach weights the full-game objective uses, plus the running
 * state (who is behind on innings, who just sat, who has already played here).
 *
 * This produces a strong feasible starting point; localsearch.ts then improves
 * it against the true full-game objective.
 */

/** Applied when a player must play this inning to keep a hard rule satisfiable. */
const MUST_PLAY_BONUS = 100_000;

const NO_SLOT = -2;

interface RunningState {
  defensive: number[];
  bench: number[];
  benchRun: number[];
  pitching: number[];
  catching: number[];
  catcherRun: number[];
  lastSlot: number[];
  /** How many consecutive innings the player has held lastSlot. */
  sameSlotRun: number[];
  posCount: number[][];
  groupCount: Array<Record<PositionGroup, number>>;
}

function initialState(ctx: SolverContext): RunningState {
  return {
    defensive: new Array(ctx.nPlayers).fill(0),
    bench: new Array(ctx.nPlayers).fill(0),
    benchRun: new Array(ctx.nPlayers).fill(0),
    pitching: new Array(ctx.nPlayers).fill(0),
    catching: new Array(ctx.nPlayers).fill(0),
    catcherRun: new Array(ctx.nPlayers).fill(0),
    lastSlot: new Array(ctx.nPlayers).fill(NO_SLOT),
    sameSlotRun: new Array(ctx.nPlayers).fill(0),
    posCount: ctx.players.map(() => new Array(ctx.nPos).fill(0)),
    groupCount: ctx.players.map(() => ({
      BATTERY: 0,
      INFIELD: 0,
      OUTFIELD: 0,
      BENCH: 0,
    })),
  };
}

/** Innings from `inning` onward (inclusive) that the player is available. */
function remainingAvailability(ctx: SolverContext, playerIdx: number, inning: number): number {
  let count = 0;
  for (let i = inning; i <= ctx.innings; i++) {
    if (ctx.players[playerIdx].available[i - 1]) count++;
  }
  return count;
}

export function construct(
  ctx: SolverContext,
  rng: Rng,
  jitter = 0,
  rules: EffectiveRules = effectiveRules(ctx),
): Solution | null {
  const solution = createEmptySolution(ctx);
  const state = initialState(ctx);
  const w = ctx.weights;
  const infieldShare = ctx.infieldPositions.length / ctx.nPos;
  const outfieldShare = ctx.outfieldPositions.length / ctx.nPos;
  const isPitcher = new Set(ctx.pitcherPositions);
  const isCatcher = new Set(ctx.catcherPositions);

  for (let inning = 1; inning <= ctx.innings; inning++) {
    const availableIdx = ctx.players
      .filter((p) => p.available[inning - 1])
      .map((p) => p.idx);

    // Locked cells are placed first and removed from the matching problem.
    const openPositions: number[] = [];
    const taken = new Set<number>();
    for (let pos = 0; pos < ctx.nPos; pos++) {
      const lockedPlayer = ctx.locked[inning][pos];
      if (lockedPlayer >= 0 && !taken.has(lockedPlayer)) {
        solution.grid[inning][pos] = lockedPlayer;
        taken.add(lockedPlayer);
      } else {
        openPositions.push(pos);
      }
    }

    const candidates = availableIdx.filter((idx) => !taken.has(idx));
    if (candidates.length < openPositions.length) return null;

    const matrix: number[][] = openPositions.map((pos) =>
      candidates.map((playerIdx) =>
        cellCost(ctx, state, rules, inning, pos, playerIdx, {
          infieldShare,
          outfieldShare,
          isPitcher,
          isCatcher,
          jitter,
          rng,
          w,
        }),
      ),
    );

    const result = minCostAssignment(matrix);
    if (!result) return null;

    result.cols.forEach((col, row) => {
      solution.grid[inning][openPositions[row]] = candidates[col];
    });

    applyInning(ctx, state, solution, inning, availableIdx, isPitcher, isCatcher);
  }

  return solution;
}

interface CellContext {
  infieldShare: number;
  outfieldShare: number;
  isPitcher: Set<number>;
  isCatcher: Set<number>;
  jitter: number;
  rng: Rng;
  w: SolverContext['weights'];
}

function cellCost(
  ctx: SolverContext,
  state: RunningState,
  rules: EffectiveRules,
  inning: number,
  pos: number,
  playerIdx: number,
  cell: CellContext,
): number {
  const player = ctx.players[playerIdx];
  if (!player.allowedAt[pos]) return Number.POSITIVE_INFINITY;

  const { w } = cell;
  const position = ctx.positions[pos];
  const group = position.group;

  // ---- Hard gates --------------------------------------------------------
  if (cell.isPitcher.has(pos) && state.pitching[playerIdx] >= player.maxPitching) {
    return Number.POSITIVE_INFINITY;
  }
  if (cell.isCatcher.has(pos)) {
    if (state.catching[playerIdx] >= player.maxCatching) return Number.POSITIVE_INFINITY;
    const maxRun = ctx.settings.maxConsecutiveCatcherInnings;
    if (maxRun !== undefined && state.catcherRun[playerIdx] >= maxRun) {
      return Number.POSITIVE_INFINITY;
    }
  }
  if (ctx.settings.restrictPitcherCatcherTransition) {
    const last = state.lastSlot[playerIdx];
    if (last >= 0) {
      if (cell.isCatcher.has(pos) && cell.isPitcher.has(last)) return Number.POSITIVE_INFINITY;
      if (cell.isPitcher.has(pos) && cell.isCatcher.has(last)) return Number.POSITIVE_INFINITY;
    }
  }

  let c = 0;
  const remaining = remainingAvailability(ctx, playerIdx, inning);

  // ---- Must-play conditions ----------------------------------------------
  if (rules.maxBenchInnings !== Number.POSITIVE_INFINITY) {
    const benchLeft = rules.maxBenchInnings - state.bench[playerIdx];
    if (benchLeft <= 0) c -= MUST_PLAY_BONUS;
  }
  if (rules.requiredMinDefensive > 0) {
    const required = Math.min(rules.requiredMinDefensive, player.availableInnings);
    const stillNeeded = required - state.defensive[playerIdx];
    if (stillNeeded > 0 && stillNeeded >= remaining) c -= MUST_PLAY_BONUS;
  }
  if (rules.infieldRequired && player.canPlayInfield && group === 'INFIELD') {
    const required = Math.min(rules.infieldInnings, player.availableInnings);
    const stillNeeded = required - state.groupCount[playerIdx].INFIELD;
    if (stillNeeded > 0 && stillNeeded >= remaining) c -= MUST_PLAY_BONUS;
  }

  // ---- Playing time and season fairness ----------------------------------
  const deficit = player.target - state.defensive[playerIdx];
  const urgency = deficit / Math.max(1, remaining);
  c -= (w.playingTimeEquality + w.seasonFairness) * 0.5 * urgency;

  // Someone who just sat should generally play now.
  if (state.benchRun[playerIdx] > 0) {
    c -= w.consecutiveBenchPenalty * 0.5 * state.benchRun[playerIdx];
  }
  // Rotate who sits in the first inning across the season.
  if (inning === 1) {
    c -= w.consecutiveBenchPenalty * TUNING.firstInningBenchScale * player.usage.firstInningBenchGames;
  }

  // ---- Continuity and variety --------------------------------------------
  const holdingThisSpot = state.lastSlot[playerIdx] === pos;
  const runSoFar = holdingThisSpot ? state.sameSlotRun[playerIdx] : 0;

  if (rules.continuityInnings > 1) {
    // Mid-block: strongly prefer leaving the player where they are. Block
    // complete: stop rewarding it so the rotation actually happens.
    if (holdingThisSpot && runSoFar < rules.continuityInnings) {
      c -= w.positionContinuity;
    } else if (holdingThisSpot) {
      c += w.positionContinuity * 0.5;
    }
  } else {
    c += w.repeatedPositionPenalty * 0.6 * state.posCount[playerIdx][pos];
    if (holdingThisSpot) c += w.repeatedPositionPenalty * 0.6;
    if (state.posCount[playerIdx][pos] === 0) c -= w.positionVariety * 0.3;
  }

  // ---- Position group balance -------------------------------------------
  // Shares come from the positions this player is eligible for, so restricted
  // players are not penalised for a split they cannot achieve.
  const share = group === 'BENCH' ? 0 : player.groupShare[group];
  if (share > 0) {
    const expected = state.defensive[playerIdx] * share;
    c += w.positionGroupBalance * 0.3 * (state.groupCount[playerIdx][group] - expected);
  }

  // ---- Infield opportunity ----------------------------------------------
  if (group === 'INFIELD') {
    const stillWanted = Math.max(
      0,
      rules.infieldInnings - state.groupCount[playerIdx].INFIELD,
    );
    c -= w.infieldOpportunity * 0.5 * stillWanted;
    const debtPull = clamp(
      player.debt.infieldDebt,
      -TUNING.maxGroupDebtPull,
      TUNING.maxGroupDebtPull,
    );
    c -= w.seasonFairness * 0.15 * debtPull;
    if (player.priority.infield) c -= w.infieldOpportunity * 0.5;
  }
  if (group === 'OUTFIELD') {
    if (state.groupCount[playerIdx].OUTFIELD >= rules.maxOutfieldInnings) {
      c += w.excessiveOutfieldPenalty * 4;
    }
    if (state.groupCount[playerIdx].OUTFIELD < rules.minOutfieldInnings) {
      c -= w.excessiveOutfieldPenalty * 0.5;
    }
  }

  // ---- Preferences, ability, development ---------------------------------
  const elig = player.eligibility[pos];
  if (elig === 'PREFERRED') c -= w.playerPreferences;
  if (elig === 'AVOID') c += w.avoidPositionPenalty * 2;
  if (position.role === 'PITCHER' && player.preferredPitcher) {
    c -= w.playerPreferences * TUNING.preferredBatteryBonus;
  }
  if (position.role === 'CATCHER' && player.preferredCatcher) {
    c -= w.playerPreferences * TUNING.preferredBatteryBonus;
  }

  c -= w.criticalPositionStrength * ctx.critical[pos] * (player.ability[pos] - 2);
  c -= w.developmentGoals * 0.5 * player.goalPull[pos];
  if (player.goalAtLeastOne[pos] && state.posCount[playerIdx][pos] === 0) {
    c -= w.developmentGoals;
  }

  const posDebt = clamp(
    player.debt.positionDebt[position.code] ?? 0,
    -TUNING.maxPositionDebtPull,
    TUNING.maxPositionDebtPull,
  );
  c -= w.seasonFairness * 0.2 * posDebt;

  if (cell.jitter > 0) c += cell.jitter * cell.rng.next();

  return c;
}

function applyInning(
  ctx: SolverContext,
  state: RunningState,
  solution: Solution,
  inning: number,
  availableIdx: number[],
  isPitcher: Set<number>,
  isCatcher: Set<number>,
): void {
  const slotOf = new Array<number>(ctx.nPlayers).fill(EMPTY);
  for (let pos = 0; pos < ctx.nPos; pos++) {
    const playerIdx = solution.grid[inning][pos];
    if (playerIdx !== EMPTY) slotOf[playerIdx] = pos;
  }

  for (const playerIdx of availableIdx) {
    const pos = slotOf[playerIdx];
    if (pos === EMPTY) {
      state.bench[playerIdx]++;
      state.benchRun[playerIdx]++;
      state.groupCount[playerIdx].BENCH++;
      state.catcherRun[playerIdx] = 0;
      state.lastSlot[playerIdx] = EMPTY;
      state.sameSlotRun[playerIdx] = 0;
      continue;
    }
    state.defensive[playerIdx]++;
    state.benchRun[playerIdx] = 0;
    state.sameSlotRun[playerIdx] =
      state.lastSlot[playerIdx] === pos ? state.sameSlotRun[playerIdx] + 1 : 1;
    state.posCount[playerIdx][pos]++;
    state.groupCount[playerIdx][ctx.groupOf[pos]]++;
    if (isPitcher.has(pos)) state.pitching[playerIdx]++;
    if (isCatcher.has(pos)) {
      state.catching[playerIdx]++;
      state.catcherRun[playerIdx]++;
    } else {
      state.catcherRun[playerIdx] = 0;
    }
    state.lastSlot[playerIdx] = pos;
  }

  // Players unavailable this inning keep their streaks reset.
  for (let idx = 0; idx < ctx.nPlayers; idx++) {
    if (!ctx.players[idx].available[inning - 1]) {
      state.benchRun[idx] = 0;
      state.catcherRun[idx] = 0;
      state.lastSlot[idx] = NO_SLOT;
      state.sameSlotRun[idx] = 0;
    }
  }
}
