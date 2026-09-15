'use client';

import { useDugout } from '@/app/providers';
import { FormationEditor } from '@/components/FormationEditor';
import { PhilosophyPicker, RulesPanel } from '@/components/game/GameSetupPanels';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Label,
  Notice,
  SegmentedControl,
  Select,
  Toggle,
} from '@/components/ui';
import { createId } from '@/domain/factories';
import {
  deriveCustomFormation,
  formationSubtitle,
  getSystemFormation,
  systemFormationsForSport,
} from '@/domain/formations';
import { FormationThumbnail } from '@/components/FormationThumbnail';
import type { BattingFormat, Formation, Sport } from '@/domain/types';
import { applyPhilosophy } from '@/domain/weights';
import Link from 'next/link';
import { useMemo, useState } from 'react';

export default function SettingsPage() {
  const {
    ready,
    team,
    teams,
    db,
    saveTeam,
    saveFormation,
    removeTeam,
    backend,
    resetEverything,
    seedDemoTeam,
    can,
  } =
    useDugout();
  const [editing, setEditing] = useState<Formation | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDeleteTeam, setConfirmDeleteTeam] = useState(false);

  const formations = useMemo(() => {
    if (!team) return [];
    const custom = db.formations.filter(
      (formation) => formation.teamId === team.id && formation.sport === team.sport,
    );
    return [...systemFormationsForSport(team.sport), ...custom];
  }, [db.formations, team]);

  if (!ready) return null;

  if (!team) {
    return (
      <EmptyState
        title="No team yet"
        action={
          <Link href="/setup">
            <Button variant="primary">Create your team</Button>
          </Link>
        }
      />
    );
  }

  const update = (changes: Partial<typeof team>) => saveTeam({ ...team, ...changes });

  const startCustomFrom = (source: Formation) => {
    const id = createId('form');
    setEditing(
      deriveCustomFormation(source, team.id, `${source.name} (custom)`, id),
    );
  };

  if (!can('team:edit')) {
    return (
      <div className="space-y-6">
        <h1 className="display text-4xl text-ink sm:text-5xl">Team settings</h1>
        <Notice tone="caution" title="Only the head coach can change team settings">
          You can see the roster and every lineup, and you can set where players
          can play and who is a core player. Team name, formation, rules and
          coaching philosophy belong to the head coach.
        </Notice>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="display text-4xl text-ink sm:text-5xl">Team settings</h1>

      <Card>
        <CardHeader title="Team" />
        <div className="space-y-4 px-5 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="name">Team name</Label>
              <Input
                id="name"
                className="mt-1.5"
                value={team.name}
                onChange={(event) => update({ name: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="season">Season</Label>
              <Input
                id="season"
                className="mt-1.5"
                value={team.seasonName}
                onChange={(event) => update({ seasonName: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="division">Age / division</Label>
              <Input
                id="division"
                className="mt-1.5"
                value={team.division}
                onChange={(event) => update({ division: event.target.value })}
              />
            </div>
            <div>
              <Label>Sport</Label>
              <SegmentedControl<Sport>
                className="mt-1.5"
                value={team.sport}
                onChange={(sport) => {
                  // Changing sport must also move to a formation that exists for it.
                  const next = systemFormationsForSport(sport)[0];
                  update({ sport, defaultFormationId: next?.id ?? team.defaultFormationId });
                }}
                options={[
                  { value: 'BASEBALL', label: 'Baseball' },
                  { value: 'SOFTBALL', label: 'Softball' },
                ]}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="innings">Default game length</Label>
              <Select
                id="innings"
                className="mt-1.5"
                value={team.defaultInnings}
                onChange={(event) => update({ defaultInnings: Number(event.target.value) })}
              >
                {[3, 4, 5, 6, 7, 9].map((value) => (
                  <option key={value} value={value}>
                    {value} innings
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Batting format</Label>
              <SegmentedControl<BattingFormat>
                className="mt-1.5"
                size="sm"
                value={team.settings.battingFormat}
                onChange={(battingFormat) =>
                  update({ settings: { ...team.settings, battingFormat } })
                }
                options={[
                  { value: 'CONTINUOUS', label: 'Continuous' },
                  { value: 'STARTERS_SUBS', label: 'Starters & subs' },
                ]}
              />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Defensive formation"
          description="Sets how many players take the field. Individual games can override it."
        />
        <div className="space-y-2 px-5 py-5">
          {formations.map((formation) => (
            <div
              key={formation.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-2"
            >
              <Toggle
                active={team.defaultFormationId === formation.id}
                onClick={() => update({ defaultFormationId: formation.id })}
                className="min-w-0 flex-1 border-0"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <FormationThumbnail
                    formation={formation}
                    className="h-11 w-14 shrink-0 rounded-md"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">
                        {formation.positions.length} players
                      </span>
                      {formation.isSystemPreset ? null : <Badge tone="brand">Custom</Badge>}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-muted">
                      {formationSubtitle(formation)}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-subtle">
                      {formation.positions.map((position) => position.code).join(' · ')}
                    </span>
                  </span>
                </span>
              </Toggle>

              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  formation.isSystemPreset
                    ? startCustomFrom(formation)
                    : setEditing(formation)
                }
              >
                {formation.isSystemPreset ? 'Customize' : 'Edit'}
              </Button>
            </div>
          ))}

          {editing ? (
            <div className="mt-4 rounded-xl border border-brand/40 bg-brand-soft/40 p-4">
              <FormationEditor
                formation={editing}
                onCancel={() => setEditing(null)}
                onSave={async (formation) => {
                  await saveFormation(formation);
                  await saveTeam({ ...team, defaultFormationId: formation.id });
                  setEditing(null);
                }}
              />
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Coaching philosophy"
          description="Sets the defaults for new games. You can change any game individually."
        />
        <div className="px-5 py-5">
          <PhilosophyPicker
            value={team.settings.philosophy}
            onChange={(philosophy) =>
              update({ settings: applyPhilosophy(team.settings, philosophy) })
            }
          />
        </div>
      </Card>

      <RulesPanel
        settings={team.settings}
        innings={team.defaultInnings}
        onChange={(settings) => update({ settings })}
      />

      <Card>
        <CardHeader
          title="Data"
          description={
            backend === 'firebase'
              ? 'Stored in your account.'
              : 'Everything is stored on this device.'
          }
        />
        <div className="space-y-3 px-5 py-5">
          {backend === 'firebase' ? (
            <Notice tone="neutral">
              Your team is saved to your account, so it follows you to any phone and
              your assistant coaches see the same lineups. Changes you make with no
              signal are queued and sync when you get one.
            </Notice>
          ) : (
            <Notice tone="caution">
              This copy of InningGrid has no account attached, so your team lives in this
              browser only — clearing browser data deletes it, and no other device can
              see it. Print anything you would not want to lose.
            </Notice>
          )}

          {teams.length > 1 ? (
            confirmDeleteTeam ? (
              <Notice
                tone="critical"
                title={`Delete ${team.name}?`}
                action={
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setConfirmDeleteTeam(false)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        await removeTeam(team.id);
                        setConfirmDeleteTeam(false);
                      }}
                    >
                      Delete this team
                    </Button>
                  </div>
                }
              >
                This removes {team.name}, its roster and its games. Your other{' '}
                {teams.length === 2 ? 'team is' : 'teams are'} untouched.
              </Notice>
            ) : (
              <Button onClick={() => setConfirmDeleteTeam(true)}>
                Delete {team.name}
              </Button>
            )
          ) : null}

          {confirmReset ? (
            <Notice
              tone="critical"
              title="Delete everything and start over?"
              action={
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setConfirmReset(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      resetEverything();
                      setConfirmReset(false);
                    }}
                  >
                    Delete everything
                  </Button>
                  <Button
                    size="sm"
                    onClick={async () => {
                      await seedDemoTeam();
                      setConfirmReset(false);
                    }}
                  >
                    Replace with demo team
                  </Button>
                </div>
              }
            >
              This removes{' '}
              {teams.length > 1 ? `all ${teams.length} teams` : 'your team'}, every
              roster and every game on this device. It cannot be undone.
            </Notice>
          ) : (
            <Button variant="danger" onClick={() => setConfirmReset(true)}>
              {teams.length > 1 ? 'Reset everything' : 'Reset all data'}
            </Button>
          )}
        </div>
      </Card>

      {/*
        Last card on the settings page, which is where someone lands when they
        have gone looking for an explanation of a control and not found one.
      */}
      <Card>
        <CardHeader
          title="Help and feedback"
          description="What every option does, and where to say something is wrong."
        />
        <div className="flex flex-wrap gap-2 px-5 pb-5">
          <Link href="/guide#options">
            <Button>Every option explained</Button>
          </Link>
          <Link href="/guide">
            <Button>How-to guide</Button>
          </Link>
          <Link href="/feedback">
            <Button variant="primary">Send feedback</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
