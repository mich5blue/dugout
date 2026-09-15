/**
 * Every option a coach can change, written out once.
 *
 * The simplification pass moved most of these behind an Advanced disclosure,
 * which was right — a coach setting up their first team should not meet
 * sixteen dials. But "hidden" turned into "undiscoverable": there was nowhere
 * that said what `Position continuity` actually does, or that turning
 * `Critical positions` up fights the infield-opportunity promise.
 *
 * Kept as data rather than prose so the guide can group it, and so adding a
 * setting to the product and forgetting to document it shows up as a missing
 * row rather than as nothing at all.
 */

import type { RuleSettings } from '@/domain/types';

export type SettingGroup =
  | 'Playing time'
  | 'Bench'
  | 'Variety'
  | 'Positions'
  | 'Battery'
  | 'Batting';

export interface SettingDoc {
  /** The label as it appears in the product. */
  name: string;
  group: SettingGroup;
  /** Where to find it. */
  where: string;
  /** What it does, in a sentence a coach can act on. */
  what: string;
  /**
   * The settings field this documents, when it maps to exactly one.
   *
   * The guide reads the shipped default out of defaultRuleSettings() through
   * this key rather than repeating it in prose. Hand-copied defaults were
   * already wrong on the first draft — four of them — and a help page that
   * misstates a default is worse than one that omits it.
   */
  key?: keyof RuleSettings;
  /** Spelled out by hand, for the rows that span several fields or none. */
  fallback?: string;
  /** The case for touching it — and the cost. */
  when: string;
  /** True for anything behind the Advanced disclosure. */
  advanced?: boolean;
}

