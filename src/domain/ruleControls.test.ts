import { describe, expect, it } from 'vitest';
import { RULE_GROUP_ORDER } from './ruleCopy';
import { ruleControl, ruleSections, setRule } from './ruleControls';
import { defaultTeamSettings } from './weights';

const settings = defaultTeamSettings();

describe('rule controls', () => {
  it('describes every short-list rule, in group order', () => {
    const sections = ruleSections(settings, 6);
    expect(sections.map((section) => section.group)).toEqual(RULE_GROUP_ORDER);
    expect(sections.every((section) => section.rules.length > 0)).toBe(true);
  });

  it('has a control for every advanced rule', () => {
    const advanced = ruleSections(settings, 6, true).flatMap((section) => section.rules);
    expect(advanced.length).toBeGreaterThanOrEqual(7);
  });

  it('offers counts up to the game length, plus off', () => {
    const control = ruleControl(settings, 'maxPitchingInningsPerPlayer', 6)!;
    expect(control.value).toBe('2');
    expect(control.options.map((option) => option.value)).toEqual(['off', '1', '2', '3', '4', '5', '6']);
  });

  it('turns a pick into settings and marks them custom', () => {
    const capped = setRule(settings, 'maxBenchInnings', '2');
    expect(capped.maxBenchInnings).toBe(2);
    expect(capped.philosophy).toBe('CUSTOM');
    expect(setRule(capped, 'maxBenchInnings', 'off').maxBenchInnings).toBeUndefined();
    expect(setRule(settings, 'noConsecutiveBench', false).noConsecutiveBench).toBe(false);
  });

  it('keeps infield Required when the count changes', () => {
    const required = { ...settings, infieldOpportunity: { mode: 'REQUIRED' as const, innings: 1 } };
    expect(setRule(required, 'infieldOpportunity', '2').infieldOpportunity).toEqual({ mode: 'REQUIRED', innings: 2 });
    expect(setRule(required, 'infieldOpportunity', 'off').infieldOpportunity).toEqual({ mode: 'OFF' });
  });
});
