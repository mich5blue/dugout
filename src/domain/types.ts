/**
 * Dugout core domain types.
 *
 * Design rules enforced here:
 *  - NEVER assume nine defensive players. A game's defense is defined by a Formation.
 *  - Positions are identified by stable ids, never by display labels.
 *  - Every position belongs to a PositionGroup so that season statistics survive
 *    formation changes (LC and CF both aggregate to OUTFIELD).
 */

export type Sport = 'BASEBALL' | 'SOFTBALL';

export type PositionGroup = 'BATTERY' | 'INFIELD' | 'OUTFIELD' | 'BENCH';

/** Sentinel position id used for bench assignments in stats/history. */
export const BENCH_POSITION_ID = 'BENCH';

/**
 * Special handling a position needs, declared by the formation rather than
 * inferred from its code. This keeps the optimizer sport-neutral: it applies
 * pitching/catching rules to whichever position carries the role.
 */
export type PositionRole = 'PITCHER' | 'CATCHER';

export interface PositionDefinition {
  id: string;
  code: string;
  displayName: string;
  group: PositionGroup;
  role?: PositionRole;
  sortOrder: number;
  /** How much stronger players matter here. 0.25 low, 0.5 normal, 1.0 high. */
  criticalWeight: number;
  /** Optional diamond-view coordinates, 0..100 in both axes. */
  diagramX?: number;
  diagramY?: number;
}

export interface Formation {
  id: string;
  /** null for system presets; set for team-owned custom formations. */
  teamId: string | null;
  sport: Sport;
  name: string;
  isSystemPreset: boolean;
  positions: PositionDefinition[];
}

export type Eligibility = 'NEVER' | 'AVOID' | 'ALLOWED' | 'PREFERRED';

export type AbilityTier = 'DEVELOPING' | 'REGULAR' | 'CORE';

export const ABILITY_VALUE: Record<AbilityTier, number> = {
  DEVELOPING: 1,
  REGULAR: 2,
  CORE: 3,
};

export interface PlayerPositionRating {
  positionId: string;
  eligibility: Eligibility;
  /** Position-specific ability, overrides the player-wide tier when present. */
  abilityTier?: AbilityTier | null;
}

export interface Player {
  id: string;
  teamId: string;
  firstName: string;
  lastName: string;
  jerseyNumber?: string;
  active: boolean;
  overallTier: AbilityTier;
  offensiveTier: AbilityTier;
  /** Keyed by positionId. Missing entries default to ALLOWED. */
  positionRatings: Record<string, PlayerPositionRating>;
  canPitch: boolean;
  canCatch: boolean;
  preferredPitcher: boolean;
  preferredCatcher: boolean;
  /** Per-game caps; undefined means "no player-specific cap". */
  maxPitchingInnings?: number;
  maxCatchingInnings?: number;
  createdAt: string;
}

export type BattingFormat = 'CONTINUOUS' | 'STARTERS_SUBS';

export type Philosophy =
  | 'EQUAL_PLAYING_TIME'
  | 'DEVELOPMENT'
  | 'BALANCED'
  | 'COMPETITIVE'
  | 'CUSTOM';

export type PlayingTimeBalance = 'EQUAL' | 'MOSTLY_EQUAL' | 'COMPETITIVE';

export type VarietyLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type CriticalStrength = 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';

export type BattingPhilosophy = 'ROTATE_FAIRLY' | 'BALANCED' | 'COMPETITIVE' | 'MANUAL';

/** Soft "target" vs hard "required" for minimum-innings style rules. */
export type RuleMode = 'TARGET' | 'REQUIRED';

export type InfieldOpportunity =
  | { mode: 'OFF' }
  | { mode: 'TARGET' | 'REQUIRED'; innings: number };

export interface RuleSettings {
  /** Minimum defensive innings per player. 0 = no minimum. */
  minDefensiveInnings: number;
  minDefensiveInningsMode: RuleMode;

  playingTimeBalance: PlayingTimeBalance;

  /** Bench rules. */
  equalizeBench: boolean;
  noConsecutiveBench: boolean;
  maxBenchInnings?: number;

