'use client';

import { useDugout } from '@/app/providers';
import { AssignmentPicker } from '@/components/game/AssignmentPicker';
import { BattingOrderPanel } from '@/components/game/BattingOrderPanel';
import { DiamondView } from '@/components/game/DiamondView';
import { GameDayView } from '@/components/game/GameDayView';
import { LineupGrid, PlayerGrid } from '@/components/game/LineupGrid';
import {
  AvailabilityPanel,
  PitchingPlanPanel,
  RulesPanel,
} from '@/components/game/GameSetupPanels';
import {
  ConflictList,
  QualitySummary,
  WhyThisLineup,
} from '@/components/game/QualitySummary';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Notice,
  SegmentedControl,
  Select,
  Spinner,
} from '@/components/ui';
import type { Game, PositionDefinition, TeamSettings } from '@/domain/types';
import { rotateBattingOrder, type OptimizationResult, type RelaxationSuggestion } from '@/optimizer';
import {
  generateLineup,
  setAssignment,
  setBattingOrder,
  setBattingSlotLocked,
  toggleLock,
} from '@/services/lineupService';
import { formatGameDate } from '@/lib/format';
import { buildGameView } from '@/lib/gameView';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';

type ViewMode = 'inning' | 'player' | 'diamond' | 'gameday';

