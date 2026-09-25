import { playerName } from '@/domain/factories';
import {
  emptyFairnessDebt,
  type FairnessAlert,
  type FairnessDebt,
  type TeamSeasonFairness,
} from '@/domain/season';
import type { Game, Player } from '@/domain/types';
import {
  countedInnings,
  effectiveAssignments,
  gameAvailability,
  getPlayerSeasonUsage,
  isCountedGame,
} from './seasonStatistics';

/**
 * Fairness debt.
 *
 * "Expected" is a player's fair share of the opportunities they were actually
 * present for: for each game, each available player's expectation is
 * proportional to the innings they were available. That way a missed game, a
 * late arrival, or a game called after five innings never creates phantom debt.
 *
 * Sign convention throughout: positive debt means "owed more of this".
 */

/** Relative batting slot: 0 = leadoff, 1 = last. The season-wide mean is 0.5. */
const EXPECTED_RELATIVE_SLOT = 0.5;

export function getFairnessDebt(
  games: Game[],
  players: Player[],
): Record<string, FairnessDebt> {
  const debts: Record<string, FairnessDebt> = {};
  for (const player of players) debts[player.id] = emptyFairnessDebt(player.id);

  const ensure = (playerId: string): FairnessDebt => {
    debts[playerId] ??= emptyFairnessDebt(playerId);
    return debts[playerId];
  };

  const relativeSlotSums: Record<string, { sum: number; games: number }> = {};
  const absoluteSlotSums: Record<string, { sum: number; expected: number; games: number }> = {};

  for (const game of games.filter(isCountedGame)) {
    const limit = countedInnings(game);
    if (limit <= 0) continue;

    const positions = game.formationSnapshot.positions;
    const positionsById = new Map(positions.map((p) => [p.id, p]));
    const infieldSlots = positions.filter((p) => p.group === 'INFIELD').length;
    const outfieldSlots = positions.filter((p) => p.group === 'OUTFIELD').length;
    const batterySlots = positions.filter((p) => p.group === 'BATTERY').length;

    const codeSlots = new Map<string, number>();
    for (const position of positions) {
      codeSlots.set(position.code, (codeSlots.get(position.code) ?? 0) + 1);
    }

    const availability = gameAvailability(game);
    const totalAvailability = availability.reduce((acc, entry) => acc + entry.innings, 0);
    if (totalAvailability === 0) continue;

    // ---- Expectations ----------------------------------------------------
    for (const entry of availability) {
      const share = entry.innings / totalAvailability;
      const debt = ensure(entry.playerId);
      debt.expectedDefensiveInnings += positions.length * limit * share;
      debt.expectedInfieldInnings += infieldSlots * limit * share;
      debt.expectedOutfieldInnings += outfieldSlots * limit * share;
      debt.expectedBatteryInnings += batterySlots * limit * share;
      debt.expectedBenchInnings +=
        entry.innings - positions.length * limit * share;
      for (const [code, count] of codeSlots) {
        debt.positionDebt[code] = (debt.positionDebt[code] ?? 0) + count * limit * share;
      }
    }

    // ---- Actuals ---------------------------------------------------------
    const playedInnings = new Map<string, number>();
    for (const assignment of effectiveAssignments(game)) {
      const position = positionsById.get(assignment.positionId);
      if (!position) continue;
      const debt = ensure(assignment.playerId);
      debt.actualDefensiveInnings++;
      if (position.group === 'INFIELD') debt.actualInfieldInnings++;
      if (position.group === 'OUTFIELD') debt.actualOutfieldInnings++;
      if (position.group === 'BATTERY') debt.actualBatteryInnings++;
      debt.positionDebt[position.code] = (debt.positionDebt[position.code] ?? 0) - 1;
      playedInnings.set(assignment.playerId, (playedInnings.get(assignment.playerId) ?? 0) + 1);
    }

    for (const entry of availability) {
      const debt = ensure(entry.playerId);
      debt.actualBenchInnings += entry.innings - (playedInnings.get(entry.playerId) ?? 0);
    }

    // ---- Batting ---------------------------------------------------------
    const orderSize = game.battingAssignments.length;
    for (const batting of game.battingAssignments) {
      if (!availability.some((entry) => entry.playerId === batting.playerId)) continue;
      const rel =
        orderSize <= 1 ? EXPECTED_RELATIVE_SLOT : (batting.battingSlot - 1) / (orderSize - 1);
      relativeSlotSums[batting.playerId] ??= { sum: 0, games: 0 };
      relativeSlotSums[batting.playerId].sum += rel;
      relativeSlotSums[batting.playerId].games += 1;

      absoluteSlotSums[batting.playerId] ??= { sum: 0, expected: 0, games: 0 };
      absoluteSlotSums[batting.playerId].sum += batting.battingSlot;
      absoluteSlotSums[batting.playerId].expected += (orderSize + 1) / 2;
      absoluteSlotSums[batting.playerId].games += 1;
    }
  }

  for (const debt of Object.values(debts)) {
    debt.defensiveDebt = debt.expectedDefensiveInnings - debt.actualDefensiveInnings;
    debt.infieldDebt = debt.expectedInfieldInnings - debt.actualInfieldInnings;
    debt.outfieldDebt = debt.expectedOutfieldInnings - debt.actualOutfieldInnings;
    debt.batteryDebt = debt.expectedBatteryInnings - debt.actualBatteryInnings;
    // Bench: positive means they have sat MORE than expected.
    debt.benchDebt = debt.actualBenchInnings - debt.expectedBenchInnings;

    const relative = relativeSlotSums[debt.playerId];
    const absolute = absoluteSlotSums[debt.playerId];
    if (relative && relative.games > 0) {
      const actualRelative = relative.sum / relative.games;
      debt.battingDebt = actualRelative - EXPECTED_RELATIVE_SLOT;
    }
    if (absolute && absolute.games > 0) {
      debt.actualAverageBattingSlot = absolute.sum / absolute.games;
      debt.expectedAverageBattingSlot = absolute.expected / absolute.games;
    }
  }

  return debts;
}

