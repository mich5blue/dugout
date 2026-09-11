'use client';

import { useDugout } from '../providers';
import {
  Badge,
  Button,
  Input,
  Label,
  Notice,
  SegmentedControl,
  Textarea,
  Toggle,
} from '@/components/ui';
import { PhilosophyPicker } from '@/components/game/GameSetupPanels';
import { RosterPhotoImport } from '@/components/RosterPhotoImport';
import { toQuickAddText } from '@/lib/rosterImport';
import {
  DEFAULT_FORMATION_BY_SPORT,
  formationSubtitle,
  systemFormationsForSport,
} from '@/domain/formations';
import { FormationThumbnail } from '@/components/FormationThumbnail';
import { createPlayer, createTeam, parseQuickAddRoster } from '@/domain/factories';
import type { BattingFormat, Philosophy, Player, Sport } from '@/domain/types';
import { applyPhilosophy, defaultTeamSettings } from '@/domain/weights';
import { cn } from '@/lib/cn';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

/**
 * Guided first-run setup.
 *
 * One decision per screen, always with a sensible default so Continue is never
 * blocked by something the coach doesn't care about. Two steps are validated
 * rather than merely collected, because getting them wrong makes lineups
 * impossible later: having fewer players than the formation needs, and having
 * nobody marked able to pitch or catch.
 *
 * Nothing is written to storage until the final step, so an abandoned setup
 * leaves no half-created team behind.
 */

const DIVISIONS = [
  'Coach Pitch',
  '8U',
  '9U',
  '10U',
  'Little League Minors',
  'Little League Majors',
  '12U',
  'Travel',
  'Other',
];

const STEPS = ['Team', 'Roster', 'Defense', 'Battery', 'Style', 'Ready'] as const;
type StepIndex = 0 | 1 | 2 | 3 | 4 | 5;

interface DraftPlayer {
  key: string;
  firstName: string;
  lastName: string;
  jerseyNumber?: string;
  canPitch: boolean;
  canCatch: boolean;
}

