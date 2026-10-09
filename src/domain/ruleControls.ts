import { RULE_GROUP_LABEL, RULE_GROUP_ORDER, ruleCopy, rulesInGroup, type RuleGroup } from '@/domain/ruleCopy';
import type { TeamSettings } from '@/domain/types';

/**
 * How each rule is set: which rules the How-to-coach step shows, what a coach
 * can pick for each, and how a pick becomes settings.
 *
 * Shared by the website's builder and the native app so the choices, their
 * wording and what they do are the same on both. The wording of the rules
 * themselves stays in `ruleCopy`.
 */

/** The handful of rules that belong in the flow, per group. */
export const FLOW_CONTROLS: Record<RuleGroup, Array<keyof TeamSettings>> = {
  PLAYING_TIME: ['playingTimeBalance', 'minDefensiveInnings', 'maxBenchInnings'],
  POSITIONS: ['infieldOpportunity', 'variety', 'maxConsecutiveSamePosition'],
  BATTERY: [
    'maxPitchingInningsPerPlayer',
    'maxCatcherInningsPerPlayer',
    'maxConsecutiveCatcherInnings',
  ],
  BATTING: ['battingPhilosophy'],
  BENCH: ['noConsecutiveBench', 'equalizeBench'],
};

const LEVELS = [
  { value: 'OFF', label: 'Off' },
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Med' },
  { value: 'HIGH', label: 'High' },
];

/** Rules picked from a fixed list. */
export const CHOICE_OPTIONS: Partial<Record<keyof TeamSettings, Array<{ value: string; label: string }>>> = {
  playingTimeBalance: [
    { value: 'EQUAL', label: 'As equal as possible' },
    { value: 'MOSTLY_EQUAL', label: 'Mostly equal' },
    { value: 'COMPETITIVE', label: 'Strongest lineup' },
  ],
  variety: [
    { value: 'LOW', label: 'Settle them' },
    { value: 'MEDIUM', label: 'Some rotation' },
    { value: 'HIGH', label: 'Move around a lot' },
  ],
  battingPhilosophy: [
    { value: 'ROTATE_FAIRLY', label: 'Rotate fairly' },
    { value: 'BALANCED', label: 'Balanced' },
    { value: 'COMPETITIVE', label: 'Competitive' },
    { value: 'MANUAL', label: "I'll do it" },
  ],
  criticalStrength: LEVELS,
  infieldSpread: LEVELS,
};

/** Rules that are a count of innings, or off. */
export const NUMERIC_CAPS: Array<keyof TeamSettings> = [
  'minDefensiveInnings',
  'maxBenchInnings',
  'maxConsecutiveSamePosition',
  'maxPitchingInningsPerPlayer',
  'maxCatcherInningsPerPlayer',
  'maxConsecutiveCatcherInnings',
  'positionContinuityInnings',
  'minUniquePositions',
  'maxInningsSamePosition',
  'maxOutfieldInnings',
  'maxConsecutiveOutfieldInnings',
];

export type RuleControlKind = 'toggle' | 'choice';

export interface RuleControl {
  key: keyof TeamSettings;
  label: string;
  help: string;
  cost?: string;
  kind: RuleControlKind;
  /** For a toggle, 'true' or 'false'. Otherwise one of `options`. */
  value: string;
  options: Array<{ value: string; label: string }>;
}

export interface RuleSection {
  group: RuleGroup;
  label: string;
  rules: RuleControl[];
}

function countOptions(key: keyof TeamSettings, innings: number) {
  return [
    { value: 'off', label: key === 'minDefensiveInnings' ? 'None' : 'No cap' },
    ...Array.from({ length: innings }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
  ];
}

function infieldOptions(innings: number) {
  return [
    { value: 'off', label: 'Off' },
    ...Array.from({ length: Math.max(1, innings - 1) }, (_, i) => ({
      value: String(i + 1),
      label: `${i + 1} ${i === 0 ? 'inning' : 'innings'}`,
    })),
  ];
}

/** What a rule's control currently reads, as a string. */
export function ruleValue(settings: TeamSettings, key: keyof TeamSettings): string {
  if (key === 'infieldOpportunity') {
    return settings.infieldOpportunity.mode === 'OFF' ? 'off' : String(settings.infieldOpportunity.innings);
  }
  const value = settings[key];
  if (key === 'infieldSpread') return String(value ?? 'OFF');
  if (NUMERIC_CAPS.includes(key)) return value === undefined ? 'off' : String(value);
  return String(value);
}

export function ruleControl(
  settings: TeamSettings,
  key: keyof TeamSettings,
  innings: number,
): RuleControl | null {
  const copy = ruleCopy(key);
  if (!copy) return null;
  const base = { key, label: copy.label, help: copy.help, cost: copy.cost, value: ruleValue(settings, key) };
  if (typeof settings[key] === 'boolean') return { ...base, kind: 'toggle', options: [] };
  if (key === 'infieldOpportunity') return { ...base, kind: 'choice', options: infieldOptions(innings) };
  const choices = CHOICE_OPTIONS[key];
  if (choices) return { ...base, kind: 'choice', options: choices };
  if (NUMERIC_CAPS.includes(key)) return { ...base, kind: 'choice', options: countOptions(key, innings) };
  return null;
}

/**
 * The rules, grouped and in order, ready to draw. `advanced` gives the rules
 * kept behind Advanced instead of the short list.
 */
export function ruleSections(settings: TeamSettings, innings: number, advanced = false): RuleSection[] {
  return RULE_GROUP_ORDER.map((group) => {
    const keys = advanced
      ? rulesInGroup(group, true).flatMap((rule) => (rule.key ? [rule.key] : []))
      : FLOW_CONTROLS[group];
    return {
      group,
      label: RULE_GROUP_LABEL[group],
      rules: keys.flatMap((key) => {
        const control = ruleControl(settings, key, innings);
        return control ? [control] : [];
      }),
    };
  }).filter((section) => section.rules.length > 0);
}

/**
 * Set one rule from what its control produced. Any hand change means the
 * preset no longer describes the settings, so the philosophy becomes CUSTOM.
 */
export function setRule(
  settings: TeamSettings,
  key: keyof TeamSettings,
  value: string | boolean,
): TeamSettings {
  let patch: Partial<TeamSettings>;
  if (typeof value === 'boolean') {
    patch = { [key]: value };
  } else if (key === 'infieldOpportunity') {
    patch = {
      infieldOpportunity:
        value === 'off'
          ? { mode: 'OFF' }
          : {
              mode: settings.infieldOpportunity.mode === 'REQUIRED' ? 'REQUIRED' : 'TARGET',
              innings: Number(value),
            },
    };
  } else if (NUMERIC_CAPS.includes(key)) {
    patch = { [key]: value === 'off' ? undefined : Number(value) };
  } else {
    patch = { [key]: value };
  }
  return { ...settings, ...patch, philosophy: 'CUSTOM' };
}

/** How many rules sit off their shipped default, for the Advanced badge. */
export function countChangedRules(settings: TeamSettings, defaults: Partial<TeamSettings>): number {
  return (Object.keys(defaults) as Array<keyof TeamSettings>).filter((key) => {
    const a = settings[key];
    const b = defaults[key];
    if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
      return JSON.stringify(a) !== JSON.stringify(b);
    }
    return a !== b;
  }).length;
}