/** Alert thresholds, in innings unless noted. */
const ALERT_THRESHOLD = {
  defensiveInnings: 3,
  infieldInnings: 3,
  benchInnings: 2,
  /** Share of a player's defensive innings spent at one position. */
  positionConcentration: 0.4,
  bottomThirdGames: 3,
} as const;

export function getTeamSeasonFairness(
  games: Game[],
  players: Player[],
): TeamSeasonFairness {
  const usage = getPlayerSeasonUsage(games);
  const debts = getFairnessDebt(games, players);
  const activePlayers = players.filter((p) => p.active);
  const n = Math.max(1, activePlayers.length);

  const totals = activePlayers.reduce(
    (acc, player) => {
      const record = usage[player.id];
      if (!record) return acc;
      acc.defensive += record.defensiveInnings;
      acc.bench += record.benchInnings;
      acc.infield += record.byGroup.INFIELD;
      acc.outfield += record.byGroup.OUTFIELD;
      return acc;
    },
    { defensive: 0, bench: 0, infield: 0, outfield: 0 },
  );

  const averageDefensiveInnings = totals.defensive / n;
  const alerts: FairnessAlert[] = [];

  for (const player of activePlayers) {
    const record = usage[player.id];
    const debt = debts[player.id];
    if (!record || !debt || record.games === 0) continue;
    const name = playerName(player);

    if (debt.defensiveDebt >= ALERT_THRESHOLD.defensiveInnings) {
      alerts.push({
        id: `${player.id}:defense`,
        playerId: player.id,
        kind: 'LOW_DEFENSIVE_INNINGS',
        magnitude: debt.defensiveDebt,
        message: `${name} has played ${debt.defensiveDebt.toFixed(0)} fewer defensive innings than expected.`,
        priorityKind: 'DEFENSIVE_INNINGS',
      });
    }

    if (debt.infieldDebt >= ALERT_THRESHOLD.infieldInnings) {
      alerts.push({
        id: `${player.id}:infield`,
        playerId: player.id,
        kind: 'LOW_INFIELD_INNINGS',
        magnitude: debt.infieldDebt,
        message: `${name} has ${debt.infieldDebt.toFixed(0)} fewer infield innings than the team average.`,
        priorityKind: 'INFIELD',
      });
    }

    if (debt.benchDebt >= ALERT_THRESHOLD.benchInnings) {
      alerts.push({
        id: `${player.id}:bench`,
        playerId: player.id,
        kind: 'HIGH_BENCH_INNINGS',
        magnitude: debt.benchDebt,
        message: `${name} has sat ${debt.benchDebt.toFixed(0)} more innings than expected.`,
        priorityKind: 'BENCH',
      });
    }

    if (record.defensiveInnings >= 6) {
      for (const [code, count] of Object.entries(record.byPositionCode)) {
        const share = count / record.defensiveInnings;
        if (share >= ALERT_THRESHOLD.positionConcentration) {
          alerts.push({
            id: `${player.id}:concentration:${code}`,
            playerId: player.id,
            kind: 'POSITION_CONCENTRATION',
            magnitude: share * 10,
            message: `${name} has played ${code} in ${Math.round(share * 100)}% of defensive innings.`,
            priorityKind: 'DEFENSIVE_INNINGS',
          });
        }
      }
    }

    const streak = consecutiveBottomThirdGames(record.battingHistory);
    if (streak >= ALERT_THRESHOLD.bottomThirdGames) {
      alerts.push({
        id: `${player.id}:batting`,
        playerId: player.id,
        kind: 'BATTING_BOTTOM_STREAK',
        magnitude: streak,
        message: `${name} has batted in the bottom third ${streak} games in a row.`,
        priorityKind: 'BATTING',
      });
    }
  }

  // Balance score: 1 when nobody carries defensive debt.
  const meanAbsDebt =
    activePlayers.reduce((acc, p) => acc + Math.abs(debts[p.id]?.defensiveDebt ?? 0), 0) / n;
  const balanceScore = Math.max(0, Math.min(1, 1 - meanAbsDebt / 4));

  alerts.sort((a, b) => b.magnitude - a.magnitude || a.id.localeCompare(b.id));

  return {
    averageDefensiveInnings,
    averageBenchInnings: totals.bench / n,
    averageInfieldInnings: totals.infield / n,
    averageOutfieldInnings: totals.outfield / n,
    balanceScore,
    alerts,
  };
}

