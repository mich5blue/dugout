'use client';

import { useDugout } from '@/app/providers';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  GROUP_STYLE,
  Input,
  Label,
  Notice,
  SegmentedControl,
  Select,
  Toggle,
} from '@/components/ui';
import { permittedPlayerChanges } from '@/domain/access';
import { createId, playerName, toLastInitial } from '@/domain/factories';
import { GROUP_LABEL } from '@/domain/formations';
import type { AbilityTier, Eligibility, GoalType, Player } from '@/domain/types';
import { getFairnessDebt } from '@/services/fairness';
import {
  getBattingSlotDistribution,
  getPlayerSeasonUsage,
} from '@/services/seasonStatistics';
import { cn } from '@/lib/cn';
import { formatSigned, percent } from '@/lib/format';
import { useTeamFormation } from '@/lib/hooks';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

const ELIGIBILITY_CYCLE: Eligibility[] = ['PREFERRED', 'ALLOWED', 'AVOID', 'NEVER'];

const ELIGIBILITY_STYLE: Record<Eligibility, { label: string; className: string }> = {
  PREFERRED: { label: 'Preferred', className: 'border-brand bg-brand text-ink-inverse' },
  ALLOWED: { label: 'Allowed', className: 'border-border bg-surface text-ink' },
  AVOID: { label: 'Avoid', className: 'border-caution/50 bg-caution-soft text-caution' },
  NEVER: { label: 'Never', className: 'border-critical/50 bg-critical-soft text-critical line-through' },
};

const TIER_OPTIONS: Array<{ value: AbilityTier; label: string }> = [
  { value: 'DEVELOPING', label: 'Developing' },
  { value: 'REGULAR', label: 'Regular' },
  { value: 'CORE', label: 'Core' },
];

