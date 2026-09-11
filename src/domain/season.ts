import type { PositionGroup } from './types';

/**
 * Season aggregation types.
 *
 * Per-position season totals are keyed by position CODE rather than position id.
 * Ids are stable *within* a formation, but a team that switches from a
 * 10-player formation to a 9-player one would otherwise fragment its history.
 * Codes are the practical denominator for individual positions, and
 * PositionGroup is the guaranteed denominator (LC and CF both roll up to
 * OUTFIELD).
 */

export interface PlayerSeasonUsage {
  playerId: string;
  /** Games the player was available for at least one played inning. */
  games: number;
  defensiveInnings: number;
  benchInnings: number;
  /** Innings the player was available, across counted innings. */
  availableInnings: number;
  byGroup: Record<PositionGroup, number>;
  byPositionCode: Record<string, number>;
  uniquePositionCodes: number;
  pitchingInnings: number;
  catchingInnings: number;
  /** Games where the player sat the first inning, used to rotate who sits first. */
  firstInningBenchGames: number;
  /** One entry per game the player batted in, oldest first. */
  battingHistory: Array<{ gameId: string; slot: number; orderSize: number }>;
}

export interface BattingSlotStats {
  averageSlot: number | null;
  timesFirst: number;
  timesLast: number;
  timesTopThird: number;
  timesMiddleThird: number;
  timesBottomThird: number;
  /** Most recent streak of games batting in the bottom third. */
  consecutiveGamesBottomThird: number;
}

/**
 * Expected vs actual, per player. "Expected" is the player's fair share given
 * the opportunities they were actually present for, so absences and short games
 * do not create phantom debt.
 *
 * Sign convention: positive debt means "owed more of this".
 */
export interface FairnessDebt {
  playerId: string;

  expectedDefensiveInnings: number;
  actualDefensiveInnings: number;
  defensiveDebt: number;

  expectedBenchInnings: number;
  actualBenchInnings: number;
  /** Positive = has sat MORE than expected (so is owed less bench). */
  benchDebt: number;

  expectedInfieldInnings: number;
  actualInfieldInnings: number;
  infieldDebt: number;

  expectedOutfieldInnings: number;
  actualOutfieldInnings: number;
  outfieldDebt: number;

  expectedBatteryInnings: number;
  actualBatteryInnings: number;
  batteryDebt: number;

  /** By position code. Positive = owed more innings there. */
  positionDebt: Record<string, number>;

  expectedAverageBattingSlot: number | null;
  actualAverageBattingSlot: number | null;
  /** Positive = has batted LOWER in the order than expected. */
  battingDebt: number;
}

export function emptyFairnessDebt(playerId: string): FairnessDebt {
  return {
    playerId,
    expectedDefensiveInnings: 0,
    actualDefensiveInnings: 0,
    defensiveDebt: 0,
    expectedBenchInnings: 0,
    actualBenchInnings: 0,
    benchDebt: 0,
    expectedInfieldInnings: 0,
    actualInfieldInnings: 0,
    infieldDebt: 0,
    expectedOutfieldInnings: 0,
    actualOutfieldInnings: 0,
    outfieldDebt: 0,
    expectedBatteryInnings: 0,
    actualBatteryInnings: 0,
    batteryDebt: 0,
    positionDebt: {},
    expectedAverageBattingSlot: null,
    actualAverageBattingSlot: null,
    battingDebt: 0,
  };
}

export function emptySeasonUsage(playerId: string): PlayerSeasonUsage {
  return {
    playerId,
    games: 0,
    defensiveInnings: 0,
    benchInnings: 0,
    availableInnings: 0,
    byGroup: { BATTERY: 0, INFIELD: 0, OUTFIELD: 0, BENCH: 0 },
    byPositionCode: {},
    uniquePositionCodes: 0,
    pitchingInnings: 0,
    catchingInnings: 0,
    firstInningBenchGames: 0,
    battingHistory: [],
  };
}

export type AlertKind =
  | 'LOW_DEFENSIVE_INNINGS'
  | 'LOW_INFIELD_INNINGS'
  | 'HIGH_BENCH_INNINGS'
  | 'POSITION_CONCENTRATION'
  | 'BATTING_BOTTOM_STREAK';

export interface FairnessAlert {
  id: string;
  playerId: string;
  kind: AlertKind;
  message: string;
  /** Bigger = more imbalanced. Used for ordering. */
  magnitude: number;
  priorityKind: 'DEFENSIVE_INNINGS' | 'INFIELD' | 'BENCH' | 'BATTING';
}

export interface TeamSeasonFairness {
  averageDefensiveInnings: number;
  averageBenchInnings: number;
  averageInfieldInnings: number;
  averageOutfieldInnings: number;
  /** 0..1, where 1 means perfectly balanced defensive innings vs expectation. */
  balanceScore: number;
  alerts: FairnessAlert[];
}
