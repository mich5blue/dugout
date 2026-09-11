'use client';

import {
  Button,
  Card,
  CardHeader,
  Label,
  Notice,
  SegmentedControl,
  Select,
  Toggle,
} from '@/components/ui';
import { playerName } from '@/domain/factories';
import type {
  CriticalStrength,
  Game,
  Philosophy,
  Player,
  PlayingTimeBalance,
  RuleMode,
  TeamSettings,
  VarietyLevel,
} from '@/domain/types';
import {
  PHILOSOPHY_DESCRIPTION,
  PHILOSOPHY_LABEL,
  PHILOSOPHY_SPECTRUM,
  applyPhilosophy,
} from '@/domain/weights';
import { cn } from '@/lib/cn';
import { useState } from 'react';

/** Who is playing (spec section 17). */
export function AvailabilityPanel({
  game,
  players,
  onChange,
}: {
  game: Game;
  players: Player[];
  onChange: (game: Game) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const update = (playerId: string, changes: Partial<Game['gamePlayers'][number]>) => {
    onChange({
      ...game,
      gamePlayers: game.gamePlayers.map((gp) =>
        gp.playerId === playerId ? { ...gp, ...changes } : gp,
      ),
    });
  };

  const availableCount = game.gamePlayers.filter((gp) => gp.available).length;
  const innings = Array.from({ length: game.plannedInnings }, (_, i) => i + 1);

  return (
    <Card>
      <CardHeader
        title="Who's playing?"
        description={`${availableCount} of ${game.gamePlayers.length} available. Tap to toggle anyone who isn't here.`}
      />
      <div className="space-y-2 px-5 py-5">
        {game.gamePlayers.map((gp) => {
          const player = players.find((entry) => entry.id === gp.playerId);
          if (!player) return null;
          const partial = gp.arrivalInning !== undefined || gp.departureInning !== undefined;

          return (
            <div key={gp.playerId} className="rounded-xl border border-border">
              <div className="flex items-center gap-2 p-2">
                <button
                  type="button"
                  aria-pressed={gp.available}
                  onClick={() => update(gp.playerId, { available: !gp.available })}
                  className={cn(
                    'ring-focus flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                    gp.available ? 'bg-brand-soft' : 'bg-surface-muted',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold',
                      gp.available
                        ? 'border-brand bg-brand text-ink-inverse'
                        : 'border-border-strong text-transparent',
                    )}
                    aria-hidden
                  >
                    ✓
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate text-sm font-medium',
                        gp.available ? 'text-ink' : 'text-ink-subtle line-through',
                      )}
                    >
                      {playerName(player)}
                    </span>
                    {partial && gp.available ? (
                      <span className="block text-xs text-ink-muted">
                        {gp.arrivalInning ? `Arrives inning ${gp.arrivalInning}` : null}
                        {gp.arrivalInning && gp.departureInning ? ' · ' : null}
                        {gp.departureInning ? `Leaves after inning ${gp.departureInning}` : null}
                      </span>
                    ) : null}
                  </span>
                </button>

                {gp.available ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setExpanded((current) => (current === gp.playerId ? null : gp.playerId))
                    }
                  >
                    {expanded === gp.playerId ? 'Done' : 'Partial'}
                  </Button>
                ) : null}
              </div>

              {expanded === gp.playerId && gp.available ? (
                <div className="grid gap-3 border-t border-border px-3 py-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={`arrival-${gp.playerId}`}>Arrives</Label>
                    <Select
                      id={`arrival-${gp.playerId}`}
                      className="mt-1.5"
                      value={gp.arrivalInning ?? ''}
                      onChange={(event) =>
                        update(gp.playerId, {
                          arrivalInning:
                            event.target.value === '' ? undefined : Number(event.target.value),
                        })
                      }
                    >
                      <option value="">On time</option>
                      {innings.slice(1).map((inning) => (
                        <option key={inning} value={inning}>
                          Inning {inning}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={`departure-${gp.playerId}`}>Leaves after</Label>
                    <Select
                      id={`departure-${gp.playerId}`}
                      className="mt-1.5"
                      value={gp.departureInning ?? ''}
                      onChange={(event) =>
                        update(gp.playerId, {
                          departureInning:
                            event.target.value === '' ? undefined : Number(event.target.value),
                        })
                      }
                    >
                      <option value="">Stays all game</option>
                      {innings.slice(0, -1).map((inning) => (
                        <option key={inning} value={inning}>
                          Inning {inning}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Coaching philosophy and rules (spec sections 3, 18-24). */
export function RulesPanel({
  settings,
  innings,
  onChange,
}: {
  settings: TeamSettings;
  innings: number;
  onChange: (settings: TeamSettings) => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const set = (changes: Partial<TeamSettings>) =>
    onChange({ ...settings, ...changes, philosophy: 'CUSTOM' });

  const inningOptions = Array.from({ length: innings + 1 }, (_, i) => i);

  return (
    <Card>
      <CardHeader
        title="How do you want to coach this game?"
        description="Presets move everything below. Change anything and you're on Custom."
      />
      <div className="space-y-6 px-5 py-5">
        <div>
          <div className="flex items-center justify-between gap-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
            <span>Developmental</span>
            <span>Competitive</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PHILOSOPHY_SPECTRUM.map((philosophy) => (
              <button
                key={philosophy}
                type="button"
                aria-pressed={settings.philosophy === philosophy}
                onClick={() => onChange(applyPhilosophy(settings, philosophy))}
                className={cn(
                  'ring-focus rounded-xl border px-3 py-2.5 text-left transition-colors',
                  settings.philosophy === philosophy
                    ? 'border-brand bg-brand-soft'
                    : 'border-border bg-surface hover:border-border-strong',
                )}
              >
                <span className="block text-sm font-semibold text-ink">
                  {PHILOSOPHY_LABEL[philosophy]}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            {PHILOSOPHY_DESCRIPTION[settings.philosophy]}
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label>Minimum defensive innings</Label>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Select
                className="w-28"
                value={settings.minDefensiveInnings}
                onChange={(event) => set({ minDefensiveInnings: Number(event.target.value) })}
              >
                {inningOptions.map((value) => (
                  <option key={value} value={value}>
                    {value === 0 ? 'None' : value}
                  </option>
                ))}
              </Select>
              {settings.minDefensiveInnings > 0 ? (
                <SegmentedControl<RuleMode>
                  size="sm"
                  value={settings.minDefensiveInningsMode}
                  onChange={(value) => set({ minDefensiveInningsMode: value })}
                  options={[
                    { value: 'TARGET', label: 'Target' },
                    { value: 'REQUIRED', label: 'Required' },
                  ]}
                />
              ) : null}
            </div>
            {settings.minDefensiveInningsMode === 'REQUIRED' &&
            settings.minDefensiveInnings > 0 ? (
              <p className="mt-1.5 text-xs text-ink-subtle">
                Dugout will tell you before generating if this is impossible.
              </p>
            ) : null}
          </div>

          <div>
            <Label>Playing time</Label>
            <SegmentedControl<PlayingTimeBalance>
              className="mt-1.5"
              size="sm"
              value={settings.playingTimeBalance}
              onChange={(value) => set({ playingTimeBalance: value })}
              options={[
                { value: 'EQUAL', label: 'Equal' },
                { value: 'MOSTLY_EQUAL', label: 'Mostly equal' },
                { value: 'COMPETITIVE', label: 'Competitive' },
              ]}
            />
          </div>

          <div>
            <Label>Position variety</Label>
            <SegmentedControl<VarietyLevel>
              className="mt-1.5"
              size="sm"
              value={settings.variety}
              onChange={(value) => set({ variety: value })}
              options={[
                { value: 'LOW', label: 'Low' },
                { value: 'MEDIUM', label: 'Medium' },
                { value: 'HIGH', label: 'High' },
              ]}
            />
          </div>

          <div>
            <Label>Position continuity</Label>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <SegmentedControl
                size="sm"
                value={String(settings.positionContinuityInnings ?? 0)}
                onChange={(value) =>
                  set({
                    positionContinuityInnings:
                      Number(value) === 0 ? undefined : Number(value),
                  })
                }
                options={[
                  { value: '0', label: 'Rotate freely' },
                  { value: '2', label: '2 innings' },
                  { value: '3', label: '3 innings' },
                ]}
              />
            </div>
            <p className="mt-1.5 text-xs text-ink-subtle">
              {(settings.positionContinuityInnings ?? 0) > 1
                ? `Players stay at one spot for ${settings.positionContinuityInnings} innings before moving — good for learning a position, and for doubleheaders.`
                : 'Players can move position every inning.'}
            </p>
          </div>

          <div>
            <Label>Critical position strength</Label>
            <SegmentedControl<CriticalStrength>
              className="mt-1.5"
              size="sm"
              value={settings.criticalStrength}
              onChange={(value) => set({ criticalStrength: value })}
              options={[
                { value: 'OFF', label: 'Off' },
                { value: 'LOW', label: 'Low' },
                { value: 'MEDIUM', label: 'Med' },
                { value: 'HIGH', label: 'High' },
              ]}
            />
            <p className="mt-1.5 text-xs text-ink-subtle">
              Higher gives stronger players more time at the positions you marked
              critical, without breaking playing-time rules.
            </p>
          </div>
        </div>

        <div>
          <Label>Infield opportunity</Label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <SegmentedControl
              size="sm"
              value={settings.infieldOpportunity.mode}
              onChange={(mode) =>
                set({
                  infieldOpportunity:
                    mode === 'OFF'
                      ? { mode: 'OFF' }
                      : {
                          mode,
                          innings:
                            settings.infieldOpportunity.mode === 'OFF'
                              ? 1
                              : settings.infieldOpportunity.innings,
                        },
                })
              }
              options={[
                { value: 'OFF', label: 'Off' },
                { value: 'TARGET', label: 'Target' },
                { value: 'REQUIRED', label: 'Require' },
              ]}
            />
            {settings.infieldOpportunity.mode !== 'OFF' ? (
              <Select
                className="w-36"
                value={settings.infieldOpportunity.innings}
                onChange={(event) =>
                  set({
                    infieldOpportunity: {
                      mode: settings.infieldOpportunity.mode as 'TARGET' | 'REQUIRED',
                      innings: Number(event.target.value),
                    },
                  })
                }
              >
                {[1, 2, 3].map((value) => (
                  <option key={value} value={value}>
                    {value} {value === 1 ? 'inning' : 'innings'}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
          <p className="mt-1.5 text-xs text-ink-subtle">
            Applies to every player eligible for at least one infield position.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle
            active={settings.noConsecutiveBench}
            onClick={() => set({ noConsecutiveBench: !settings.noConsecutiveBench })}
          >
            <span className="text-sm text-ink">Nobody sits twice in a row</span>
          </Toggle>
          <Toggle
            active={settings.equalizeBench}
            onClick={() => set({ equalizeBench: !settings.equalizeBench })}
          >
            <span className="text-sm text-ink">Even out bench innings</span>
          </Toggle>
        </div>

        <div>
          <Button size="sm" variant="ghost" onClick={() => setAdvanced((value) => !value)}>
            {advanced ? 'Hide advanced rules' : 'Advanced rules'}
          </Button>
        </div>

        {advanced ? (
          <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
            <NumberRule
              label="Minimum unique positions"
              value={settings.minUniquePositions}
              max={innings}
              onChange={(value) => set({ minUniquePositions: value })}
            />
            <NumberRule
              label="Max innings at one position"
              value={settings.maxInningsSamePosition}
              max={innings}
              onChange={(value) => set({ maxInningsSamePosition: value })}
            />
            <NumberRule
              label="Max consecutive innings at one position"
              value={settings.maxConsecutiveSamePosition}
              max={innings}
              onChange={(value) => set({ maxConsecutiveSamePosition: value })}
            />
            <NumberRule
              label="Max outfield innings"
              value={settings.maxOutfieldInnings}
              max={innings}
              onChange={(value) => set({ maxOutfieldInnings: value })}
            />
            <NumberRule
              label="Min outfield innings"
              value={settings.minOutfieldInnings}
              max={innings}
              onChange={(value) => set({ minOutfieldInnings: value })}
            />
            <NumberRule
              label="Max consecutive outfield innings"
              value={settings.maxConsecutiveOutfieldInnings}
              max={innings}
              onChange={(value) => set({ maxConsecutiveOutfieldInnings: value })}
            />
            <NumberRule
              label="Max bench innings per player"
              value={settings.maxBenchInnings}
              max={innings}
              onChange={(value) => set({ maxBenchInnings: value })}
            />
            <NumberRule
              label="Max pitching innings per player"
              value={settings.maxPitchingInningsPerPlayer}
              max={innings}
              onChange={(value) => set({ maxPitchingInningsPerPlayer: value })}
            />
            <NumberRule
              label="Max catching innings per player"
              value={settings.maxCatcherInningsPerPlayer}
              max={innings}
              onChange={(value) => set({ maxCatcherInningsPerPlayer: value })}
            />
            <NumberRule
              label="Max consecutive catching innings"
              value={settings.maxConsecutiveCatcherInnings}
              max={innings}
              onChange={(value) => set({ maxConsecutiveCatcherInnings: value })}
            />
            <Toggle
              active={settings.restrictPitcherCatcherTransition}
              onClick={() =>
                set({
                  restrictPitcherCatcherTransition: !settings.restrictPitcherCatcherTransition,
                })
              }
              className="sm:col-span-2"
            >
              <span className="text-sm text-ink">
                No pitching and catching in back-to-back innings
              </span>
            </Toggle>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function NumberRule({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number | undefined;
  max: number;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Select
        className="mt-1.5"
        value={value ?? ''}
        onChange={(event) =>
          onChange(event.target.value === '' ? undefined : Number(event.target.value))
        }
      >
        <option value="">No limit</option>
        {Array.from({ length: max }, (_, i) => i + 1).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Pitching plan (spec section 25). */
export function PitchingPlanPanel({
  game,
  players,
  onChange,
}: {
  game: Game;
  players: Player[];
  onChange: (game: Game) => void;
}) {
  const pitcherPosition = game.formationSnapshot.positions.find(
    (position) => position.role === 'PITCHER',
  );
  if (!pitcherPosition) return null;

  const eligible = players.filter((player) => {
    if (!player.canPitch) return false;
    const gp = game.gamePlayers.find((entry) => entry.playerId === player.id);
    return gp?.available ?? false;
  });

  const innings = Array.from({ length: game.plannedInnings }, (_, i) => i + 1);
  const planned = Object.values(game.pitchingPlan);

  const set = (inning: number, playerId: string | null) => {
    const plan = { ...game.pitchingPlan };
    if (playerId === null) delete plan[inning];
    else plan[inning] = playerId;
    onChange({ ...game, pitchingPlan: plan });
  };

  return (
    <Card>
      <CardHeader
        title="Pitching plan"
        description="Set the innings you've decided. Leave the rest blank and Dugout picks eligible pitchers."
      />
      <div className="px-5 py-5">
        {eligible.length === 0 ? (
          <Notice tone="caution" title="No pitchers marked available">
            Mark at least one available player as able to pitch on the roster page.
          </Notice>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {innings.map((inning) => {
              const current = game.pitchingPlan[inning];
              const availableThisInning = eligible.filter((player) => {
                const gp = game.gamePlayers.find((entry) => entry.playerId === player.id);
                const arrival = gp?.arrivalInning ?? 1;
                const departure = gp?.departureInning ?? game.plannedInnings;
                return inning >= arrival && inning <= departure;
              });

              return (
                <div key={inning} className="flex items-center gap-2">
                  <span className="tnum w-14 shrink-0 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                    Inn {inning}
                  </span>
                  <Select
                    value={current ?? ''}
                    onChange={(event) => set(inning, event.target.value || null)}
                  >
                    <option value="">Dugout chooses</option>
                    {availableThisInning.map((player) => (
                      <option key={player.id} value={player.id}>
                        {playerName(player)}
                      </option>
                    ))}
                  </Select>
                </div>
              );
            })}
          </div>
        )}

        {planned.length > 0 ? (
          <p className="mt-3 text-sm text-ink-muted">
            {planned.length} {planned.length === 1 ? 'inning is' : 'innings are'} locked to
            the pitchers you chose.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/** Team-wide philosophy picker used by the settings page. */
export function PhilosophyPicker({
  value,
  onChange,
}: {
  value: Philosophy;
  onChange: (philosophy: Philosophy) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {PHILOSOPHY_SPECTRUM.map((philosophy) => (
        <button
          key={philosophy}
          type="button"
          aria-pressed={value === philosophy}
          onClick={() => onChange(philosophy)}
          className={cn(
            'ring-focus rounded-xl border px-4 py-3 text-left transition-colors',
            value === philosophy
              ? 'border-brand bg-brand-soft'
              : 'border-border bg-surface hover:border-border-strong',
          )}
        >
          <span className="block text-sm font-semibold text-ink">
            {PHILOSOPHY_LABEL[philosophy]}
          </span>
          <span className="mt-1 block text-xs text-ink-muted">
            {PHILOSOPHY_DESCRIPTION[philosophy]}
          </span>
        </button>
      ))}
    </div>
  );
}