export default function PlayerDetailPage() {
  const router = useRouter();
  const params = useParams<{ playerId: string }>();
  const { ready, team, players, games, goals, savePlayer, removePlayer, saveGoal, removeGoal, can, role } =
    useDugout();
  const formation = useTeamFormation();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const player = players.find((entry) => entry.id === params.playerId) ?? null;

  const usage = useMemo(() => getPlayerSeasonUsage(games), [games]);
  const debts = useMemo(() => getFairnessDebt(games, players), [games, players]);
  const battingStats = useMemo(() => getBattingSlotDistribution(games), [games]);

  const teamAverageDefensive = useMemo(() => {
    const active = players.filter((entry) => entry.active);
    if (active.length === 0) return 0;
    return (
      active.reduce((acc, entry) => acc + (usage[entry.id]?.defensiveInnings ?? 0), 0) /
      active.length
    );
  }, [players, usage]);

  if (!ready) return null;

  if (!team || !player) {
    return (
      <EmptyState
        title="Player not found"
        action={
          <Link href="/team">
            <Button variant="primary">Back to roster</Button>
          </Link>
        }
      />
    );
  }

  const record = usage[player.id];
  const debt = debts[player.id];
  const batting = battingStats[player.id];

  /*
    Filtered through the role, not merely hidden in the UI: an assistant's edit
    cannot carry a renamed player or a flipped active flag alongside the
    eligibility change it claims to be. The server must apply the same filter.
  */
  const update = (changes: Partial<Player>) =>
    savePlayer({ ...player, ...permittedPlayerChanges(role, changes) });

  const editsIdentity = can('player:editIdentity');

  const cycleEligibility = (positionId: string) => {
    const current = player.positionRatings[positionId]?.eligibility ?? 'ALLOWED';
    const next = ELIGIBILITY_CYCLE[(ELIGIBILITY_CYCLE.indexOf(current) + 1) % 4];
    update({
      positionRatings: {
        ...player.positionRatings,
        [positionId]: { positionId, eligibility: next },
      },
    });
  };

  const clearExceptions = () =>
    update({
      positionRatings: {},
      canPitch: player.canPitch,
      canCatch: player.canCatch,
    });

  const playerGoals = goals.filter((goal) => goal.playerId === player.id);

  const totalDefensive = record?.defensiveInnings ?? 0;
  const share = (count: number) =>
    totalDefensive === 0 ? '—' : percent(count / totalDefensive);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/team" className="ring-focus text-sm text-ink-muted hover:text-ink">
            ← Roster
          </Link>
          <h1 className="display mt-1.5 text-4xl text-ink sm:text-5xl">
            {playerName(player)}
            {player.jerseyNumber ? (
              <span className="ml-2 text-ink-subtle">#{player.jerseyNumber}</span>
            ) : null}
          </h1>
        </div>
        {editsIdentity ? (
          <div className="flex gap-2">
            <Button
              variant={player.active ? 'secondary' : 'primary'}
              onClick={() => update({ active: !player.active })}
            >
              {player.active ? 'Mark inactive' : 'Mark active'}
            </Button>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Remove
            </Button>
          </div>
        ) : null}
      </div>

      {confirmDelete ? (
        <Notice
          tone="critical"
          title={`Remove ${playerName(player)} from the roster?`}
          action={
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  await removePlayer(player.id);
                  router.push('/team');
                }}
              >
                Remove player
              </Button>
            </div>
          }
        >
          This removes the player from your roster. Past games keep their recorded
          results. Marking the player inactive instead keeps their season history
          visible.
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Details" />
          <div className="space-y-4 px-5 py-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-1">
                <Label htmlFor="first">First name</Label>
                <Input
                  id="first"
                  className="mt-1.5"
                  disabled={!editsIdentity}
                  value={player.firstName}
                  onChange={(event) => update({ firstName: event.target.value })}
                />
              </div>
              <div className="sm:col-span-1">
                <Label htmlFor="last">Last initial</Label>
                <Input
                  id="last"
                  className="mt-1.5"
                  disabled={!editsIdentity}
                  value={player.lastInitial ?? ''}
                  maxLength={1}
                  onChange={(event) =>
                    update({ lastInitial: toLastInitial(event.target.value) })
                  }
                />
              </div>
              <div className="sm:col-span-1">
                <Label htmlFor="jersey">Jersey</Label>
                <Input
                  id="jersey"
                  className="mt-1.5"
                  inputMode="numeric"
                  disabled={!editsIdentity}
                  value={player.jerseyNumber ?? ''}
                  onChange={(event) => update({ jerseyNumber: event.target.value })}
                />
              </div>
            </div>

            <div>
              <Label>Defensive ability</Label>
              <SegmentedControl
                label="Defensive ability"
                className="mt-1.5"
                value={player.overallTier}
                onChange={(value) => update({ overallTier: value })}
                options={TIER_OPTIONS}
              />
            </div>

            <div className={cn(!editsIdentity && 'pointer-events-none opacity-50')}>
              <Label>Hitting</Label>
              <SegmentedControl
                label="Hitting"
                className="mt-1.5"
                value={player.offensiveTier}
                onChange={(value) => update({ offensiveTier: value })}
                options={TIER_OPTIONS}
              />
            </div>

            <Notice tone="neutral">
              Ability is for your eyes only. It never appears on a printed lineup or
              anything you share.
            </Notice>
          </div>
        </Card>

        <Card>
          <CardHeader title="Pitching & catching" />
          <div className="space-y-3 px-5 py-5">
            <Toggle
              active={player.canPitch}
              onClick={() => update({ canPitch: !player.canPitch })}
              className="w-full"
            >
              <span className="text-sm font-medium text-ink">Can pitch</span>
              <span className="text-sm text-ink-muted">
                {player.canPitch ? 'Yes' : 'No'}
              </span>
            </Toggle>

            {player.canPitch ? (
              <div className="grid gap-3 pl-1 sm:grid-cols-2">
                <Toggle
                  active={player.preferredPitcher}
                  onClick={() => update({ preferredPitcher: !player.preferredPitcher })}
                >
                  <span className="text-sm text-ink">Preferred pitcher</span>
                </Toggle>
                <div>
                  <Label htmlFor="max-pitch">Max innings / game</Label>
                  <Input
                    id="max-pitch"
                    className="mt-1.5"
                    inputMode="numeric"
                    placeholder="No limit"
                    value={player.maxPitchingInnings ?? ''}
                    onChange={(event) =>
                      update({
                        maxPitchingInnings:
                          event.target.value === '' ? undefined : Number(event.target.value),
                      })
                    }
                  />
                </div>
              </div>
            ) : null}

            <Toggle
              active={player.canCatch}
              onClick={() => update({ canCatch: !player.canCatch })}
              className="w-full"
            >
              <span className="text-sm font-medium text-ink">Can catch</span>
              <span className="text-sm text-ink-muted">
                {player.canCatch ? 'Yes' : 'No'}
              </span>
            </Toggle>

            {player.canCatch ? (
              <div className="grid gap-3 pl-1 sm:grid-cols-2">
                <Toggle
                  active={player.preferredCatcher}
                  onClick={() => update({ preferredCatcher: !player.preferredCatcher })}
                >
                  <span className="text-sm text-ink">Preferred catcher</span>
                </Toggle>
                <div>
                  <Label htmlFor="max-catch">Max innings / game</Label>
                  <Input
                    id="max-catch"
                    className="mt-1.5"
                    inputMode="numeric"
                    placeholder="No limit"
                    value={player.maxCatchingInnings ?? ''}
                    onChange={(event) =>
                      update({
                        maxCatchingInnings:
                          event.target.value === '' ? undefined : Number(event.target.value),
                      })
                    }
                  />
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      {formation ? (
        <Card>
          <CardHeader
            title="Positions"
            description="Everyone can play anywhere by default. Tap a position to cycle Preferred → Allowed → Avoid → Never."
            action={
              Object.keys(player.positionRatings).length > 0 ? (
                <Button size="sm" variant="ghost" onClick={clearExceptions}>
                  Can play anywhere
                </Button>
              ) : null
            }
          />
          <div className="space-y-4 px-5 py-5">
            {(['BATTERY', 'INFIELD', 'OUTFIELD'] as const).map((group) => {
              const positions = formation.positions.filter((p) => p.group === group);
              if (positions.length === 0) return null;
              return (
                <div key={group}>
                  <p className={cn('text-xs font-semibold uppercase', GROUP_STYLE[group].text)}>
                    {GROUP_LABEL[group]}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {positions.map((position) => {
                      const roleBlocked =
                        (position.role === 'PITCHER' && !player.canPitch) ||
                        (position.role === 'CATCHER' && !player.canCatch);
                      const eligibility: Eligibility = roleBlocked
                        ? 'NEVER'
                        : player.positionRatings[position.id]?.eligibility ?? 'ALLOWED';
                      const style = ELIGIBILITY_STYLE[eligibility];
                      return (
                        <button
                          key={position.id}
                          type="button"
                          disabled={roleBlocked}
                          onClick={() => cycleEligibility(position.id)}
                          title={
                            roleBlocked
                              ? `Turn on "Can ${position.role === 'PITCHER' ? 'pitch' : 'catch'}" first`
                              : style.label
                          }
                          className={cn(
                            'ring-focus min-w-20 rounded-lg border px-3 py-2 text-center transition-colors disabled:opacity-60',
                            style.className,
                          )}
                        >
                          <span className="block text-sm font-semibold">{position.code}</span>
                          <span className="mt-0.5 block text-[11px] opacity-80">
                            {roleBlocked ? 'Not eligible' : style.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Development focus"
          description="Goals become objectives the optimizer works toward."
        />
        <div className="px-5 py-5">
          {playerGoals.length > 0 ? (
            <ul className="mb-4 divide-y divide-border rounded-lg border border-border">
              {playerGoals.map((goal) => {
                const position = formation?.positions.find((p) => p.id === goal.positionId);
                return (
                  <li key={goal.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="flex-1 text-sm text-ink">
                      {position ? position.displayName : GROUP_LABEL[goal.positionGroup ?? 'INFIELD']}
                      <span className="text-ink-muted">
                        {' '}
                        ·{' '}
                        {goal.goalType === 'MORE_REPS'
                          ? 'more reps'
                          : goal.goalType === 'FEWER_REPS'
                            ? 'fewer reps'
                            : 'at least 1 inning'}
                      </span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => removeGoal(goal.id)}>
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {formation ? (
            <AddGoalRow
              positions={formation.positions.map((p) => ({ id: p.id, label: p.displayName }))}
              onAdd={(positionId, goalType) =>
                saveGoal({
                  id: createId('goal'),
                  teamId: team.id,
                  playerId: player.id,
                  positionId,
                  positionGroup: null,
                  goalType,
                  priority: 2,
                  active: true,
                })
              }
            />
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader title="Season" description="Recorded from what actually happened." />
        {record && record.games > 0 ? (
          <div className="px-5 py-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Games" value={String(record.games)} />
              <Stat
                label="Defensive innings"
                value={String(record.defensiveInnings)}
                hint={`Team average ${teamAverageDefensive.toFixed(1)}`}
              />
              <Stat label="Bench innings" value={String(record.benchInnings)} />
              <Stat
                label="Unique positions"
                value={String(record.uniquePositionCodes)}
              />
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
                  Position distribution
                </p>
                <ul className="mt-2 space-y-1">
                  {Object.entries(record.byPositionCode)
                    .sort((a, b) => b[1] - a[1])
                    .map(([code, count]) => (
                      <li key={code} className="flex items-center gap-3 text-sm">
                        <span className="tnum w-10 font-medium text-ink">{code}</span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                          <span
                            className="block h-full rounded-full bg-accent"
                            style={{
                              width: `${Math.round(
                                (count / Math.max(1, record.defensiveInnings)) * 100,
                              )}%`,
                            }}
                          />
                        </span>
                        <span className="tnum w-12 text-right text-ink-muted">{count}</span>
                      </li>
                    ))}
                </ul>
              </div>

              <div>
                <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
                  Shares
                </p>
                <dl className="mt-2 space-y-1.5 text-sm">
                  <Row label="Infield" value={share(record.byGroup.INFIELD)} />
                  <Row label="Outfield" value={share(record.byGroup.OUTFIELD)} />
                  <Row label="Battery" value={share(record.byGroup.BATTERY)} />
                  <Row
                    label="Bench"
                    value={
                      record.availableInnings === 0
                        ? '—'
                        : percent(record.benchInnings / record.availableInnings)
                    }
                  />
                  <Row
                    label="Average batting slot"
                    value={batting?.averageSlot ? batting.averageSlot.toFixed(1) : '—'}
                  />
                </dl>

                {debt ? (
                  <div className="mt-4 rounded-lg border border-border bg-surface-muted px-3 py-2">
                    <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
                      Fairness debt
                    </p>
                    <dl className="mt-1.5 space-y-1 text-sm">
                      <Row label="Defensive innings" value={formatSigned(debt.defensiveDebt)} />
                      <Row label="Infield innings" value={formatSigned(debt.infieldDebt)} />
                      <Row label="Bench innings" value={formatSigned(-debt.benchDebt)} />
                    </dl>
                    <p className="mt-2 text-xs text-ink-subtle">
                      Positive means InningGrid owes more of it, and will favour this player
                      in upcoming games.
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            title="No games played yet"
            description="Season totals appear once you record a completed game."
          />
        )}
      </Card>
    </div>
  );
}

function AddGoalRow({
  positions,
  onAdd,
}: {
  positions: Array<{ id: string; label: string }>;
  onAdd: (positionId: string, goalType: GoalType) => void;
}) {
  const [positionId, setPositionId] = useState(positions[0]?.id ?? '');
  const [goalType, setGoalType] = useState<GoalType>('MORE_REPS');

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-40 flex-1">
        <Label htmlFor="goal-position">Position</Label>
        <Select
          id="goal-position"
          className="mt-1.5"
          value={positionId}
          onChange={(event) => setPositionId(event.target.value)}
        >
          {positions.map((position) => (
            <option key={position.id} value={position.id}>
              {position.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="min-w-40 flex-1">
        <Label htmlFor="goal-type">Goal</Label>
        <Select
          id="goal-type"
          className="mt-1.5"
          value={goalType}
          onChange={(event) => setGoalType(event.target.value as GoalType)}
        >
          <option value="MORE_REPS">More reps</option>
          <option value="AT_LEAST_ONE_INNING">At least 1 inning</option>
          <option value="FEWER_REPS">Fewer reps</option>
        </Select>
      </div>
      <Button
        onClick={() => {
          if (positionId) onAdd(positionId, goalType);
        }}
      >
        Add goal
      </Button>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">{label}</p>
      <p className="tnum mt-1 text-2xl font-semibold text-ink">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-subtle">{hint}</p> : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="tnum font-medium text-ink">{value}</dd>
    </div>
  );
}
