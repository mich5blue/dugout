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
  const { ready, team, db, saveTeam, saveFormation, resetEverything, seedDemoTeam } =
    useDugout();
  const [editing, setEditing] = useState<Formation | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Team settings</h1>

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
        <CardHeader title="Data" description="Everything is stored on this device." />
        <div className="space-y-3 px-5 py-5">
          <Notice tone="neutral">
            Dugout keeps your team in this browser. Accounts and cloud sync are coming —
            until then, printing or exporting before you clear browser data is wise.
          </Notice>

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
              This removes your team, roster and every game on this device. It cannot be
              undone.
            </Notice>
          ) : (
            <Button variant="danger" onClick={() => setConfirmReset(true)}>
              Reset all data
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