export default function SetupPage() {
  const router = useRouter();
  const { ready, teams, saveTeam, savePlayers, setActiveTeam } = useDugout();

  /*
    The same wizard creates the first team and every one after it. It used to
    refuse outright once a team existed, which made a second team impossible —
    a coach with a rec team and a travel team had nowhere to go.
  */
  const adding = teams.length > 0;

  const [step, setStep] = useState<StepIndex>(0);
  const [saving, setSaving] = useState(false);

  // Step 1: team
  const [name, setName] = useState('');
  const [sport, setSport] = useState<Sport>('BASEBALL');
  const [division, setDivision] = useState('Little League Minors');

  // Step 2: roster
  const [rosterText, setRosterText] = useState('');
  const [draft, setDraft] = useState<DraftPlayer[]>([]);
  const [photoOpen, setPhotoOpen] = useState(false);

  // Step 3: defense
  const [innings, setInnings] = useState(6);
  const [formationId, setFormationId] = useState(DEFAULT_FORMATION_BY_SPORT.BASEBALL);

  // Step 5: style
  const [philosophy, setPhilosophy] = useState<Philosophy>('BALANCED');
  const [battingFormat, setBattingFormat] = useState<BattingFormat>('CONTINUOUS');

  const formations = useMemo(() => systemFormationsForSport(sport), [sport]);
  const formation = useMemo(
    () => formations.find((entry) => entry.id === formationId) ?? formations[0],
    [formations, formationId],
  );

  const parsed = useMemo(() => parseQuickAddRoster(rosterText, 'draft'), [rosterText]);

  /**
   * The roster in play: parsed names, carrying over any battery choices.
   * Keyed by name rather than list position, so going back to add a player
   * does not scramble who was marked able to pitch or catch.
   */
  const roster: DraftPlayer[] = useMemo(() => {
    const byKey = new Map(draft.map((player) => [player.key, player]));
    const seen = new Map<string, number>();

    return parsed.map((spec) => {
      const base = `${spec.firstName} ${spec.lastName ?? ''}`.trim().toLowerCase();
      const occurrence = seen.get(base) ?? 0;
      seen.set(base, occurrence + 1);
      const key = occurrence === 0 ? base : `${base}#${occurrence}`;
      const existing = byKey.get(key);

      return {
        key,
        firstName: spec.firstName,
        lastName: spec.lastName ?? '',
        jerseyNumber: spec.jerseyNumber,
        canPitch: existing?.canPitch ?? false,
        canCatch: existing?.canCatch ?? false,
      };
    });
  }, [draft, parsed]);

  const setBattery = (key: string, changes: Partial<DraftPlayer>) => {
    setDraft(
      roster.map((player) => (player.key === key ? { ...player, ...changes } : player)),
    );
  };

  const changeSport = (next: Sport) => {
    setSport(next);
    setFormationId(DEFAULT_FORMATION_BY_SPORT[next]);
  };

  const pitchers = roster.filter((player) => player.canPitch);
  const catchers = roster.filter((player) => player.canCatch);
  const positionCount = formation?.positions.length ?? 0;
  const enoughPlayers = roster.length >= positionCount;
  const benchPerInning = Math.max(0, roster.length - positionCount);

  const canContinue = (): boolean => {
    switch (step) {
      case 0:
        return name.trim().length > 0;
      case 1:
        return roster.length > 0;
      case 2:
        return enoughPlayers;
      case 3:
        return pitchers.length > 0 && catchers.length > 0;
      default:
        return true;
    }
  };

  const finish = async (thenCreateGame: boolean) => {
    if (!formation) return;
    setSaving(true);
    try {
      const settings = {
        ...applyPhilosophy(defaultTeamSettings(), philosophy),
        battingFormat,
      };

      const newTeam = createTeam({
        name,
        sport,
        division,
        defaultInnings: innings,
        defaultFormationId: formation.id,
        settings,
      });
      await saveTeam(newTeam);
      // Switch to it immediately: a coach who just filled in a roster expects
      // to land on that team, not on whichever one they were looking at.
      setActiveTeam(newTeam.id);

      // Everyone starts able to play every position. Pitching and catching are
      // gated by the can-pitch / can-catch flags from the battery step, and any
      // other exceptions are a few taps on the roster page.
      const players: Player[] = roster.map((entry, index) =>
        createPlayer({
          teamId: newTeam.id,
          firstName: entry.firstName,
          lastName: entry.lastName,
          jerseyNumber: entry.jerseyNumber,
          canPitch: entry.canPitch,
          canCatch: entry.canCatch,
          createdAt: new Date(Date.now() + index).toISOString(),
        }),
      );

      await savePlayers(players);
      router.push(thenCreateGame ? '/games/new' : '/');
    } finally {
      setSaving(false);
    }
  };

  if (!ready) return null;

  return (
    <div className="mx-auto max-w-xl pb-28 sm:pb-10">
      {adding ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="eyebrow text-ink-subtle">New team</p>
            <p className="mt-0.5 text-sm text-ink-muted">
              Your other {teams.length === 1 ? 'team stays' : 'teams stay'} exactly as
              {teams.length === 1 ? ' it is' : ' they are'}.
            </p>
          </div>
          <Link href="/">
            <Button size="sm">Cancel</Button>
          </Link>
        </div>
      ) : null}

      <Progress step={step} />

      <div className="mt-8">
        {step === 0 ? (
          <Step
            title={adding ? 'Who else are you coaching?' : 'Who are you coaching?'}
            hint="You can change any of this later."
          >
            <div className="space-y-5">
              <div>
                <Label htmlFor="team-name">Team name</Label>
                <Input
                  id="team-name"
                  className="mt-1.5"
                  placeholder="Balsam Waters"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoFocus
                />
              </div>

              <div>
                <Label>Sport</Label>
                <SegmentedControl
                  className="mt-1.5"
                  value={sport}
                  onChange={changeSport}
                  options={[
                    { value: 'BASEBALL', label: 'Baseball' },
                    { value: 'SOFTBALL', label: 'Softball' },
                  ]}
                />
              </div>

              <div>
                <Label htmlFor="division">Age or division</Label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {DIVISIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={division === option}
                      onClick={() => setDivision(option)}
                      className={cn(
                        'ring-focus rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                        division === option
                          ? 'border-brand bg-brand text-ink-inverse'
                          : 'border-border bg-surface text-ink-muted hover:text-ink',
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Step>
        ) : null}

        {step === 1 ? (
          <Step
            title="Add your players"
            hint="Import a photo of your roster, or type the names — one per line."
          >
            <div className="mb-3">
              <Button onClick={() => setPhotoOpen(true)}>
                Import from a photo
              </Button>
              <p className="mt-1.5 text-xs text-ink-subtle">
                A screenshot from your scorekeeping app, or a picture of a lineup
                card — even handwritten.
              </p>
            </div>

            <Textarea
              rows={9}
              autoFocus
              placeholder={'Brody Borek #8\nRace Smith #12\nWeston Jones\nCalvin Miller'}
              value={rosterText}
              onChange={(event) => setRosterText(event.target.value)}
            />

            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-sm text-ink-muted">
                {roster.length === 0
                  ? 'Names go one per line.'
                  : `${roster.length} ${roster.length === 1 ? 'player' : 'players'}`}
              </p>
              {roster.length > 0 ? (
                <Badge tone="positive">Looks good</Badge>
              ) : null}
            </div>

            {roster.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {roster.map((player) => (
                  <span
                    key={player.key}
                    className="rounded-md bg-surface-muted px-2 py-1 text-sm text-ink"
                  >
                    {player.firstName} {player.lastName}
                    {player.jerseyNumber ? (
                      <span className="ml-1 text-ink-subtle">#{player.jerseyNumber}</span>
                    ) : null}
                  </span>
                ))}
              </div>
            ) : null}

            <p className="mt-4 text-sm text-ink-subtle">
              &ldquo;Race Smith #12&rdquo;, &ldquo;12 Race Smith&rdquo; and &ldquo;Race
              Smith, 12&rdquo; all work.
            </p>
          </Step>
        ) : null}

        {step === 2 ? (
          <Step
            title="How does your league play?"
            hint="This sets how many players take the field each inning."
          >
            <div className="space-y-6">
              <div>
                <Label>Innings per game</Label>
                <SegmentedControl
                  className="mt-1.5"
                  value={String(innings)}
                  onChange={(value) => setInnings(Number(value))}
                  options={[
                    { value: '4', label: '4' },
                    { value: '5', label: '5' },
                    { value: '6', label: '6' },
                    { value: '7', label: '7' },
                  ]}
                />
              </div>

              <div>
                <Label>Players on defense</Label>
                <div className="mt-1.5 space-y-2">
                  {formations.map((option) => (
                    <Toggle
                      key={option.id}
                      active={formationId === option.id}
                      onClick={() => setFormationId(option.id)}
                      className="w-full"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <FormationThumbnail
                          formation={option}
                          className="h-11 w-14 shrink-0 rounded-md"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-ink">
                            {option.positions.length} players
                          </span>
                          <span className="mt-0.5 block text-xs text-ink-muted">
                            {formationSubtitle(option)}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-ink-subtle">
                            {option.positions.map((position) => position.code).join(' · ')}
                          </span>
                        </span>
                      </span>
                    </Toggle>
                  ))}
                </div>
              </div>

              {/* Roster-aware guidance: the coach sees the consequence now, not
                  when a lineup fails to generate. */}
              {!enoughPlayers ? (
                <Notice
                  tone="critical"
                  title={`You have ${roster.length} players but this formation needs ${positionCount}.`}
                  action={
                    <div className="flex flex-wrap gap-2">
                      {formations
                        .filter((option) => option.positions.length <= roster.length)
                        .map((option) => (
                          <Button
                            key={option.id}
                            size="sm"
                            variant="primary"
                            onClick={() => setFormationId(option.id)}
                          >
                            Use {option.positions.length} players
                          </Button>
                        ))}
                      <Button size="sm" onClick={() => setStep(1)}>
                        Add more players
                      </Button>
                    </div>
                  }
                >
                  Pick a formation your roster can fill, or go back and add the players
                  you missed.
                </Notice>
              ) : (
                <Notice tone="brand">
                  {benchPerInning === 0
                    ? `With ${roster.length} players and ${positionCount} on defense, nobody sits — everyone plays all ${innings} innings.`
                    : `With ${roster.length} players and ${positionCount} on defense, ${benchPerInning} ${
                        benchPerInning === 1 ? 'player sits' : 'players sit'
                      } each inning. Dugout rotates that fairly and remembers it across the season.`}
                </Notice>
              )}
            </div>
          </Step>
        ) : null}

        {step === 3 ? (
          <Step
            title="Who can pitch and catch?"
            hint="This is the one thing worth getting right — Dugout needs a pitcher and a catcher for every inning."
          >
            <div className="space-y-6">
              <BatteryPicker
                label="Can pitch"
                players={roster}
                selected={(player) => player.canPitch}
                onToggle={(player) => setBattery(player.key, { canPitch: !player.canPitch })}
              />
              <BatteryPicker
                label="Can catch"
                players={roster}
                selected={(player) => player.canCatch}
                onToggle={(player) => setBattery(player.key, { canCatch: !player.canCatch })}
              />

              {pitchers.length === 0 || catchers.length === 0 ? (
                <Notice tone="critical" title="Pick at least one of each">
                  Without a pitcher and a catcher, Dugout can&apos;t fill the field.
                </Notice>
              ) : pitchers.length < 2 || catchers.length < 2 ? (
                <Notice tone="caution" title="That will work, but it's tight">
                  {pitchers.length < 2 ? 'One pitcher' : 'One catcher'} means the same
                  player covers every inning there. Two or three each gives Dugout room
                  to rotate and keeps playing time fair.
                </Notice>
              ) : (
                <Notice tone="positive">
                  {pitchers.length} {pitchers.length === 1 ? 'pitcher' : 'pitchers'} and{' '}
                  {catchers.length} {catchers.length === 1 ? 'catcher' : 'catchers'} —
                  plenty to rotate.
                </Notice>
              )}

              <p className="text-sm text-ink-subtle">
                Everyone can play every other position for now. If someone can&apos;t
                play first base or shortstop, you can mark that on the roster page in a
                few taps.
              </p>
            </div>
          </Step>
        ) : null}

        {step === 4 ? (
          <Step
            title="How do you want to coach?"
            hint="This sets the defaults for every game. You can change it per game, any time."
          >
            <div className="space-y-6">
              <PhilosophyPicker value={philosophy} onChange={setPhilosophy} />

              <div>
                <Label>Batting order</Label>
                <SegmentedControl
                  className="mt-1.5"
                  value={battingFormat}
                  onChange={setBattingFormat}
                  options={[
                    { value: 'CONTINUOUS', label: 'Continuous' },
                    { value: 'STARTERS_SUBS', label: 'Starters & subs' },
                  ]}
                />
                <p className="mt-2 text-sm text-ink-muted">
                  Most recreational leagues bat continuously: every player bats in turn,
                  whether or not they&apos;re on the field.
                </p>
              </div>
            </div>
          </Step>
        ) : null}

        {step === 5 ? (
          <Step
            title="You're ready"
            hint={
              adding
                ? "Here's the new team. Switch between teams from the header."
                : "Here's what Dugout will start with."
            }
          >
            <dl className="divide-y divide-border rounded-card border border-border">
              <Summary label="Team">
                {name} · {sport === 'BASEBALL' ? 'Baseball' : 'Softball'}
                {division ? ` · ${division}` : ''}
              </Summary>
              <Summary label="Roster">
                {roster.length} players · {pitchers.length} can pitch ·{' '}
                {catchers.length} can catch
              </Summary>
              <Summary label="Games">
                {innings} innings · {positionCount} on defense
              </Summary>
              <Summary label="Coaching style">
                {philosophy === 'EQUAL_PLAYING_TIME'
                  ? 'Equal Playing Time'
                  : philosophy === 'DEVELOPMENT'
                    ? 'Development'
                    : philosophy === 'COMPETITIVE'
                      ? 'Competitive'
                      : 'Balanced'}
                {battingFormat === 'CONTINUOUS' ? ' · continuous batting' : ''}
              </Summary>
            </dl>

            <Notice tone="brand" className="mt-4">
              Next: create a game, toggle anyone who isn&apos;t there, and hit Generate.
              After the game, record how many innings were actually played — that&apos;s
              what lets Dugout even out playing time across the season.
            </Notice>
          </Step>
        ) : null}
      </div>

      <RosterPhotoImport
        open={photoOpen}
        onClose={() => setPhotoOpen(false)}
        onConfirm={(imported) => {
          // Merge into the paste box, which is the single source of truth for
          // this step, so the review list and the text stay consistent.
          const added = toQuickAddText(
            imported.map((player) => ({ ...player, confident: true })),
          );
          setRosterText((current) => (current.trim() ? `${current.trim()}\n${added}` : added));
          setPhotoOpen(false);
        }}
      />

      {/* Sticky footer on mobile so Continue is always reachable. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:static sm:mt-8 sm:border-0 sm:bg-transparent sm:px-0 sm:backdrop-blur-none">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
          {step === 0 ? (
            <Link href="/">
              <Button variant="ghost">Cancel</Button>
            </Link>
          ) : (
            <Button variant="ghost" onClick={() => setStep((step - 1) as StepIndex)}>
              ← Back
            </Button>
          )}

          {step < 5 ? (
            <Button
              variant="primary"
              size="lg"
              disabled={!canContinue()}
              onClick={() => setStep((step + 1) as StepIndex)}
            >
              Continue
            </Button>
          ) : (
            <div className="flex flex-wrap justify-end gap-2">
              <Button disabled={saving} onClick={() => finish(false)}>
                Finish
              </Button>
              <Button
                variant="primary"
                size="lg"
                disabled={saving}
                onClick={() => finish(true)}
              >
                {saving ? 'Creating…' : 'Create first game'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
          Step {step + 1} of {STEPS.length}
        </p>
        <p className="text-xs font-medium text-ink-subtle">{STEPS[step]}</p>
      </div>
      <div className="mt-2 flex gap-1.5" role="presentation">
        {STEPS.map((label, index) => (
          <span
            key={label}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              index <= step ? 'bg-brand' : 'bg-border',
            )}
          />
        ))}
      </div>
    </div>
  );
}

function Step({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        {title}
      </h1>
      {hint ? <p className="mt-2 text-sm text-ink-muted">{hint}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function BatteryPicker({
  label,
  players,
  selected,
  onToggle,
}: {
  label: string;
  players: DraftPlayer[];
  selected: (player: DraftPlayer) => boolean;
  onToggle: (player: DraftPlayer) => void;
}) {
  const count = players.filter(selected).length;
  return (
    // Grouped and labelled so the two identical-looking pickers are
    // distinguishable to screen readers.
    <div role="group" aria-label={label}>
      <div className="flex items-baseline justify-between">
        <Label>{label}</Label>
        <span className="text-xs text-ink-subtle">{count} selected</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {players.map((player) => {
          const active = selected(player);
          return (
            <button
              key={player.key}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(player)}
              className={cn(
                'ring-focus rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'border-brand bg-brand text-ink-inverse'
                  : 'border-border bg-surface text-ink-muted hover:text-ink',
              )}
            >
              {player.firstName}
              {player.lastName ? ` ${player.lastName.charAt(0)}.` : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Summary({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
      <dt className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
        {label}
      </dt>
      <dd className="text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}
