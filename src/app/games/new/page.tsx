'use client';

import { useDugout } from '@/app/providers';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Label,
  SegmentedControl,
  Toggle,
} from '@/components/ui';
import { createGame } from '@/domain/factories';
import {
  formationSubtitle,
  getSystemFormation,
  systemFormationsForSport,
} from '@/domain/formations';
import { FormationThumbnail } from '@/components/FormationThumbnail';
import { todayIso } from '@/lib/format';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

/** New game (spec section 16). Team defaults, overridable per game. */
export default function NewGamePage() {
  const router = useRouter();
  const { ready, team, players, activePlayers, db, saveGame } = useDugout();

  const [opponent, setOpponent] = useState('');
  const [date, setDate] = useState(todayIso());
  const [innings, setInnings] = useState<number | null>(null);
  const [formationId, setFormationId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  if (activePlayers.length === 0) {
    return (
      <EmptyState
        title="Add your roster first"
        description="Dugout needs players before it can build a lineup."
        action={
          <Link href="/roster">
            <Button variant="primary">Add players</Button>
          </Link>
        }
      />
    );
  }

  const effectiveInnings = innings ?? team.defaultInnings;
  const effectiveFormationId = formationId ?? team.defaultFormationId;

  const create = async () => {
    const formation =
      formations.find((entry) => entry.id === effectiveFormationId) ??
      getSystemFormation(effectiveFormationId);
    if (!formation) return;

    setSaving(true);
    try {
      const game = createGame({
        teamId: team.id,
        opponent,
        date,
        plannedInnings: effectiveInnings,
        formation,
        settings: team.settings,
        players,
        seed: Math.floor(Date.now() % 100000),
      });
      await saveGame(game);
      router.push(`/games/${game.id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/" className="ring-focus text-sm text-ink-muted hover:text-ink">
          ← {team.name}
        </Link>
        <h1 className="display mt-1.5 text-4xl text-ink sm:text-5xl">New game</h1>
      </div>

      <Card>
        <CardHeader title="Game" />
        <div className="space-y-4 px-5 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="opponent">Opponent</Label>
              <Input
                id="opponent"
                className="mt-1.5"
                autoFocus
                placeholder="Cardinals"
                value={opponent}
                onChange={(event) => setOpponent(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                className="mt-1.5"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
          </div>

          <div>
            <Label>Innings</Label>
            <SegmentedControl
              className="mt-1.5"
              value={String(effectiveInnings)}
              onChange={(value) => setInnings(Number(value))}
              options={[
                { value: '3', label: '3' },
                { value: '4', label: '4' },
                { value: '5', label: '5' },
                { value: '6', label: '6' },
                { value: '7', label: '7' },
              ]}
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Formation"
          description="Defaults to your team formation. Change it for tournaments that field a different number of players."
        />
        <div className="space-y-2 px-5 py-5">
          {formations.map((formation) => (
            <Toggle
              key={formation.id}
              active={effectiveFormationId === formation.id}
              onClick={() => setFormationId(formation.id)}
              className="w-full"
            >
              <span className="flex min-w-0 items-center gap-3">
                <FormationThumbnail
                  formation={formation}
                  className="h-11 w-14 shrink-0 rounded-md"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">
                    {formation.positions.length} players
                    {formation.id === team.defaultFormationId ? (
                      <span className="ml-2 text-xs font-normal text-brand">
                        Team default
                      </span>
                    ) : null}
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
          ))}
        </div>
      </Card>

      <div className="flex justify-end gap-2 pb-6">
        <Link href="/">
          <Button>Cancel</Button>
        </Link>
        <Button variant="primary" size="lg" disabled={saving} onClick={create}>
          {saving ? 'Creating…' : 'Create game'}
        </Button>
      </div>
    </div>
  );
}
