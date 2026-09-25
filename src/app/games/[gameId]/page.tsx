'use client';

import { useDugout } from '@/app/providers';
import { AssignmentPicker } from '@/components/game/AssignmentPicker';
import { BattingOrderPanel } from '@/components/game/BattingOrderPanel';
import { FieldView } from '@/components/game/FieldView';
import { FairnessNotes, RuleChecks } from '@/components/game/hero/FairnessNotes';
import { PositionPicker } from '@/components/game/hero/PositionPicker';
import { LineupGrid, PlayerGrid } from '@/components/game/LineupGrid';
import { LiveView } from '@/components/game/LiveView';
import { PitchingPlanPanel } from '@/components/game/GameSetupPanels';
import { ConflictList } from '@/components/game/QualitySummary';
import { ShareActions } from '@/components/game/ShareActions';
import { SomeoneOutSheet } from '@/components/game/SomeoneOutSheet';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  SegmentedControl,
  Select,
  Spinner,
} from '@/components/ui';
import type {
  AssignmentType,
  Game,
  PositionDefinition,
  TeamSettings,
} from '@/domain/types';
import { rotateBattingOrder, type OptimizationResult, type RelaxationSuggestion } from '@/optimizer';
import {
  generateLineup,
  regenerateBattingOrder,
  setAssignment,
  setBattingOrder,
  setAvailability,
  setBattingSlotLocked,
  toggleLock,
} from '@/services/lineupService';
import { getFairnessDebt } from '@/services/fairness';
import { formatGameDate } from '@/lib/format';
import { buildGameView } from '@/lib/gameView';
import { nextActionFor } from '@/lib/nextAction';
import { adjacentGames } from '@/lib/schedule';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

/**
 * The lineup workspace — the hero screen of the product.
 *
 * Three panes on a wide screen: the batting order, the grid, and why the grid
 * looks like that. The grid is by *player* rather than by position, because
 * "where has this kid been all game" is the question both the coach and the
 * parent ask, and the by-position grid can only answer it by scanning ten rows.
 * By inning, Field and Live are all still one tap away.
 *
 * Game setup left this page entirely and became the build flow. What remains
 * here is only what a coach does *to a lineup that exists*: read it, adjust it,
 * lock what they like, rebuild the rest, and take it to the field.
 */
type ViewMode = 'player' | 'inning' | 'field' | 'live';

