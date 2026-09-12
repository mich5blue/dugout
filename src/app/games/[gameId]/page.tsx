'use client';

import { useDugout } from '@/app/providers';
import { AssignmentPicker } from '@/components/game/AssignmentPicker';
import { AttendanceBar } from '@/components/game/AttendanceBar';
import { BattingOrderPanel } from '@/components/game/BattingOrderPanel';
import { FieldView } from '@/components/game/FieldView';
import { LiveView } from '@/components/game/LiveView';
import { ShareActions } from '@/components/game/ShareActions';
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

/**
 * The four ways to read a lineup. `field` and `live` are the two alternative
 * directions the redesign kept as first-class options: `field` puts the
 * diamond in charge, `live` is the phone-in-the-dugout surface.
 */
type ViewMode = 'inning' | 'player' | 'field' | 'live';

export default function GamePage() {
  const params = useParams<{ gameId: string }>();
  const { ready, team, players, games, saveGame, goals, flags, can } = useDugout();

  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [stale, setStale] = useState(false);
  const [mode, setMode] = useState<ViewMode>('inning');
  const [fieldInning, setFieldInning] = useState(1);
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
  /* An assistant can read every lineup but cannot change one. */
  const editsGame = can('game:edit');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <Link href="/" className="ring-focus text-sm text-ink-muted hover:text-ink">
            ← {team.name}
          </Link>
          {/*
            The matchup as a scoreboard title: a quiet "vs" against the
            opponent's name at display size, so the page announces which game
            it is from across a room.
          */}
          {/*
            aria-label because the visual gap between the two spans is flex
            spacing, not whitespace: without it the accessible name computes as
            "vsCardinals" and is announced that way.
          */}
          <h1
            aria-label={`vs ${game.opponent || 'TBD'}`}
            className="mt-1.5 flex flex-wrap items-baseline gap-2"
          >
            <span className="scoreboard text-2xl text-ink-subtle">vs</span>
            <span className="display text-4xl text-ink sm:text-5xl">
              {game.opponent || 'TBD'}
            </span>
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
            <span>{formatGameDate(game.date)}</span>
            <span aria-hidden className="text-ink-subtle">
              ·
            </span>
            <span className="tnum">{game.plannedInnings} innings</span>
            <span aria-hidden className="text-ink-subtle">
              ·
            </span>
            <span className="tnum">
              {game.formationSnapshot.positions.length} defenders
            </span>
            {game.status === 'COMPLETED' ? (
              <span className="eyebrow rounded bg-positive-soft px-1.5 py-0.5 text-positive">
                {game.actualInnings} played
              </span>
            ) : null}
          </p>
        </div>

        {/*
          One filled action. The rest are links to other surfaces, so they read
          as secondary — the old header gave four chips equal weight and hid
          which one the coach was meant to press.
        */}
        <div className="flex flex-wrap items-center gap-2">
          {hasLineup ? (
            <>
              <ShareActions team={team} game={game} players={players} />
              <Link href={`/games/${game.id}/compare`}>
                <Button size="sm">Compare</Button>
              </Link>
              <Link href={`/games/${game.id}/print`}>
                <Button size="sm">Print</Button>
              </Link>
              <Link href={`/games/${game.id}/record`}>
                <Button size="sm">
                  {game.status === 'COMPLETED' ? 'Edit results' : 'Record results'}
                </Button>
              </Link>
            </>
          ) : null}
          {/*
            Once a lineup exists, Rebalance lives in the attendance bar beside
            the change that prompts it. A second one up here just made the coach
            choose between two identical buttons.
          */}
          {editsGame && !hasLineup ? (
            <Button variant="primary" size="md" disabled={generating} onClick={() => run()}>
              {generating ? (
                <>
                  <Spinner /> Working…
                </>
              ) : (
                'Generate lineup'
              )}
            </Button>
          ) : null}
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        {editsGame ? (
        <Button size="sm" variant="ghost" onClick={() => setSetupOpen((value) => !value)}>
          {setupOpen ? 'Hide game setup' : 'Game setup'}
        </Button>
        ) : <span />}

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

      {setupOpen && editsGame ? (
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

      {hasLineup && editsGame ? (
        <AttendanceBar
          game={game}
          players={players}
          busy={generating}
          changed={stale}
          onChange={update}
          onRebalance={() => run(game.optimizerSeed)}
        />
      ) : null}

      {hasLineup ? (
        <>
          <Card className="rise">
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
                    { value: 'field', label: 'Field' },
                    { value: 'live', label: 'Live' },
                  ]}
                />
              }
            />
            <div className="px-2 py-3 sm:px-4">
              {mode === 'inning' ? (
                <LineupGrid
                  view={view}
                  onSelectCell={
                    editsGame
                      ? (inning, position) => setPicker({ inning, position })
                      : undefined
                  }
                  readOnly={!editsGame}
                  onToggleLock={async (inning, position) => {
                    await saveGame(toggleLock(game, inning, position.id));
                  }}
                />
              ) : null}
              {mode === 'player' ? <PlayerGrid view={view} /> : null}
              {mode === 'field' ? (
                <div className="px-2 py-1">
                  <FieldView
                    view={view}
                    inning={fieldInning}
                    onInningChange={setFieldInning}
                    onSelectPosition={(position) =>
                      setPicker({ inning: fieldInning, position })
                    }
                    onAssign={async (positionId, playerId) => {
                      await update(setAssignment(game, fieldInning, positionId, playerId));
                    }}
                    onBench={async (positionId) => {
                      await update(setAssignment(game, fieldInning, positionId, null));
                    }}
                  />
                </div>
              ) : null}
              {mode === 'live' ? (
                <div className="px-2 py-1">
                  <LiveView view={view} />
                </div>
              ) : null}
            </div>
            {mode === 'inning' ? (
              // The lock and pin states are explained by the legend the grid
              // renders under itself, next to the actual controls.
              <p className="border-t border-border px-5 py-3 text-xs text-ink-subtle">
                Tap any player to swap or bench them.
              </p>
            ) : null}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <BattingOrderPanel
              readOnly={!editsGame}
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
            description={
              editsGame
                ? "Check who's playing, choose how you want to coach, then generate. It takes about a second."
                : 'The head coach builds the lineup for this game.'
            }
            action={editsGame ? (
              <Button variant="primary" size="lg" disabled={generating} onClick={() => run()}>
                {generating ? (
                  <>
                    <Spinner /> Building lineup…
                  </>
                ) : (
                  'Generate lineup'
                )}
              </Button>
            ) : null}
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
