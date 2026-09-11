import type {
  CriticalStrength,
  Philosophy,
  PlayingTimeBalance,
  TeamSettings,
  VarietyLevel,
  WeightKey,
  Weights,
} from './types';

/**
 * Every tunable number in the optimizer lives here. Nothing in the solver or UI
 * should introduce an unexplained numeric constant.
 */

export const WEIGHT_LABEL: Record<WeightKey, string> = {
  playingTimeEquality: 'Playing Time Equality',
  seasonFairness: 'Season Fairness',
  positionVariety: 'Position Variety',
  positionGroupBalance: 'Position Group Balance',
  infieldOpportunity: 'Infield Opportunity',
  playerPreferences: 'Player Preferences',
  developmentGoals: 'Development Goals',
  criticalPositionStrength: 'Critical Position Strength',
  battingOrderFairness: 'Batting Order Fairness',
  consecutiveBenchPenalty: 'Consecutive Bench Penalty',
  repeatedPositionPenalty: 'Repeated Position Penalty',
  excessiveOutfieldPenalty: 'Excessive Outfield Penalty',
  avoidPositionPenalty: 'Avoid Position Penalty',
};

const EQUAL_PLAYING_TIME: Weights = {
  playingTimeEquality: 100,
  seasonFairness: 100,
  positionVariety: 60,
  positionGroupBalance: 60,
  infieldOpportunity: 70,
  playerPreferences: 30,
  developmentGoals: 40,
  criticalPositionStrength: 0,
  battingOrderFairness: 100,
  consecutiveBenchPenalty: 90,
  repeatedPositionPenalty: 40,
  excessiveOutfieldPenalty: 50,
  avoidPositionPenalty: 60,
};

const DEVELOPMENT: Weights = {
  playingTimeEquality: 100,
  seasonFairness: 95,
  positionVariety: 90,
  positionGroupBalance: 80,
  infieldOpportunity: 85,
  playerPreferences: 40,
  developmentGoals: 80,
  criticalPositionStrength: 20,
  battingOrderFairness: 95,
  consecutiveBenchPenalty: 85,
  repeatedPositionPenalty: 70,
  excessiveOutfieldPenalty: 70,
  avoidPositionPenalty: 60,
};

const BALANCED: Weights = {
  playingTimeEquality: 90,
  seasonFairness: 90,
  positionVariety: 70,
  positionGroupBalance: 70,
  infieldOpportunity: 70,
  playerPreferences: 50,
  developmentGoals: 60,
  criticalPositionStrength: 60,
  battingOrderFairness: 80,
  consecutiveBenchPenalty: 80,
  repeatedPositionPenalty: 55,
  excessiveOutfieldPenalty: 55,
  avoidPositionPenalty: 60,
};

const COMPETITIVE: Weights = {
  playingTimeEquality: 55,
  seasonFairness: 50,
  positionVariety: 35,
  positionGroupBalance: 35,
  infieldOpportunity: 30,
  playerPreferences: 65,
  developmentGoals: 30,
  criticalPositionStrength: 100,
  battingOrderFairness: 40,
  consecutiveBenchPenalty: 60,
  repeatedPositionPenalty: 20,
  excessiveOutfieldPenalty: 25,
  avoidPositionPenalty: 70,
};

export const PHILOSOPHY_PRESETS: Record<Philosophy, Weights> = {
  EQUAL_PLAYING_TIME,
  DEVELOPMENT,
  BALANCED,
  COMPETITIVE,
  // Custom starts from Balanced and is then modified by weightOverrides.
  CUSTOM: BALANCED,
};

export const PHILOSOPHY_LABEL: Record<Philosophy, string> = {
  EQUAL_PLAYING_TIME: 'Equal Playing Time',
  DEVELOPMENT: 'Development',
  BALANCED: 'Balanced',
  COMPETITIVE: 'Competitive',
  CUSTOM: 'Custom',
};

export const PHILOSOPHY_DESCRIPTION: Record<Philosophy, string> = {
  EQUAL_PLAYING_TIME: 'Maximum playing-time equality.',
  DEVELOPMENT: 'Strong emphasis on equality and position variety.',
  BALANCED:
    'Nearly equal playing time while stronger players get somewhat more time at critical positions.',
  COMPETITIVE:
    'Playing-time requirements respected, but stronger players get significantly more important assignments.',
  CUSTOM: 'You control the individual settings.',
};

/** Ordered developmental -> competitive, for the philosophy spectrum control. */
export const PHILOSOPHY_SPECTRUM: Philosophy[] = [
  'EQUAL_PLAYING_TIME',
  'DEVELOPMENT',
  'BALANCED',
  'COMPETITIVE',
];

const PLAYING_TIME_BALANCE_MULTIPLIER: Record<PlayingTimeBalance, number> = {
  EQUAL: 1.25,
  MOSTLY_EQUAL: 1.0,
  COMPETITIVE: 0.6,
};