export const SETTINGS: SettingDoc[] = [
  {
    name: 'Coaching style',
    group: 'Playing time',
    where: 'Team Settings, and per game under Game setup → Rules',
    what: 'The preset behind everything else. Equal Playing Time flattens innings hardest; Development leans toward giving weaker players the infield and the better batting slots; Balanced is the middle; Competitive lets the strongest players take the important spots more often.',
    fallback: 'Balanced',
    when: 'Set it once for the team and leave it. Change it per game only for something unusual — a tournament final, or a game where half the roster is missing.',
  },
  {
    name: 'Minimum defensive innings',
    group: 'Playing time',
    where: 'Game setup → Rules',
    what: 'Nobody plays fewer than this many innings in the field. As a Target the solver gets as close as it can; as Required it refuses to produce a lineup that breaks the rule.',
    key: 'minDefensiveInnings',
    when: "Raise it to match a league rule. Switch it to Required only if you mean it: with a short roster, Required can make a lineup impossible, and InningGrid will tell you rather than quietly ignore it.",
  },
  {
    name: 'Playing time',
    group: 'Playing time',
    where: 'Game setup → Rules → Advanced',
    what: 'How hard to push everyone toward the same number of innings, independently of the coaching style.',
    key: 'playingTimeBalance',
    when: 'Reach for it when the style is right in every other respect but the innings spread is wider or tighter than you want.',
    advanced: true,
  },
  {
    name: 'Even out bench innings',
    group: 'Bench',
    where: 'Game setup → Rules',
    what: 'Spreads bench innings across the roster instead of letting them land on the same few players.',
    key: 'equalizeBench',
    when: 'Leave it on. Turning it off only makes sense if you are managing the bench by hand with locks.',
  },
  {
    name: 'Nobody sits twice in a row',
    group: 'Bench',
    where: 'Game setup → Rules',
    what: 'Stops a player sitting two innings in a row.',
    key: 'noConsecutiveBench',
    when: 'Leave it on — sitting twice running is the thing players and parents notice most. With a very long roster and short games it can be impossible to honour, and the solver will say so.',
  },
  {
    name: 'Max bench innings per player',
    group: 'Bench',
    where: 'Game setup → Rules → Advanced',
    what: 'A hard ceiling on how many innings any one player sits in a game.',
    key: 'maxBenchInnings',
    when: 'Useful for a doubleheader or a long roster where a cap is easier to explain to parents than a philosophy.',
    advanced: true,
  },
  {
    name: 'Position variety',
    group: 'Variety',
    where: 'Game setup → Rules → Advanced',
    what: 'How much the solver wants to move players around the field rather than park them in one spot.',
    key: 'variety',
    when: 'High for early-season development; Low late in the season when you want players settled where they know what to do.',
    advanced: true,
  },
  {
    name: 'Minimum unique positions',
    group: 'Variety',
    where: 'Game setup → Rules → Advanced',
    what: 'A floor on how many distinct positions each player sees in one game.',
    key: 'minUniquePositions',
    when: 'A blunter alternative to Position variety when you want a promise you can state to a parent.',
    advanced: true,
  },
  {
    name: 'Max innings at one position',
    group: 'Variety',
    where: 'Game setup → Rules → Advanced',
    what: 'A ceiling on innings at any single position in one game.',
    key: 'maxInningsSamePosition',
    when: 'Stops a strong shortstop playing shortstop all six innings every week.',
    advanced: true,
  },
  {
    name: 'Max consecutive innings at one position',
    group: 'Variety',
    where: 'Game setup → Rules → Advanced',
    what: 'The same ceiling, but only for consecutive innings.',
    key: 'maxConsecutiveSamePosition',
    when: 'Gentler than the total cap: a player can still have their best position often, just not for the whole game at a stretch.',
    advanced: true,
  },
  {
    name: 'Position continuity',
    group: 'Variety',
    where: 'Game setup → Rules → Advanced',
    what: 'The opposite of variety: keep a player in the same spot for this many innings at a time before moving them.',
    key: 'positionContinuityInnings',
    when: 'Two innings at a time helps the youngest divisions, where a player who has just worked out where to stand should not be moved. It is a preference, not a rule, so fairness can still override it.',
    advanced: true,
  },
  {
    name: 'Infield opportunity',
    group: 'Positions',
    where: 'Game setup → Rules',
    what: 'Every player gets at least this many infield innings per game — Target to aim, Required to insist.',
    key: 'infieldOpportunity',
    when: 'This is the setting that makes the season feel fair, and the one parents ask about. Raise it if your outfield is where players go to be forgotten.',
  },
  {
    name: 'Infield ability spread',
    group: 'Positions',
    where: 'Game setup → Rules → Advanced',
    what: 'Avoids putting two developing players in the infield in the same inning, and avoids it harder two innings running.',
    key: 'infieldSpread',
    when: "Turn it up when the infield-opportunity promise is producing innings where the whole left side is still learning, and off if you would rather it never influenced who plays where. It is deliberately not the same as Critical position strength: that one pushes developing players out of the infield altogether, which is the opposite of what you want.",
    advanced: true,
  },
  {
    name: 'Max / min outfield innings',
    group: 'Positions',
    where: 'Game setup → Rules → Advanced',
    what: 'Caps and floors on outfield innings per player in a game, including a separate cap on consecutive outfield innings.',
    fallback: 'No caps',
    when: 'The direct way to stop one player living in right field, if you would rather state a number than tune variety.',
    advanced: true,
  },
  {
    name: 'Critical position strength',
    group: 'Positions',
    where: 'Game setup → Rules → Advanced',
    what: 'How strongly to prefer your stronger players at the positions the formation marks as important.',
    key: 'criticalStrength',
    when: 'Turn it up for a game that matters. Know the trade: it competes directly with infield opportunity and with playing-time equality, and at High the same handful of players will hold the same spots.',
    advanced: true,
  },
  {
    name: 'Who can pitch / catch',
    group: 'Battery',
    where: 'Roster → a player',
    what: 'The hard constraint everything else is built on. InningGrid needs a pitcher and a catcher for every inning.',
    fallback: 'Nobody, until you say so',
    when: "Get this right before your first game. Two or three of each gives the solver room; one means that player covers every inning there, and the lineup can't be fair.",
  },
  {
    name: 'Max pitching / catching innings per player',
    group: 'Battery',
    where: 'Game setup → Rules → Advanced, or per player on the roster',
    what: 'The most innings any one player pitches or catches. Per-player caps on the roster page beat the team-wide setting.',
    fallback: 'No cap',
    when: 'Set it to match your league rule, then stop thinking about it. Use the per-player cap for a kid coming back from an injury.',
    advanced: true,
  },
  {
    name: 'No catching straight after pitching',
    group: 'Battery',
    where: 'Game setup → Rules → Advanced',
    what: 'Blocks the pitcher-to-catcher switch, and the reverse, between consecutive innings.',
    key: 'restrictPitcherCatcherTransition',
    when: 'Some leagues require it. It is also just kind — that switch means full gear on in about ninety seconds.',
    advanced: true,
  },
  {
    name: 'Pitching plan',
    group: 'Battery',
    where: 'Game setup → Pitching plan',
    what: "Name who pitches which inning before generating. The plan pins that inning's pitcher, and the rest of the lineup is built around it.",
    fallback: 'Empty — the solver picks',
    when: "Fill it in when you have already decided your pitching. A pinned cell shows a pin rather than a lock in the grid, because Rebalance won't move it either.",
  },
  {
    name: 'Batting order style',
    group: 'Batting',
    where: 'Games → Batting order',
    what: 'Rotate fairly ignores hitting ratings and moves everyone through the order across the season. Balanced and Competitive both read each player\'s Hitting rating. Manual leaves it to you.',
    key: 'battingPhilosophy',
    when: 'If you pick Balanced or Competitive, set the Hitting rating on each player\'s page — otherwise the order is being driven by a field you never filled in.',
  },
  {
    name: 'Continuous batting vs starters & subs',
    group: 'Batting',
    where: 'Team Settings',
    what: 'Continuous means everyone bats in turn whether or not they are on the field. Starters & subs means the batting order is the nine or ten on the field.',
    fallback: 'Continuous',
    when: 'Match your league. Most recreational leagues bat continuously, and it is what makes playing time and batting fairness separable problems.',
  },
];
