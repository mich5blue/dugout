'use client';

import { RulesPanel } from '@/components/game/GameSetupPanels';
import { Badge, Button, Select, Toggle } from '@/components/ui';
import { PHILOSOPHY_CARDS, RULE_GROUP_LABEL, RULE_GROUP_ORDER } from '@/domain/ruleCopy';
import { countChangedRules, FLOW_CONTROLS, ruleControl, setRule } from '@/domain/ruleControls';
import type { Philosophy, TeamSettings } from '@/domain/types';
import { applyPhilosophy, defaultRuleSettings } from '@/domain/weights';
import { cn } from '@/lib/cn';
import { useState } from 'react';

/**
 * How do you want to coach this game?
 *
 * The old game page put sixteen dials in front of a coach and expected them to
 * assemble a philosophy out of it. Most coaches want one of four answers, and
 * the four answers already exist in the engine as presets — this screen is the
 * choice, and then the short list of things a coach actually reaches for.
 *
 * Everything else stays reachable. `RulesPanel` — the full sixteen — is behind
 * Advanced, unchanged, so no capability is lost by not showing it.
 */

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

  const changedCount = countChangedRules(settings, defaultRuleSettings());

  return (
    <div>
      <h2 className="display text-2xl text-ink sm:text-3xl">
        How do you want to coach this game?
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        Pick one and you&apos;re done — these are good defaults. Everything below is
        optional.
      </p>

      {/* The four cards. One filled choice, always. */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
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

/**
 * One rule, rendered from its control in domain/ruleControls — the same
 * description the native app draws — so the options, their wording and what
 * a pick does are defined once.
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
  const control = ruleControl(settings, settingsKey, innings);
  if (!control) return null;

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{control.label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{control.help}</p>
        {control.cost ? (
          <p className="mt-1 text-xs leading-relaxed text-ink-subtle">{control.cost}</p>
        ) : null}
      </div>

      <div className="shrink-0">
        {control.kind === 'toggle' ? (
          <Toggle
            active={control.value === 'true'}
            onClick={() => onChange(setRule(settings, settingsKey, control.value !== 'true'))}
          >
            <span className="text-xs font-semibold">{control.value === 'true' ? 'On' : 'Off'}</span>
          </Toggle>
        ) : (
          <Select
            className={cn('h-9', SELECT_WIDTH[settingsKey] ?? 'w-28')}
            value={control.value}
            onChange={(event) => onChange(setRule(settings, settingsKey, event.target.value))}
          >
            {control.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </div>
    </div>
  );
}

const SELECT_WIDTH: Partial<Record<keyof TeamSettings, string>> = {
  playingTimeBalance: 'w-36',
  battingPhilosophy: 'w-36',
  variety: 'w-32',
  infieldOpportunity: 'w-32',
};
