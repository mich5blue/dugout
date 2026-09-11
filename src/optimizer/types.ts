import type { FairnessDebt, PlayerSeasonUsage } from '@/domain/season';
import type {
  DevelopmentGoal,
  Formation,
  GamePlayer,
  Player,
  PriorityFlag,
  TeamSettings,
  Weights,
} from '@/domain/types';

export const OPTIMIZER_VERSION = 'dugout-ls-1';

export interface LockedAssignment {
  inning: number;
  positionId: string;
  playerId: string;
}

export interface OptimizationInput {
  formation: Formation;
  innings: number;
  /** Full roster; availability comes from gamePlayers. */
  players: Player[];
  gamePlayers: GamePlayer[];
  settings: TeamSettings;
  weights: Weights;
  fairnessDebt: Record<string, FairnessDebt>;
  seasonUsage: Record<string, PlayerSeasonUsage>;
  developmentGoals: DevelopmentGoal[];
  priorityFlags: PriorityFlag[];
  /** inning (1-based) -> playerId. Treated as a locked pitcher assignment. */
  pitchingPlan: Record<number, string>;
  lockedAssignments: LockedAssignment[];
  /** playerId -> batting slot the coach pinned. */
  lockedBattingSlots: Record<string, number>;
  eligibilityOverrides: Array<{ playerId: string; positionId: string }>;
  /**
   * Innings 1..frozenInnings are already played and must be reproduced exactly
   * from frozenAssignments. Used by mid-game rebalance.
   */
  frozenInnings: number;
  frozenAssignments: LockedAssignment[];
  seed: number;
  /**
   * Wall-clock safety cap in milliseconds. This is NOT the search budget —
   * search depth is bounded deterministically so that identical inputs always
   * produce an identical lineup. Lowering this can truncate the search and
   * make results machine-dependent, so leave it unset unless you need a hard
   * ceiling.
   */
  timeBudgetMs?: number;
}

export interface PlannedDefensiveAssignment {
  inning: number;
  positionId: string;
  playerId: string;
  locked: boolean;
}

export interface PlannedBattingAssignment {
  playerId: string;
  battingSlot: number;
  locked: boolean;
}

export type QualityRating = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';

export interface QualityMetric {
  key: string;
  label: string;
  /** 0..1 */
  value: number;
  rating: QualityRating;
  detail?: string;
}

export interface LineupCheck {
  ok: boolean;
  label: string;
}

export interface LineupQuality {
  metrics: QualityMetric[];
  checks: LineupCheck[];
  score: number;
}

export interface Explanation {
  playerId?: string;
  text: string;
}

export type ConflictSeverity = 'ERROR' | 'WARNING';

export interface Conflict {
  severity: ConflictSeverity;
  code: string;
  message: string;
}

export interface RelaxationSuggestion {
  /** Coach-facing sentence, e.g. "Allow Calvin at 1B". */
  message: string;
  /** Lower = smaller change to the coach's stated rules. Used for ranking. */
  impact: number;
  /** Structured hint so the UI can offer a one-tap fix later. */
  action?:
    | { type: 'ALLOW_POSITION'; playerId: string; positionId: string }
    | { type: 'REDUCE_MIN_DEFENSIVE_INNINGS'; to: number }
    | { type: 'ALLOW_CONSECUTIVE_BENCH' }
    | { type: 'RELAX_INFIELD_REQUIREMENT'; to: number }
    | { type: 'ADD_ELIGIBLE_PLAYER'; positionId: string }
    | { type: 'RAISE_PITCHING_CAP'; to: number }
    | { type: 'RAISE_CATCHING_CAP'; to: number };
}

export interface OptimizationResult {
  ok: boolean;
  defensive: PlannedDefensiveAssignment[];
  /** inning -> playerIds sitting that inning. Derived, provided for convenience. */
  bench: Record<number, string[]>;
  batting: PlannedBattingAssignment[];
  quality: LineupQuality;
  explanations: Explanation[];
  conflicts: Conflict[];
  relaxations: RelaxationSuggestion[];
  seed: number;
  optimizerVersion: string;
  elapsedMs: number;
  iterations: number;
}

/**
 * The application only ever talks to this interface, so the solver behind it
 * (local search today, CP-SAT later) can be replaced without touching callers.
 */
export interface LineupOptimizer {
  generate(input: OptimizationInput): Promise<OptimizationResult>;
}