export default function GamePage() {
  const params = useParams<{ gameId: string }>();
  const { ready, team, players, games, saveGame, goals, flags } = useDugout();

  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [stale, setStale] = useState(false);
  const [mode, setMode] = useState<ViewMode>('inning');
  const [diamondInning, setDiamondInning] = useState(1);
  const [setupOpen, setSetupOpen] = useState(true);
  const [frozenInnings, setFrozenInnings] = useState(0);
  const [picker, setPicker] = useState<{ inning: number; position: PositionDefinition } | null>(
    null,
  );

  const game = games.find((entry) => entry.id === params.gameId) ?? null;

  const view = useMemo(
    () => (game ? buildGameView(game, players, 'PLANNED') : null),
    [game, players],
  );

  if (!ready) return null;

  if (!team || !game || !view) {
    return (
      <EmptyState
        title="Game not found"
        action={
          <Link href="/">
            <Button variant="primary">Back to dashboard</Button>
          </Link>
        }
      />
    );
  }

  const update = async (next: Game) => {
    await saveGame(next);
    setStale(true);
  };

  const updateSettings = async (settings: TeamSettings) => {
    await saveGame({ ...game, settingsSnapshot: settings });
    setStale(true);
  };

  const run = async (seed?: number, freeze = frozenInnings) => {
    setGenerating(true);
    try {
      const outcome = await generateLineup({
        team,
        game,
        players,
        history: games,
        goals,
        flags,
        seed,
        frozenInnings: freeze,
      });
      setResult(outcome.result);
      if (outcome.result.ok) {
        await saveGame(outcome.game);
        setStale(false);
        setSetupOpen(false);
      }
    } finally {
      setGenerating(false);
    }
  };

  const applyRelaxation = async (suggestion: RelaxationSuggestion) => {
    const action = suggestion.action;
    if (!action) return;
    const settings = { ...game.settingsSnapshot };

    switch (action.type) {
      case 'REDUCE_MIN_DEFENSIVE_INNINGS':
        settings.minDefensiveInnings = action.to;
        break;
      case 'RELAX_INFIELD_REQUIREMENT':
        settings.infieldOpportunity = { mode: 'TARGET', innings: action.to };
        break;
      case 'ALLOW_CONSECUTIVE_BENCH':
        settings.noConsecutiveBench = false;
        break;
      case 'RAISE_PITCHING_CAP':
        settings.maxPitchingInningsPerPlayer = action.to;
        break;
      case 'RAISE_CATCHING_CAP':
        settings.maxCatcherInningsPerPlayer = action.to;
        break;
      default:
        return;
    }

    await saveGame({ ...game, settingsSnapshot: settings });
    setResult(null);
  };

  const previousGame = games
    .filter((entry) => entry.id !== game.id && entry.battingAssignments.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  const hasLineup = view.hasLineup;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/" className="ring-focus text-sm text-ink-muted hover:text-ink">
            ← {team.name}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            vs {game.opponent || 'TBD'}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {formatGameDate(game.date)} · {game.plannedInnings} innings ·{' '}
            {game.formationSnapshot.positions.length} defenders
            {game.status === 'COMPLETED'
              ? ` · ${game.actualInnings} played`
              : ''}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {hasLineup ? (
            <>
              <Link href={`/games/${game.id}/compare`}>
                <Button>Compare approaches</Button>
              </Link>
              <Link href={`/games/${game.id}/print`}>
                <Button>Print</Button>
              </Link>
              <Link href={`/games/${game.id}/record`}>
                <Button>
                  {game.status === 'COMPLETED' ? 'Edit results' : 'Record results'}
                </Button>
              </Link>
            </>
          ) : null}
          <Button
            variant="primary"
            size="md"
            disabled={generating}
            onClick={() => run(hasLineup ? game.optimizerSeed : undefined)}
          >
            {generating ? (
              <>
                <Spinner /> Working…
              </>
            ) : hasLineup ? (
              'Rebalance'
            ) : (
              'Generate lineup'
            )}
          </Button>
        </div>
      </div>

      {result && !result.ok ? (
        <ConflictList
          conflicts={result.conflicts}
          relaxations={result.relaxations}
          onApply={applyRelaxation}
        />
      ) : null}

      {result && result.ok ? (
        <ConflictList conflicts={result.conflicts} relaxations={[]} />
      ) : null}

      {stale && hasLineup ? (
        <Notice
          tone="caution"
          title="You've made changes since this lineup was generated."
          action={
            <Button size="sm" variant="primary" disabled={generating} onClick={() => run(game.optimizerSeed)}>
              Rebalance
            </Button>
          }
        >
          Rebalance keeps every locked assignment and re-optimizes the rest.
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="ghost" onClick={() => setSetupOpen((value) => !value)}>
          {setupOpen ? 'Hide game setup' : 'Game setup'}
        </Button>

        {hasLineup ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={generating}
              onClick={() => run(Math.floor(Date.now() % 100000))}
            >
              Generate another
            </Button>
            {game.plannedInnings > 1 ? (
              <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                Keep innings
                <Select
                  className="h-8 w-16"
                  value={frozenInnings}
                  onChange={(event) => setFrozenInnings(Number(event.target.value))}
                >
                  {Array.from({ length: game.plannedInnings }, (_, i) => i).map((value) => (
                    <option key={value} value={value}>
                      {value === 0 ? 'None' : `1–${value}`}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
          </div>
        ) : null}
      </div>

      {setupOpen ? (
        <div className="space-y-4">
          <AvailabilityPanel game={game} players={players} onChange={update} />
          <PitchingPlanPanel game={game} players={players} onChange={update} />
          <RulesPanel
            settings={game.settingsSnapshot}
            innings={game.plannedInnings}
            onChange={updateSettings}
          />
        </div>
      ) : null}

      {hasLineup ? (
        <>
          <Card>
            <CardHeader
              title="Defensive rotation"
              action={
                <SegmentedControl<ViewMode>
                  size="sm"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'inning', label: 'By inning' },
                    { value: 'player', label: 'By player' },
                    { value: 'diamond', label: 'Diamond' },
                    { value: 'gameday', label: 'Game day' },
                  ]}
                />
              }
            />
            <div className="px-2 py-3 sm:px-4">
              {mode === 'inning' ? (
                <LineupGrid
                  view={view}
                  onSelectCell={(inning, position) => setPicker({ inning, position })}
                  onToggleLock={async (inning, position) => {
                    await saveGame(toggleLock(game, inning, position.id));
                  }}
                />
              ) : null}
              {mode === 'player' ? <PlayerGrid view={view} /> : null}
              {mode === 'diamond' ? (
                <div className="space-y-3 px-2 py-1">
                  <SegmentedControl
                    size="sm"
                    value={String(diamondInning)}
                    onChange={(value) => setDiamondInning(Number(value))}
                    options={view.innings.map((inning) => ({
                      value: String(inning),
                      label: `Inn ${inning}`,
                    }))}
                  />
                  <DiamondView
                    view={view}
                    inning={diamondInning}
                    onSelectPosition={(position) =>
                      setPicker({ inning: diamondInning, position })
                    }
                    onAssign={async (positionId, playerId) => {
                      await update(
                        setAssignment(game, diamondInning, positionId, playerId),
                      );
                    }}
                    onBench={async (positionId) => {
                      await update(setAssignment(game, diamondInning, positionId, null));
                    }}
                  />
                </div>
              ) : null}
              {mode === 'gameday' ? (
                <div className="px-2 py-1">
                  <GameDayView view={view} />
                </div>
              ) : null}
            </div>
            {mode === 'inning' ? (
              <p className="border-t border-border px-5 py-3 text-xs text-ink-subtle">
                Tap any player to swap or bench them. The circle locks an assignment so
                Rebalance leaves it alone.
              </p>
            ) : null}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <BattingOrderPanel
              game={game}
              players={players}
              canRotate={Boolean(previousGame)}
              onReorder={async (playerIds) => {
                await update(
                  setBattingOrder(
                    game,
                    playerIds.map((playerId, index) => ({ playerId, battingSlot: index + 1 })),
                  ),
                );
              }}
              onToggleLock={async (playerId) => {
                const current = game.battingAssignments.find(
                  (entry) => entry.playerId === playerId,
                );
                await saveGame(setBattingSlotLocked(game, playerId, !current?.locked));
              }}
              onPhilosophyChange={async (battingPhilosophy) => {
                await updateSettings({ ...game.settingsSnapshot, battingPhilosophy });
              }}
              onRotate={async (offset) => {
                if (!previousGame) return;
                const availableIds = view.players
                  .filter((player) => view.isAvailable(player.id, 1) || true)
                  .filter((player) => {
                    const gp = game.gamePlayers.find((entry) => entry.playerId === player.id);
                    return gp?.available ?? false;
                  })
                  .map((player) => player.id);
                const rotated = rotateBattingOrder(
                  previousGame.battingAssignments,
                  offset,
                  availableIds,
                );
                await update(setBattingOrder(game, rotated));
              }}
            />

            <div className="space-y-4">
              {result?.quality && result.quality.metrics.length > 0 ? (
                <QualitySummary quality={result.quality} />
              ) : null}
              {result ? <WhyThisLineup explanations={result.explanations} /> : null}
            </div>
          </div>
        </>
      ) : (
        <Card>
          <EmptyState
            title="No lineup yet"
            description="Check who's playing, choose how you want to coach, then generate. It takes about a second."
            action={
              <Button variant="primary" size="lg" disabled={generating} onClick={() => run()}>
                {generating ? (
                  <>
                    <Spinner /> Building lineup…
                  </>
                ) : (
                  'Generate lineup'
                )}
              </Button>
            }
          />
        </Card>
      )}

      {picker ? (
        <AssignmentPicker
          view={view}
          inning={picker.inning}
          position={picker.position}
          onClose={() => setPicker(null)}
          onAssign={async (playerId) => {
            await update(setAssignment(game, picker.inning, picker.position.id, playerId));
          }}
          onBench={async () => {
            await update(setAssignment(game, picker.inning, picker.position.id, null));
          }}
          onOverride={async (playerId) => {
            const withOverride: Game = {
              ...game,
              eligibilityOverrides: [
                ...game.eligibilityOverrides,
                { playerId, positionId: picker.position.id },
              ],
            };
            await update(
              setAssignment(withOverride, picker.inning, picker.position.id, playerId),
            );
            setPicker(null);
          }}
        />
      ) : null}
    </div>
  );
}