const VARIETY_MULTIPLIER: Record<VarietyLevel, number> = {
  LOW: 0.4,
  MEDIUM: 1.0,
  HIGH: 1.6,
};

const CRITICAL_STRENGTH_MULTIPLIER: Record<CriticalStrength, number> = {
  OFF: 0,
  LOW: 0.4,
  MEDIUM: 1.0,
  HIGH: 1.8,
};

/**
 * Resolves the effective weights for a game: philosophy preset, adjusted by the
 * coach's plain-language dials, then by any explicit custom overrides.
 */
export function resolveWeights(settings: TeamSettings): Weights {
  const base = PHILOSOPHY_PRESETS[settings.philosophy] ?? BALANCED;
  const weights: Weights = { ...base };

  const ptMultiplier = PLAYING_TIME_BALANCE_MULTIPLIER[settings.playingTimeBalance];
  weights.playingTimeEquality = base.playingTimeEquality * ptMultiplier;
  weights.seasonFairness = base.seasonFairness * ptMultiplier;

  const varietyMultiplier = VARIETY_MULTIPLIER[settings.variety];
  weights.positionVariety = base.positionVariety * varietyMultiplier;
  weights.positionGroupBalance = base.positionGroupBalance * varietyMultiplier;
  weights.repeatedPositionPenalty = base.repeatedPositionPenalty * varietyMultiplier;

  weights.criticalPositionStrength =
    base.criticalPositionStrength * CRITICAL_STRENGTH_MULTIPLIER[settings.criticalStrength];

  if (settings.infieldOpportunity.mode === 'OFF') {
    weights.infieldOpportunity = 0;
  } else if (settings.infieldOpportunity.mode === 'REQUIRED') {
    // Required infield innings are also enforced as a constraint; the weight
    // keeps the solver pointed in the right direction while searching.
    weights.infieldOpportunity = base.infieldOpportunity * 1.5;
  }

  if (!settings.noConsecutiveBench) {
    weights.consecutiveBenchPenalty = base.consecutiveBenchPenalty * 0.5;
  }

  if (settings.weightOverrides) {
    for (const [key, value] of Object.entries(settings.weightOverrides)) {
      if (typeof value === 'number') weights[key as WeightKey] = value;
    }
  }

  return weights;
}

/** Rule defaults for a brand-new team: fair but not rigid. */
export function defaultRuleSettings(): Omit<TeamSettings, 'philosophy' | 'battingFormat'> {
  return {
    minDefensiveInnings: 3,
    minDefensiveInningsMode: 'TARGET',
    playingTimeBalance: 'MOSTLY_EQUAL',
    equalizeBench: true,
    noConsecutiveBench: true,
    maxBenchInnings: undefined,
    variety: 'MEDIUM',
    minUniquePositions: 2,
    maxInningsSamePosition: undefined,
    maxConsecutiveSamePosition: undefined,
    infieldOpportunity: { mode: 'TARGET', innings: 1 },
    maxOutfieldInnings: undefined,
    minOutfieldInnings: undefined,
    maxConsecutiveOutfieldInnings: undefined,
    criticalStrength: 'MEDIUM',
    maxCatcherInningsPerPlayer: undefined,
    maxConsecutiveCatcherInnings: 3,
    maxPitchingInningsPerPlayer: 2,
    restrictPitcherCatcherTransition: false,
    battingPhilosophy: 'ROTATE_FAIRLY',
  };
}

export function defaultTeamSettings(): TeamSettings {
  return {
    ...defaultRuleSettings(),
    philosophy: 'BALANCED',
    battingFormat: 'CONTINUOUS',
  };
}

/**
 * Applying a philosophy preset also moves the plain-language dials, so the
 * settings screen stays consistent with what the coach picked.
 */
export function applyPhilosophy(settings: TeamSettings, philosophy: Philosophy): TeamSettings {
  const next: TeamSettings = { ...settings, philosophy };
  switch (philosophy) {
    case 'EQUAL_PLAYING_TIME':
      next.playingTimeBalance = 'EQUAL';
      next.variety = 'MEDIUM';
      next.criticalStrength = 'OFF';
      next.noConsecutiveBench = true;
      next.equalizeBench = true;
      break;
    case 'DEVELOPMENT':
      next.playingTimeBalance = 'EQUAL';
      next.variety = 'HIGH';
      next.criticalStrength = 'LOW';
      next.noConsecutiveBench = true;
      next.equalizeBench = true;
      next.infieldOpportunity = { mode: 'REQUIRED', innings: 1 };
      break;
    case 'BALANCED':
      next.playingTimeBalance = 'MOSTLY_EQUAL';
      next.variety = 'MEDIUM';
      next.criticalStrength = 'MEDIUM';
      next.noConsecutiveBench = true;
      break;
    case 'COMPETITIVE':
      next.playingTimeBalance = 'COMPETITIVE';
      next.variety = 'LOW';
      next.criticalStrength = 'HIGH';
      next.noConsecutiveBench = false;
      break;
    case 'CUSTOM':
      break;
  }
  return next;
}
