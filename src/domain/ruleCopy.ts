import type { RuleSettings, TeamSettings } from '@/domain/types';

/**
 * How every rule is described to a coach — written once, read everywhere.
 *
 * The build flow, the settings page and the guide all describe the same
 * sixteen-odd controls. Three copies of that wording drift apart within a
 * month, and then the guide is teaching a control that says something
 * different on screen. So the sentence lives here and each surface renders it.
 *
 * The house style, from the redesign brief:
 *
 *   not  "Enforce consecutive bench maximum"
 *   but  "Don't sit a player two innings in a row"
 *
 * `label` is what the control is called. `help` is what it does, in a sentence
 * a coach can act on, and never restates the label. `cost` is the honest
 * trade-off, present only where turning something up genuinely takes something
 * else away — a control that claims no cost is one a coach cannot reason about.
 */

export type RuleGroup =
  | 'PLAYING_TIME'
  | 'POSITIONS'
  | 'BATTERY'
  | 'BATTING'
  | 'BENCH';

export const RULE_GROUP_LABEL: Record<RuleGroup, string> = {
  PLAYING_TIME: 'Playing time',
  POSITIONS: 'Position development',
  BATTERY: 'Pitching & catching',
  BATTING: 'Batting order',
  BENCH: 'Bench & substitutions',
};

/** Rendered in this order, which is the order a coach cares about them. */
export const RULE_GROUP_ORDER: RuleGroup[] = [
  'PLAYING_TIME',
  'POSITIONS',
  'BATTERY',
  'BATTING',
  'BENCH',
];

export interface RuleCopy {
  /**
   * The settings field, when this maps to exactly one.
   *
   * `TeamSettings` rather than `RuleSettings` because two of these —
   * how the order is built and whether everyone bats — sit on the team
   * settings rather than the rule block, and a coach does not care which.
   */
  key?: keyof TeamSettings;
  group: RuleGroup;
  label: string;
  help: string;
  /** What it costs when turned up. Omitted where there is no real trade. */
  cost?: string;
  /** True for anything that belongs behind Advanced rather than in the flow. */
  advanced?: boolean;
}