function consecutiveBottomThirdGames(
  history: Array<{ slot: number; orderSize: number }>,
): number {
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    const rel = entry.orderSize <= 1 ? 0 : (entry.slot - 1) / (entry.orderSize - 1);
    if (rel >= 2 / 3) streak++;
    else break;
  }
  return streak;
}

export interface DevelopmentProgress {
  playerId: string;
  goalId: string;
  label: string;
  inningsSinceGoal: number;
}

export function getPlayerDevelopmentProgress(
  games: Game[],
  goals: Array<{ id: string; playerId: string; positionId: string | null; positionGroup: string | null }>,
): DevelopmentProgress[] {
  const usage = getPlayerSeasonUsage(games);
  const codeByPositionId = new Map<string, string>();
  for (const game of games) {
    for (const position of game.formationSnapshot.positions) {
      codeByPositionId.set(position.id, position.code);
    }
  }

  return goals.map((goal) => {
    const record = usage[goal.playerId];
    let innings = 0;
    let label = 'position';
    if (goal.positionId) {
      const code = codeByPositionId.get(goal.positionId);
      label = code ?? 'position';
      innings = code ? (record?.byPositionCode[code] ?? 0) : 0;
    } else if (goal.positionGroup) {
      label = goal.positionGroup.toLowerCase();
      innings =
        record?.byGroup[goal.positionGroup as keyof typeof record.byGroup] ?? 0;
    }
    return {
      playerId: goal.playerId,
      goalId: goal.id,
      label,
      inningsSinceGoal: innings,
    };
  });
}

/**
 * Where a player stands, in the three words a coach would use.
 *
 * The product already computes `defensiveDebt` — expected minus actual innings,
 * attendance-weighted. That number is correct and nobody wants to read it. A
 * coach wants to know who they owe, and "0.7" is not an answer to that.
 *
 * One inning is the threshold, not half of one, because the inning is the atom
 * of the whole fairness model: a coach cannot hand out 0.6 of an inning, so
 * anybody inside a full inning of their expectation is already as square as
 * the game allows and should read as On target rather than as a problem.
 */
export type FairnessStanding = 'OWED' | 'ON_TARGET' | 'AHEAD';

export const STANDING_LABEL: Record<FairnessStanding, string> = {
  OWED: 'Owed',
  ON_TARGET: 'On target',
  AHEAD: 'Ahead',
};

/** The inning of slack either side of the expectation that reads as square. */
export const STANDING_THRESHOLD = 1;

export function standingFor(defensiveDebt: number): FairnessStanding {
  if (defensiveDebt >= STANDING_THRESHOLD) return 'OWED';
  if (defensiveDebt <= -STANDING_THRESHOLD) return 'AHEAD';
  return 'ON_TARGET';
}

export interface StandingCounts {
  OWED: number;
  ON_TARGET: number;
  AHEAD: number;
  /** Active players who have not appeared in a counted game yet. */
  unplayed: number;
}

/**
 * The Home snapshot: three numbers instead of a percentage.
 *
 * Players with no counted innings are held out rather than filed under On
 * target. A roster that has not played yet would otherwise report everybody as
 * square, which is true arithmetically and misleading on the page.
 */
export function standingCounts(
  players: Player[],
  debts: Record<string, FairnessDebt>,
): StandingCounts {
  const counts: StandingCounts = { OWED: 0, ON_TARGET: 0, AHEAD: 0, unplayed: 0 };

  for (const player of players) {
    if (!player.active) continue;
    const debt = debts[player.id];
    if (!debt || debt.expectedDefensiveInnings <= 0) {
      counts.unplayed++;
      continue;
    }
    counts[standingFor(debt.defensiveDebt)]++;
  }

  return counts;
}