export default function GamePage() {
  const params = useParams<{ gameId: string }>();
  const { ready, team, players, games, saveGame, goals, flags, can } = useDugout();

  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [mode, setMode] = useState<ViewMode>('player');
  const [fieldInning, setFieldInning] = useState(1);
  const [liveInning, setLiveInning] = useState(1);
  const [frozenInnings, setFrozenInnings] = useState(0);
  const [someoneOut, setSomeoneOut] = useState(false);
  const [pitchingOpen, setPitchingOpen] = useState(false);

  /** Which cell is being edited, in whichever of the two shapes the view uses. */
  const [cellByPlayer, setCellByPlayer] = useState<{ playerId: string; inning: number } | null>(
    null,
  );
  const [cellByPosition, setCellByPosition] = useState<{
    inning: number;
    position: PositionDefinition;
  } | null>(null);

  /*
    Undo is a stack of whole games rather than a diff log.

    A lineup is small enough that snapshotting it costs nothing, and a coach's
    "undo" means "put it back how it was" — including the six other cells a
    swap moved. Reconstructing that from inverse operations is where undo
    implementations go wrong.
  */
  const [history, setHistory] = useState<Game[]>([]);

  const game = games.find((entry) => entry.id === params.gameId) ?? null;

  /*
    Which rows the page reads and writes. Once a game is completed the plan is
    history and the record is the truth — the season counts ACTUAL rows.
  */
  const editType: AssignmentType = game?.status === 'COMPLETED' ? 'ACTUAL' : 'PLANNED';

  const view = useMemo(
    () => (game ? buildGameView(game, players, editType) : null),
    [game, players, editType],
  );

  const debts = useMemo(() => getFairnessDebt(games, players), [games, players]);

  const update = useCallback(
    async (next: Game, { undoable = true }: { undoable?: boolean } = {}) => {
      if (undoable && game) setHistory((stack) => [...stack.slice(-19), game]);
      await saveGame(next);
    },
    [game, saveGame],
  );

  const undo = async () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((stack) => stack.slice(0, -1));
    await saveGame(previous);
  };

  if (!ready) return null;

  if (!team || !game || !view) {
    return (
      <EmptyState
        title="Game not found"
        action={
          <Link href="/games">
            <Button variant="primary">Back to the schedule</Button>
          </Link>
        }
      />
    );
  }

  const editsGame = can('game:edit');
  const hasLineup = view.hasLineup;
  const { previous: previousGame, next: nextGame } = adjacentGames(games, game.id);
  const action = nextActionFor(game);
  const completed = game.status === 'COMPLETED';

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
      if (outcome.result.ok) await update(outcome.game);
    } finally {
      setGenerating(false);
    }
  };

  const applyRelaxation = async (suggestion: RelaxationSuggestion) => {
    const act = suggestion.action;
    if (!act) return;
    const settings: TeamSettings = { ...game.settingsSnapshot };
    switch (act.type) {
      case 'REDUCE_MIN_DEFENSIVE_INNINGS':
        settings.minDefensiveInnings = act.to;
        break;
      case 'RELAX_INFIELD_REQUIREMENT':
        settings.infieldOpportunity = { mode: 'TARGET', innings: act.to };
        break;
      case 'ALLOW_CONSECUTIVE_BENCH':
        settings.noConsecutiveBench = false;
        break;
      case 'RAISE_PITCHING_CAP':
        settings.maxPitchingInningsPerPlayer = act.to;
        break;
      case 'RAISE_CATCHING_CAP':
        settings.maxCatcherInningsPerPlayer = act.to;
        break;
      case 'ALLOW_POSITION':
        await update({
          ...game,
          eligibilityOverrides: [
            ...game.eligibilityOverrides,
            { playerId: act.playerId, positionId: act.positionId },
          ],
        });
        return;
      default:
        return;
    }
    await update({ ...game, settingsSnapshot: settings });
  };

  return (
    <div className="space-y-5">
      {/* ---- header ---------------------------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Link
              href="/games"
              className="ring-focus rounded text-sm text-ink-muted hover:text-ink"
            >
              ← Games
            </Link>
            {previousGame || nextGame ? (
              <span className="ml-2 flex items-center gap-1">
                {previousGame ? (
                  <Link
                    href={`/games/${previousGame.id}`}
                    aria-label={`Previous game, vs ${previousGame.opponent || 'TBD'}`}
                    className="ring-focus rounded border border-border px-1.5 text-sm text-ink-muted hover:text-ink"
                  >
                    ←
                  </Link>
                ) : null}
                {nextGame ? (
                  <Link
                    href={`/games/${nextGame.id}`}
                    aria-label={`Next game, vs ${nextGame.opponent || 'TBD'}`}
                    className="ring-focus rounded border border-border px-1.5 text-sm text-ink-muted hover:text-ink"
                  >
                    →
                  </Link>
                ) : null}
              </span>
            ) : null}
          </div>

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
            <span aria-hidden className="text-ink-subtle">·</span>
            <span className="tnum">{game.plannedInnings} innings</span>
            <span aria-hidden className="text-ink-subtle">·</span>
            <span className="tnum">{view.positions.length} on defense</span>
            {completed ? (
              <Badge tone="positive">{game.actualInnings} played</Badge>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasLineup ? (
            <>
              {/*
                The one filled action is whatever comes next for this game —
                unless that is this very page, which on the lineup screen it
                usually is. A primary button that reloads the screen you are
                looking at is worse than no primary button.
              */}
              {editsGame && !completed && action.href !== `/games/${game.id}` ? (
                <Link href={action.href}>
                  <Button variant="primary" size="md">
                    {action.label}
                  </Button>
                </Link>
              ) : null}
              <ShareActions team={team} game={game} players={players} />
              <Link href={`/games/${game.id}/print`}>
                <Button size="sm">Print</Button>
              </Link>
              <Link href={`/games/${game.id}/compare`}>
                <Button size="sm">Compare</Button>
              </Link>
              <Link href={`/games/${game.id}/record`}>
                <Button size="sm">{completed ? 'Edit results' : 'Record results'}</Button>
              </Link>
            </>
          ) : editsGame ? (
            <Link href={`/games/${game.id}/build`}>
              <Button variant="primary" size="lg">
                Build the lineup
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      {/*
        Say which thing an edit changes. On a completed game every change here
        rewrites what happened, and that flows straight into season fairness.
      */}
      {completed ? (
        <div className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm">
          <p className="font-semibold text-ink">Recorded result</p>
          <p className="mt-0.5 text-ink-muted">
            This game is done, so changes here correct what actually happened and update
            season fairness. {game.actualInnings} of {game.plannedInnings} innings counted.
          </p>
        </div>
      ) : null}

      {result && !result.ok ? (
        <ConflictList
          conflicts={result.conflicts}
          relaxations={result.relaxations}
          onApply={applyRelaxation}
        />
      ) : null}

      {!hasLineup ? (
        <Card>
          <EmptyState
            title="No lineup yet"
            description="Confirm who's coming, pick how you want to coach, and InningGrid builds the rest."
            action={
              editsGame ? (
                <Link href={`/games/${game.id}/build`}>
                  <Button variant="primary" size="lg">
                    {action.label}
                  </Button>
                </Link>
              ) : null
            }
          />
        </Card>
      ) : (
        <>
          {/* ---- the workspace ------------------------------------------ */}
          {/*
            `minmax(0, 1fr)` on the single-column case matters.

            Without it the implicit column is `auto`, which sizes to its widest
            child — the batting-order row, with its handle, name, lock and two
            arrows — and the page overflowed 240px on a 375px phone. A grid
            column only lets its children shrink when told it may.
          */}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,19rem)]">
            {/* LEFT: batting order, then the pitching plan. */}
            <div className="order-2 min-w-0 space-y-4 xl:order-1">
              <BattingOrderPanel
                readOnly={!editsGame}
                game={game}
                players={players}
                canRotate={Boolean(previousGame)}
                onReorder={async (playerIds) => {
                  await update(
                    setBattingOrder(
                      game,
                      playerIds.map((playerId, index) => ({
                        playerId,
                        battingSlot: index + 1,
                      })),
                    ),
                  );
                }}
                onToggleLock={async (playerId) => {
                  const current = game.battingAssignments.find(
                    (entry) => entry.playerId === playerId,
                  );
                  await update(setBattingSlotLocked(game, playerId, !current?.locked));
                }}
                onPhilosophyChange={async (battingPhilosophy) => {
                  await update({
                    ...game,
                    settingsSnapshot: { ...game.settingsSnapshot, battingPhilosophy },
                  });
                }}
                onRotate={async (offset) => {
                  if (!previousGame) return;
                  /* Rotated from *last game's* order, which is the only thing
                     that makes "everyone moves up two" mean anything across a
                     season, and filtered to who is actually here today. */
                  const rotated = rotateBattingOrder(
                    previousGame.battingAssignments,
                    offset,
                    view.players
                      .filter((player) =>
                        game.gamePlayers.some(
                          (gp) => gp.playerId === player.id && gp.available,
                        ),
                      )
                      .map((player) => player.id),
                  );
                  await update(
                    setBattingOrder(
                      game,
                      rotated.map((entry) => ({
                        playerId: entry.playerId,
                        battingSlot: entry.battingSlot,
                        locked: entry.locked,
                      })),
                    ),
                  );
                }}
                onRebalance={
                  editsGame
                    ? async () => {
                        await update(
                          regenerateBattingOrder({
                            team,
                            game,
                            players,
                            history: games,
                            goals,
                            flags,
                            seed: game.optimizerSeed,
                          }),
                        );
                      }
                    : undefined
                }
              />

              {editsGame && !completed ? (
                <Card>
                  <button
                    type="button"
                    onClick={() => setPitchingOpen((open) => !open)}
                    aria-expanded={pitchingOpen}
                    className="ring-focus flex w-full items-center justify-between gap-2 px-5 py-4 text-left"
                  >
                    <span>
                      <span className="block text-sm font-semibold text-ink">
                        Pitching plan
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-muted">
                        {Object.keys(game.pitchingPlan).length === 0
                          ? 'Let InningGrid choose, or decide it yourself'
                          : `${Object.keys(game.pitchingPlan).length} innings decided`}
                      </span>
                    </span>
                    <span aria-hidden className="text-ink-subtle">
                      {pitchingOpen ? '−' : '+'}
                    </span>
                  </button>
                  {pitchingOpen ? (
                    <div className="border-t border-border p-4">
                      <PitchingPlanPanel
                        game={game}
                        players={players}
                        onChange={(next) => update(next)}
                      />
                    </div>
                  ) : null}
                </Card>
              ) : null}
            </div>

            {/* CENTER: the grid. */}
            <Card className="order-1 min-w-0 rise xl:order-2">
              <CardHeader
                title="Defensive rotation"
                action={
                  <SegmentedControl<ViewMode>
                    size="sm"
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: 'player', label: 'By player' },
                      { value: 'inning', label: 'By inning' },
                      { value: 'field', label: 'Field' },
                      { value: 'live', label: 'Live' },
                    ]}
                  />
                }
              />

              {/* Adjusting a lineup that exists: rebuild the unlocked rest. */}
              {editsGame ? (
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={generating}
                    onClick={() => run(game.optimizerSeed)}
                  >
                    {generating ? (
                      <>
                        <Spinner /> Rebuilding…
                      </>
                    ) : (
                      'Rebalance'
                    )}
                  </Button>
                  <Button
                    size="sm"
                    disabled={generating}
                    onClick={() => run(Math.floor(Date.now() % 100000))}
                  >
                    Try another
                  </Button>
                  <Button size="sm" variant="ghost" disabled={history.length === 0} onClick={undo}>
                    Undo
                  </Button>
                  {game.plannedInnings > 1 ? (
                    <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-muted">
                      Keep innings
                      <Select
                        className="h-8 w-16"
                        value={frozenInnings}
                        onChange={(event) => setFrozenInnings(Number(event.target.value))}
                      >
                        {Array.from({ length: game.plannedInnings }, (_, i) => i).map(
                          (value) => (
                            <option key={value} value={value}>
                              {value === 0 ? 'None' : `1–${value}`}
                            </option>
                          ),
                        )}
                      </Select>
                    </label>
                  ) : null}
                </div>
              ) : null}

              <div className="px-2 py-3 sm:px-4">
                {mode === 'player' ? (
                  <PlayerGrid
                    view={view}
                    focusedPlayerId={cellByPlayer?.playerId ?? null}
                    onSelectCell={
                      editsGame
                        ? (playerId, inning) => setCellByPlayer({ playerId, inning })
                        : undefined
                    }
                    onToggleLock={
                      editsGame
                        ? async (playerId, inning) => {
                            const slot = view.slotOf(playerId, inning);
                            if (slot === null || typeof slot === 'string') return;
                            await update(toggleLock(game, inning, slot.id), {
                              undoable: false,
                            });
                          }
                        : undefined
                    }
                  />
                ) : null}

                {mode === 'inning' ? (
                  <LineupGrid
                    view={view}
                    readOnly={!editsGame}
                    onSelectCell={
                      editsGame
                        ? (inning, position) => setCellByPosition({ inning, position })
                        : undefined
                    }
                    onToggleLock={async (inning, position) => {
                      await update(toggleLock(game, inning, position.id), {
                        undoable: false,
                      });
                    }}
                  />
                ) : null}

                {mode === 'field' ? (
                  <FieldView
                    view={view}
                    inning={fieldInning}
                    onInningChange={setFieldInning}
                    readOnly={!editsGame}
                    onSelectPosition={(position) =>
                      setCellByPosition({ inning: fieldInning, position })
                    }
                    onAssign={async (positionId, playerId) => {
                      await update(
                        setAssignment(game, fieldInning, positionId, playerId, editType),
                      );
                    }}
                    onBench={async (positionId) => {
                      await update(
                        setAssignment(game, fieldInning, positionId, null, editType),
                      );
                    }}
                  />
                ) : null}

                {mode === 'live' ? (
                  <LiveView
                    view={view}
                    onInningChange={setLiveInning}
                    onSomeoneOut={editsGame ? () => setSomeoneOut(true) : undefined}
                  />
                ) : null}
              </div>

              {mode === 'player' && editsGame ? (
                <p className="border-t border-border px-5 py-3 text-xs text-ink-subtle">
                  {completed
                    ? 'Tap any cell to correct what happened that inning.'
                    : 'Tap any cell to move a player, or the padlock to keep it through a Rebalance.'}
                </p>
              ) : null}
            </Card>

            {/* RIGHT: why, and whether it holds. */}
            <div className="order-3 min-w-0 space-y-4">
              {result?.quality ? <RuleChecks quality={result.quality} /> : null}
              {result?.explanations ? (
                <FairnessNotes
                  explanations={result.explanations}
                  onWhyAnything={() => setMode('player')}
                />
              ) : (
                <Card>
                  <CardHeader
                    title="Why this lineup"
                    description="Tap any cell in the grid to see why that player is there. Rebalance to see the notes for a fresh build."
                  />
                </Card>
              )}
            </div>
          </div>
        </>
      )}

      {/* ---- sheets ---------------------------------------------------- */}
      {cellByPlayer ? (
        <PositionPicker
          view={view}
          playerId={cellByPlayer.playerId}
          inning={cellByPlayer.inning}
          debt={debts[cellByPlayer.playerId]}
          onClose={() => setCellByPlayer(null)}
          onPick={async (positionId) => {
            await update(
              setAssignment(game, cellByPlayer.inning, positionId, cellByPlayer.playerId, editType),
            );
            setCellByPlayer(null);
          }}
          onBench={async () => {
            const slot = view.slotOf(cellByPlayer.playerId, cellByPlayer.inning);
            if (slot && typeof slot !== 'string') {
              await update(setAssignment(game, cellByPlayer.inning, slot.id, null, editType));
            }
            setCellByPlayer(null);
          }}
        />
      ) : null}

      {cellByPosition ? (
        <AssignmentPicker
          view={view}
          inning={cellByPosition.inning}
          position={cellByPosition.position}
          onClose={() => setCellByPosition(null)}
          onAssign={async (playerId) => {
            await update(
              setAssignment(
                game,
                cellByPosition.inning,
                cellByPosition.position.id,
                playerId,
                editType,
              ),
            );
            setCellByPosition(null);
          }}
          onBench={async () => {
            await update(
              setAssignment(
                game,
                cellByPosition.inning,
                cellByPosition.position.id,
                null,
                editType,
              ),
            );
            setCellByPosition(null);
          }}
          onOverride={async (playerId) => {
            await update({
              ...game,
              eligibilityOverrides: [
                ...game.eligibilityOverrides,
                { playerId, positionId: cellByPosition.position.id },
              ],
            });
          }}
        />
      ) : null}

      <SomeoneOutSheet
        view={view}
        open={someoneOut}
        currentInning={liveInning}
        onClose={() => setSomeoneOut(false)}
        onApply={async (playerId, lastInning) => {
          /*
            Two steps, in this order. Record that the player is gone, then
            re-plan only what has not happened yet: innings up to and including
            `lastInning` are frozen, so what was actually played stays exactly
            as played and the season keeps counting it.
          */
          const withDeparture =
            lastInning <= 0
              ? setAvailability(game, playerId, { available: false })
              : setAvailability(game, playerId, { departureInning: lastInning });
          await update(withDeparture);

          setGenerating(true);
          try {
            const outcome = await generateLineup({
              team,
              game: withDeparture,
              players,
              history: games,
              goals,
              flags,
              seed: game.optimizerSeed,
              frozenInnings: Math.max(0, lastInning),
            });
            setResult(outcome.result);
            if (outcome.result.ok) await saveGame(outcome.game);
          } finally {
            setGenerating(false);
            setSomeoneOut(false);
          }
        }}
      />
    </div>
  );
}