export const RULE_COPY: RuleCopy[] = [
  // ---- Playing time -----------------------------------------------------
  {
    key: 'playingTimeBalance',
    group: 'PLAYING_TIME',
    label: 'Equal playing time',
    help: 'Push everyone toward the same number of innings in the field.',
    cost: 'At the strictest setting your strongest players sit as often as anyone else.',
  },
  {
    key: 'minDefensiveInnings',
    group: 'PLAYING_TIME',
    label: 'Minimum innings per player',
    help: 'Nobody plays fewer innings in the field than this.',
    cost: 'Set as Required with a short roster and a lineup can become impossible — InningGrid will say so rather than ignore it.',
  },
  {
    key: 'maxBenchInnings',
    group: 'PLAYING_TIME',
    label: 'Maximum bench innings',
    help: 'A ceiling on how long any one player sits in a game.',
  },

  // ---- Position development --------------------------------------------
  {
    key: 'infieldOpportunity',
    group: 'POSITIONS',
    label: 'Everyone gets infield time',
    help: 'Every player gets at least this many innings in the infield.',
    cost: 'Raising it means your steadiest infielders spend more time outside it.',
  },
  {
    key: 'variety',
    group: 'POSITIONS',
    label: 'Rotate positions regularly',
    help: 'Move players around the field instead of parking them in one spot.',
    cost: 'High variety early in the season means more players learning a spot mid-game.',
  },
  {
    key: 'maxConsecutiveSamePosition',
    group: 'POSITIONS',
    label: 'Maximum same position in a row',
    help: 'Stop a player holding one position for a whole stretch of the game.',
  },
  {
    key: 'minOutfieldInnings',
    group: 'POSITIONS',
    label: 'Include outfield rotation',
    help: 'Everyone takes a turn in the outfield, not only the players who always do.',
  },
  {
    key: 'positionContinuityInnings',
    group: 'POSITIONS',
    label: 'Keep players in a spot for a while',
    help: 'The opposite of rotating: leave a player somewhere for this many innings before moving them.',
    cost: 'Pulls directly against position variety. Useful in the youngest divisions, where a player who has just worked out where to stand should not be moved.',
    advanced: true,
  },
  {
    key: 'minUniquePositions',
    group: 'POSITIONS',
    label: 'Different positions per game',
    help: 'A floor on how many distinct spots each player sees in one game.',
    advanced: true,
  },
  {
    key: 'maxInningsSamePosition',
    group: 'POSITIONS',
    label: 'Maximum innings at one position',
    help: 'A total cap per position per game, not just consecutive innings.',
    advanced: true,
  },
  {
    key: 'maxOutfieldInnings',
    group: 'POSITIONS',
    label: 'Maximum outfield innings',
    help: 'Stop one player living in right field.',
    advanced: true,
  },
  {
    key: 'maxConsecutiveOutfieldInnings',
    group: 'POSITIONS',
    label: 'Maximum outfield innings in a row',
    help: 'The same cap, but only for back-to-back innings.',
    advanced: true,
  },
  {
    key: 'criticalStrength',
    group: 'POSITIONS',
    label: 'Stronger players at key positions',
    help: 'How hard to prefer your stronger players where the formation says it matters most.',
    cost: 'Competes directly with equal playing time and with infield opportunity. At the highest setting the same few players hold the same spots.',
    advanced: true,
  },
  {
    key: 'infieldSpread',
    group: 'POSITIONS',
    label: 'Spread out developing players',
    help: 'Avoid putting two players who are still learning in the infield in the same inning.',
    cost: 'Turn it down if it is overriding who you actually want in the infield.',
    advanced: true,
  },

  // ---- Pitching & catching ---------------------------------------------
  {
    key: 'maxPitchingInningsPerPlayer',
    group: 'BATTERY',
    label: 'Maximum innings per pitcher',
    help: 'The most innings any one player pitches in a game.',
  },
  {
    key: 'maxCatcherInningsPerPlayer',
    group: 'BATTERY',
    label: 'Maximum innings per catcher',
    help: 'The most innings any one player catches in a game.',
  },
  {
    key: 'maxConsecutiveCatcherInnings',
    group: 'BATTERY',
    label: 'Catcher rotation',
    help: 'How many innings in a row a player catches before somebody else takes the gear.',
  },
  {
    key: 'restrictPitcherCatcherTransition',
    group: 'BATTERY',
    label: 'No catching straight after pitching',
    help: 'Blocks the pitcher-to-catcher switch between innings, and the reverse.',
    cost: 'Some leagues require it. It is also ninety seconds to get full gear on.',
    advanced: true,
  },

  // ---- Batting order ----------------------------------------------------
  {
    key: 'battingPhilosophy',
    group: 'BATTING',
    label: 'How the order is built',
    help: 'Rotate fairly moves everyone through the order across the season and ignores hitting ratings. Balanced and Competitive read each player’s Hitting rating. Manual leaves it to you.',
    cost: 'Pick Balanced or Competitive and the order is driven by a rating on each player’s page — set it, or the order is being decided by a field you never filled in.',
  },
  {
    key: 'battingFormat',
    group: 'BATTING',
    label: 'Everyone bats',
    help: 'Continuous batting means every player bats in turn whether or not they are on the field. Starters & subs means the order is the players in the field.',
  },

  // ---- Bench & substitutions -------------------------------------------
  {
    key: 'noConsecutiveBench',
    group: 'BENCH',
    label: 'Nobody sits twice in a row',
    help: 'A player never rests two innings back to back.',
    cost: 'With a long roster and a short game this can be impossible to honour, and the lineup will say so.',
  },
  {
    key: 'equalizeBench',
    group: 'BENCH',
    label: 'Even out bench innings',
    help: 'Spread rest across the roster instead of letting it land on the same few players.',
  },
];

const BY_KEY = new Map<string, RuleCopy>(
  RULE_COPY.filter((rule) => rule.key).map((rule) => [rule.key as string, rule]),
);

export function ruleCopy(key: keyof RuleSettings | keyof TeamSettings): RuleCopy | undefined {
  return BY_KEY.get(key as string);
}

export function rulesInGroup(group: RuleGroup, advanced = false): RuleCopy[] {
  return RULE_COPY.filter(
    (rule) => rule.group === group && Boolean(rule.advanced) === advanced,
  );
}

/**
 * The three cards a coach actually chooses between.
 *
 * `EQUAL_PLAYING_TIME` is deliberately not one of them. It is reachable from
 * Advanced, but offering four cards where three of them promise fairness makes
 * the choice harder, not more powerful — and Balanced with equal playing time
 * turned up is the same lineup.
 */
export const PHILOSOPHY_CARDS = [
  {
    philosophy: 'BALANCED' as const,
    label: 'Balanced',
    blurb: 'Keep playing time and opportunities as equal as possible.',
    detail: 'The right answer for most rec teams. Start here.',
  },
  {
    philosophy: 'DEVELOPMENT' as const,
    label: 'Development',
    blurb: 'Prioritise rotation, position exposure and new experience.',
    detail: 'Everyone gets infield time, and players move around more.',
  },
  {
    philosophy: 'COMPETITIVE' as const,
    label: 'Competitive',
    blurb: 'Strongest lineup that still respects required playing time.',
    detail: 'Stronger players hold key spots. Minimums are still honoured.',
  },
];