  /** Variety. */
  variety: VarietyLevel;
  minUniquePositions?: number;
  maxInningsSamePosition?: number;
  maxConsecutiveSamePosition?: number;

  /** Position-group rules. */
  infieldOpportunity: InfieldOpportunity;
  maxOutfieldInnings?: number;
  minOutfieldInnings?: number;
  maxConsecutiveOutfieldInnings?: number;

  /** Competitive dial. */
  criticalStrength: CriticalStrength;

  /** Battery rules. */
  maxCatcherInningsPerPlayer?: number;
  maxConsecutiveCatcherInnings?: number;
  maxPitchingInningsPerPlayer?: number;
  /** Disallow a player catching the inning immediately after pitching (and vice versa). */
  restrictPitcherCatcherTransition: boolean;

  battingPhilosophy: BattingPhilosophy;
}

export interface TeamSettings extends RuleSettings {
  philosophy: Philosophy;
  battingFormat: BattingFormat;
  /** Custom weight overrides, applied on top of the philosophy preset. */
  weightOverrides?: Partial<Record<WeightKey, number>>;
}

export interface Team {
  id: string;
  name: string;
  sport: Sport;
  seasonName: string;
  division: string;
  defaultInnings: number;
  defaultFormationId: string;
  settings: TeamSettings;
  createdAt: string;
}

export type WeightKey =
  | 'playingTimeEquality'
  | 'seasonFairness'
  | 'positionVariety'
  | 'positionGroupBalance'
  | 'infieldOpportunity'
  | 'playerPreferences'
  | 'developmentGoals'
  | 'criticalPositionStrength'
  | 'battingOrderFairness'
  | 'consecutiveBenchPenalty'
  | 'repeatedPositionPenalty'
  | 'excessiveOutfieldPenalty'
  | 'avoidPositionPenalty';

export type Weights = Record<WeightKey, number>;

export type GameStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED';

export type AssignmentType = 'PLANNED' | 'ACTUAL';

export interface GamePlayer {
  playerId: string;
  available: boolean;
  /** 1-based inning the player becomes available. */
  arrivalInning?: number;
  /** 1-based last inning the player is available. */
  departureInning?: number;
  /** Per-game pitching cap override. */
  maxPitchingInnings?: number;
}

export interface DefensiveAssignment {
  id: string;
  gameId: string;
  inning: number;
  /** A formation position id, or BENCH_POSITION_ID. */
  positionId: string;
  playerId: string;
  locked: boolean;
  assignmentType: AssignmentType;
}

export interface BattingAssignment {
  gameId: string;
  playerId: string;
  battingSlot: number;
  locked: boolean;
}

export interface Game {
  id: string;
  teamId: string;
  opponent: string;
  date: string;
  plannedInnings: number;
  /** Innings that were actually played. null until recorded. */
  actualInnings: number | null;
  /** Immutable copy of the formation used, so history survives edits. */
  formationSnapshot: Formation;
  status: GameStatus;
  /** Immutable copy of the rules in force when the lineup was generated. */
  settingsSnapshot: TeamSettings;
  optimizerVersion: string;
  optimizerSeed: number;
  gamePlayers: GamePlayer[];
  /** Coach-specified pitching plan: inning (1-based) -> playerId. */
  pitchingPlan: Record<number, string>;
  defensiveAssignments: DefensiveAssignment[];
  battingAssignments: BattingAssignment[];
  /** Per-game eligibility overrides the coach explicitly accepted. */
  eligibilityOverrides: Array<{ playerId: string; positionId: string }>;
  createdAt: string;
}

export type GoalType = 'MORE_REPS' | 'AT_LEAST_ONE_INNING' | 'FEWER_REPS';

export interface DevelopmentGoal {
  id: string;
  teamId: string;
  playerId: string;
  positionId: string | null;
  positionGroup: PositionGroup | null;
  goalType: GoalType;
  /** 1 (low) .. 3 (high) */
  priority: number;
  active: boolean;
}

/** A temporary "prioritize next game" nudge created from a fairness alert. */
export interface PriorityFlag {
  id: string;
  teamId: string;
  playerId: string;
  kind: 'DEFENSIVE_INNINGS' | 'INFIELD' | 'BENCH' | 'BATTING';
  createdAt: string;
}
