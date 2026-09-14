'use client';

import { useDugout } from '../providers';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  GROUP_STYLE,
  Input,
  Label,
  Modal,
  SegmentedControl,
  Textarea,
} from '@/components/ui';
import { RosterPhotoImport } from '@/components/RosterPhotoImport';
import {
  createPlayer,
  parseQuickAddRoster,
  playerName,
  toLastInitial,
} from '@/domain/factories';
import type { AbilityTier, Player } from '@/domain/types';
import { useTeamFormation } from '@/lib/hooks';
import { cn } from '@/lib/cn';
import Link from 'next/link';
import { playerNames } from '@/lib/playerNames';
import { useMemo, useState } from 'react';

const TIER_LABEL: Record<AbilityTier, string> = {
  CORE: 'Core',
  REGULAR: 'Regular',
  DEVELOPING: 'Developing',
};

export default function RosterPage() {
  const { ready, team, players, savePlayer, savePlayers, can } = useDugout();
  const formation = useTeamFormation();

  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkPositionId, setBulkPositionId] = useState<string | null>(null);

  const [quickText, setQuickText] = useState('');
  const [draft, setDraft] = useState({
    firstName: '',
    lastInitial: '',
    jerseyNumber: '',
  });

  /* Resolved against the roster so two players sharing a first name are
     separated by jersey number rather than both reading "Jack B.". */
  const names = useMemo(() => playerNames(players), [players]);

  const quickPreview = useMemo(
    () => parseQuickAddRoster(quickText, team?.id ?? 'preview'),
    [quickText, team?.id],
  );

  if (!ready) return null;

  if (!team) {
    return (
      <EmptyState
        title="No team yet"
        description="Create your team first, then add your roster."
        action={
          <Link href="/setup">
            <Button variant="primary">Create your team</Button>
          </Link>
        }
      />
    );
  }

  const bulkPosition = formation?.positions.find((p) => p.id === bulkPositionId) ?? null;

  const isEligibleAt = (player: Player, positionId: string): boolean => {
    const position = formation?.positions.find((p) => p.id === positionId);
    if (!position) return false;
    if (position.role === 'PITCHER') return player.canPitch;
    if (position.role === 'CATCHER') return player.canCatch;
    return (player.positionRatings[positionId]?.eligibility ?? 'ALLOWED') !== 'NEVER';
  };

  const toggleEligibility = async (player: Player, positionId: string) => {
    const position = formation?.positions.find((p) => p.id === positionId);
    if (!position) return;

    if (position.role === 'PITCHER') {
      await savePlayer({ ...player, canPitch: !player.canPitch });
      return;
    }
    if (position.role === 'CATCHER') {
      await savePlayer({ ...player, canCatch: !player.canCatch });
      return;
    }

    const current = player.positionRatings[positionId]?.eligibility ?? 'ALLOWED';
    const ratings = { ...player.positionRatings };
    if (current === 'NEVER') {
      ratings[positionId] = { positionId, eligibility: 'ALLOWED' };
    } else {
      ratings[positionId] = { positionId, eligibility: 'NEVER' };
    }
    await savePlayer({ ...player, positionRatings: ratings });
  };

  const addQuick = async () => {
    const parsed = parseQuickAddRoster(quickText, team.id);
    if (parsed.length === 0) return;
    await savePlayers(
      parsed.map((spec, index) =>
        createPlayer({ ...spec, createdAt: new Date(Date.now() + index).toISOString() }),
      ),
    );
    setQuickText('');
    setQuickAddOpen(false);
  };

  const addOne = async () => {
    if (!draft.firstName.trim()) return;
    await savePlayer(
      createPlayer({
        teamId: team.id,
        firstName: draft.firstName,
        lastInitial: toLastInitial(draft.lastInitial),
        jerseyNumber: draft.jerseyNumber,
      }),
    );
    setDraft({ firstName: '', lastInitial: '', jerseyNumber: '' });
    setAddOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-4xl text-ink sm:text-5xl">Roster</h1>
          <p className="mt-2 text-sm text-ink-muted">
            <span className="tnum">{players.filter((p) => p.active).length}</span> active ·{' '}
            <span className="tnum">{players.length}</span> total
          </p>
        </div>
        {/* Adding and importing players is the head coach's job. */}
        {can('roster:add') ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setPhotoOpen(true)}>Import from photo</Button>
            <Button onClick={() => setQuickAddOpen(true)}>Quick add</Button>
            <Button variant="primary" onClick={() => setAddOpen(true)}>
              Add player
            </Button>
          </div>
        ) : null}
      </div>

      {players.length === 0 ? (
        <Card>
          <EmptyState
            title="Add your players"
            description={
              can('roster:add')
                ? 'Snap a photo of your lineup card, paste a screenshot, or type the names.'
                : 'The head coach adds players to this team.'
            }
            action={
              can('roster:add') ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="primary" onClick={() => setPhotoOpen(true)}>
                    Import from photo
                  </Button>
                  <Button onClick={() => setQuickAddOpen(true)}>Paste names</Button>
                </div>
              ) : null
            }
          />
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Players"
            description="Tap a player to set positions, ability and pitching or catching."
          />
          {/*
            Two columns from `sm` up. A roster is short but the rows are, so a
            single full-width column spent most of a laptop screen on empty
            space and pushed the position setup below the fold.
          */}
          <ul className="grid sm:grid-cols-2">
            {players.map((player, index) => {
              const restricted = formation
                ? formation.positions.filter((position) => !isEligibleAt(player, position.id))
                : [];
              return (
                <li
                  key={player.id}
                  className={cn(
                    'border-b border-border',
                    // The right column keeps a divider between the two halves.
                    index % 2 === 0 && 'sm:border-r',
                  )}
                >
                  <Link
                    href={`/roster/${player.id}`}
                    className="ring-focus group flex h-full items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-muted"
                  >
                    <span className="tnum scoreboard w-9 shrink-0 text-lg text-ink-subtle">
                      {player.jerseyNumber ? `#${player.jerseyNumber}` : '—'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {names.plain(player.id)}
                        {!player.active ? (
                          <span className="ml-2 text-xs text-ink-subtle">Inactive</span>
                        ) : null}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge tone={player.overallTier === 'CORE' ? 'brand' : 'neutral'}>
                          {TIER_LABEL[player.overallTier]}
                        </Badge>
                        {player.canPitch ? <Badge tone="caution">Pitcher</Badge> : null}
                        {player.canCatch ? <Badge tone="caution">Catcher</Badge> : null}
                        {restricted.length > 0 ? (
                          <span className="text-xs text-ink-subtle">
                            Can&apos;t play {restricted.map((p) => p.code).join(', ')}
                          </span>
                        ) : (
                          <span className="text-xs text-ink-subtle">Can play anywhere</span>
                        )}
                      </span>
                    </span>
                    <span className="text-sm text-ink-subtle transition-colors group-hover:text-accent">
                      Edit
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {formation && players.length > 0 ? (
        <Card>
          <CardHeader
            title="Quick setup by position"
            description="Fastest way to set up a new team: pick a position, then tap everyone who can play it."
          />
          <div className="px-5 py-5">
            <div className="flex flex-wrap gap-1.5">
              {formation.positions.map((position) => {
                const style = GROUP_STYLE[position.group];
                const active = bulkPositionId === position.id;
                return (
                  <button
                    key={position.id}
                    type="button"
                    onClick={() => setBulkPositionId(active ? null : position.id)}
                    className={cn(
                      'ring-focus rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                      active
                        ? 'border-brand bg-brand text-ink-inverse'
                        : cn('border-border', style.chip, style.text),
                    )}
                  >
                    {position.code}
                  </button>
                );
              })}
            </div>

            {bulkPosition ? (
              <div className="mt-4">
                <p className="text-sm text-ink-muted">
                  Who can play <span className="font-medium text-ink">{bulkPosition.displayName}</span>?
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {players
                    .filter((player) => player.active)
                    .map((player) => {
                      const eligible = isEligibleAt(player, bulkPosition.id);
                      return (
                        <button
                          key={player.id}
                          type="button"
                          onClick={() => toggleEligibility(player, bulkPosition.id)}
                          className={cn(
                            'ring-focus rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                            eligible
                              ? 'border-brand bg-brand-soft text-ink'
                              : 'border-border bg-surface text-ink-subtle line-through',
                          )}
                        >
                          {player.firstName}
                        </button>
                      );
                    })}
                </div>
                <p className="mt-3 text-xs text-ink-subtle">
                  Struck-through players will never be assigned here.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink-subtle">
                Everyone can play everywhere until you say otherwise.
              </p>
            )}
          </div>
        </Card>
      ) : null}

      <RosterPhotoImport
        open={photoOpen}
        onClose={() => setPhotoOpen(false)}
        onConfirm={async (imported) => {
          await savePlayers(
            imported.map((spec, index) =>
              createPlayer({
                teamId: team.id,
                firstName: spec.firstName,
                lastInitial: spec.lastInitial,
                jerseyNumber: spec.jerseyNumber,
                createdAt: new Date(Date.now() + index).toISOString(),
              }),
            ),
          );
          setPhotoOpen(false);
        }}
      />

      <Modal
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        title="Quick add roster"
        footer={
          <>
            <Button onClick={() => setQuickAddOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={quickPreview.length === 0} onClick={addQuick}>
              Add {quickPreview.length > 0 ? quickPreview.length : ''}{' '}
              {quickPreview.length === 1 ? 'player' : 'players'}
            </Button>
          </>
        }
      >
        <Label htmlFor="quick-add">One player per line</Label>
        <Textarea
          id="quick-add"
          className="mt-1.5"
          rows={9}
          autoFocus
          placeholder={'Brody Borek\nRace Smith #12\nWeston Jones\nCalvin Miller'}
          value={quickText}
          onChange={(event) => setQuickText(event.target.value)}
        />
        <p className="mt-2 text-sm text-ink-muted">
          Jersey numbers are optional — &ldquo;Race Smith #12&rdquo;, &ldquo;12 Race
          Smith&rdquo; and &ldquo;Race Smith, 12&rdquo; all work.
        </p>
      </Modal>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add player"
        footer={
          <>
            <Button onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!draft.firstName.trim()} onClick={addOne}>
              Add player
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="first">First name</Label>
              <Input
                id="first"
                className="mt-1.5"
                autoFocus
                value={draft.firstName}
                onChange={(event) => setDraft({ ...draft, firstName: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="last">Last initial</Label>
              <Input
                id="last"
                className="mt-1.5"
                maxLength={1}
                value={draft.lastInitial}
                placeholder="B"
                onChange={(event) =>
                  setDraft({ ...draft, lastInitial: event.target.value })
                }
              />
            </div>
          </div>
          <div>
            <Label htmlFor="jersey">Jersey number</Label>
            <Input
              id="jersey"
              className="mt-1.5 w-28"
              inputMode="numeric"
              value={draft.jerseyNumber}
              onChange={(event) => setDraft({ ...draft, jerseyNumber: event.target.value })}
            />
          </div>
          <p className="text-sm text-ink-muted">
            Positions, ability and pitching or catching can be set after you add the
            player — everyone starts out able to play anywhere.
          </p>
        </div>
      </Modal>
    </div>
  );
}
