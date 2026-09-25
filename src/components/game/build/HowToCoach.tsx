'use client';

import { RulesPanel } from '@/components/game/GameSetupPanels';
import { Badge, Button, Select, Toggle } from '@/components/ui';
import {
  PHILOSOPHY_CARDS,
  RULE_GROUP_LABEL,
  RULE_GROUP_ORDER,
  ruleCopy,
  type RuleGroup,
} from '@/domain/ruleCopy';
import type { Philosophy, TeamSettings } from '@/domain/types';
import { applyPhilosophy, defaultRuleSettings } from '@/domain/weights';
import { cn } from '@/lib/cn';
import { useState } from 'react';

/**
 * How do you want to coach this game?
 *
 * The old game page put sixteen dials in front of a coach and expected them to
 * assemble a philosophy out of it. Most coaches want one of three answers, and
 * the three answers already exist in the engine as presets — this screen is the
 * choice, and then the short list of things a coach actually reaches for.
 *
 * Everything else stays reachable. `RulesPanel` — the full sixteen — is behind
 * Advanced, unchanged, so no capability is lost by not showing it.
 */

/** The handful of rules that belong in the flow, per group. */
const FLOW_CONTROLS: Record<RuleGroup, Array<keyof TeamSettings>> = {
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

export function HowToCoach({
  settings,
  innings,
  onChange,
}: {
  settings: TeamSettings;
  innings: number;
  onChange: (settings: TeamSettings) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const changedCount = countChanged(settings);

  return (
    <div>
      <h2 className="display text-2xl text-ink sm:text-3xl">
        How do you want to coach this game?
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        Pick one and you&apos;re done — these are good defaults. Everything below is
        optional.
      </p>

      {/* The three cards. One filled choice, always. */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {PHILOSOPHY_CARDS.map((card) => {
          const active = settings.philosophy === card.philosophy;
          return (
            <button
              key={card.philosophy}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(applyPhilosophy(settings, card.philosophy))}
              className={cn(
                'ring-focus rounded-xl border p-4 text-left transition-colors',
                active
                  ? 'border-brand bg-brand-soft'
                  : 'border-border bg-surface hover:border-border-strong',
              )}
            >
              <span className="flex items-center gap-2">
                {/* A check mark, not just a tint — the tint alone was nearly
                    invisible in dark mode. */}
                <span
                  aria-hidden
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold',
                    active
                      ? 'border-brand bg-brand text-ink-inverse'
                      : 'border-border-strong text-transparent',
                  )}
                >
                  ✓
                </span>
                <span className="text-sm font-semibold text-ink">{card.label}</span>
              </span>
              <span className="mt-2 block text-xs leading-relaxed text-ink-muted">
                {card.blurb}
              </span>
              <span className="mt-1.5 block text-xs text-ink-subtle">{card.detail}</span>
            </button>
          );
        })}
      </div>

      {settings.philosophy === 'CUSTOM' ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <Badge tone="neutral">Custom</Badge>
          You&apos;ve changed things by hand, so no preset is selected. Tap one above to
          start over from it.
        </p>
      ) : null}

      {/* The short list. Grouped, in plain English, with the trade stated. */}
      <div className="mt-7 space-y-5">
        {RULE_GROUP_ORDER.map((group) => (
          <section key={group}>
            <h3 className="eyebrow text-ink-subtle">{RULE_GROUP_LABEL[group]}</h3>
            <div className="mt-2 divide-y divide-border rounded-xl border border-border bg-surface">
              {FLOW_CONTROLS[group].map((key) => (
                <RuleRow
                  key={String(key)}
                  settingsKey={key}
                  settings={settings}
                  innings={innings}
                  onChange={onChange}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Advanced: the whole engine, unchanged. */}
      <div className="mt-6 rounded-xl border border-border bg-surface">
        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          aria-expanded={advancedOpen}
          className="ring-focus flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink">Advanced rules</span>
            <span className="mt-0.5 block text-xs text-ink-muted">
              Position limits, outfield caps, continuity, developing-player spread,
              pitcher/catcher transitions.
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {changedCount > 0 ? (
              <Badge tone="neutral">{changedCount} changed</Badge>
            ) : null}
            <span
              aria-hidden
              className={cn(
                'text-ink-subtle transition-transform',
                advancedOpen && 'rotate-90',
              )}
            >
              ›
            </span>
          </span>
        </button>

        {advancedOpen ? (
          <div className="border-t border-border p-4">
            <RulesPanel settings={settings} innings={innings} onChange={onChange} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** How many rules sit off their shipped default, for the Advanced badge. */
function countChanged(settings: TeamSettings): number {
  const defaults = defaultRuleSettings();
  return (Object.keys(defaults) as Array<keyof typeof defaults>).filter((key) => {
    const a = settings[key];
    const b = defaults[key];
    if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
      return JSON.stringify(a) !== JSON.stringify(b);
    }
    return a !== b;
  }).length;
}

/**
 * One rule, rendered from its copy.
 *
 * The control shape is chosen from the value's type rather than hand-wired per
 * field, so adding a rule to `FLOW_CONTROLS` is a one-line change and the
 * wording always comes from `ruleCopy`.
 */
function RuleRow({
  settingsKey,
  settings,
  innings,
  onChange,
}: {
  settingsKey: keyof TeamSettings;
  settings: TeamSettings;
  innings: number;
  onChange: (settings: TeamSettings) => void;
}) {
  const copy = ruleCopy(settingsKey);
  if (!copy) return null;

  const value = settings[settingsKey];
  /* Any hand change means the preset no longer describes the settings. */
  const set = (patch: Partial<TeamSettings>) =>
    onChange({ ...settings, ...patch, philosophy: 'CUSTOM' });

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{copy.label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{copy.help}</p>
        {copy.cost ? (
          <p className="mt-1 text-xs leading-relaxed text-ink-subtle">{copy.cost}</p>
        ) : null}
      </div>

      <div className="shrink-0">
        {typeof value === 'boolean' ? (
          <Toggle
            active={value}
            onClick={() => set({ [settingsKey]: !value } as Partial<TeamSettings>)}
          >
            <span className="text-xs font-semibold">{value ? 'On' : 'Off'}</span>
          </Toggle>
        ) : null}

        {settingsKey === 'playingTimeBalance' ? (
          <Select
            className="h-9 w-36"
            value={String(value)}
            onChange={(event) =>
              set({ playingTimeBalance: event.target.value as TeamSettings['playingTimeBalance'] })
            }
          >
            <option value="EQUAL">As equal as possible</option>
            <option value="MOSTLY_EQUAL">Mostly equal</option>
            <option value="COMPETITIVE">Strongest lineup</option>
          </Select>
        ) : null}

        {settingsKey === 'variety' ? (
          <Select
            className="h-9 w-32"
            value={String(value)}
            onChange={(event) =>
              set({ variety: event.target.value as TeamSettings['variety'] })
            }
          >
            <option value="LOW">Settle them</option>
            <option value="MEDIUM">Some rotation</option>
            <option value="HIGH">Move around a lot</option>
          </Select>
        ) : null}

        {settingsKey === 'battingPhilosophy' ? (
          <Select
            className="h-9 w-36"
            value={String(value)}
            onChange={(event) =>
              set({
                battingPhilosophy: event.target.value as TeamSettings['battingPhilosophy'],
              })
            }
          >
            <option value="ROTATE_FAIRLY">Rotate fairly</option>
            <option value="BALANCED">Balanced</option>
            <option value="COMPETITIVE">Competitive</option>
            <option value="MANUAL">I&apos;ll do it</option>
          </Select>
        ) : null}

        {settingsKey === 'infieldOpportunity' ? (
          <Select
            className="h-9 w-32"
            value={
              settings.infieldOpportunity.mode === 'OFF'
                ? 'off'
                : String(settings.infieldOpportunity.innings)
            }
            onChange={(event) =>
              set({
                infieldOpportunity:
                  event.target.value === 'off'
                    ? { mode: 'OFF' }
                    : {
                        mode: settings.infieldOpportunity.mode === 'REQUIRED'
                          ? 'REQUIRED'
                          : 'TARGET',
                        innings: Number(event.target.value),
                      },
              })
            }
          >
            <option value="off">Off</option>
            {Array.from({ length: Math.max(1, innings - 1) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? 'inning' : 'innings'}
              </option>
            ))}
          </Select>
        ) : null}

        {/* Plain numeric caps: a count, or off. */}
        {NUMERIC_CAPS.includes(settingsKey) ? (
          <Select
            className="h-9 w-28"
            value={value === undefined ? 'off' : String(value)}
            onChange={(event) =>
              set({
                [settingsKey]:
                  event.target.value === 'off' ? undefined : Number(event.target.value),
              } as Partial<TeamSettings>)
            }
          >
            <option value="off">{settingsKey === 'minDefensiveInnings' ? 'None' : 'No cap'}</option>
            {Array.from({ length: innings }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
    </div>
  );
}

const NUMERIC_CAPS: Array<keyof TeamSettings> = [
  'minDefensiveInnings',
  'maxBenchInnings',
  'maxConsecutiveSamePosition',
  'maxPitchingInningsPerPlayer',
  'maxCatcherInningsPerPlayer',
  'maxConsecutiveCatcherInnings',
];
