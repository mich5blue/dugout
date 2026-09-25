'use client';

import { useDugout } from '@/app/providers';
import { HowToCoach } from '@/components/game/build/HowToCoach';
import { WhosHere } from '@/components/game/build/WhosHere';
import { ConflictList } from '@/components/game/QualitySummary';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FlowFooter,
  Notice,
  Spinner,
  StepHeader,
} from '@/components/ui';
import type { Game, GamePlayer, TeamSettings } from '@/domain/types';
import { formatDayAndDate } from '@/lib/format';
import { attendanceFor } from '@/lib/nextAction';
import { playerNames } from '@/lib/playerNames';
import { cloneFormation, systemFormationsForSport } from '@/domain/formations';
import { orderedGames } from '@/lib/schedule';
import { generateLineup } from '@/services/lineupService';
import type { OptimizationResult, RelaxationSuggestion } from '@/optimizer';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';

/**
 * Build a lineup: who's here → how to coach → generate.
 *
 * This is the workflow the whole redesign is organised around. It used to be
 * three collapsible panels stacked above a grid on the game page, which meant
 * a first-time coach met every decision at once and an experienced one had to
 * remember which panel held attendance.
 *
 * The game itself is saved as you go rather than at the end. A wizard that
 * discards work on a back button is the wrong trade here: the game already
 * exists in the schedule, and a coach who gets interrupted between marking
 * attendance and generating should come back to the attendance they marked.
 */
export default function BuildPage() {
  return (
    <Suspense fallback={null}>
      <BuildFlow />
    </Suspense>
  );
}

const STEPS = ['Game', "Who's here", 'How to coach', 'Generate'];

type StepKey = 'game' | 'who' | 'rules' | 'generate';
const STEP_KEYS: StepKey[] = ['game', 'who', 'rules', 'generate'];

function BuildFlow() {
  const params = useParams<{ gameId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { ready, team, players, games, goals, flags, saveGame, can, db } = useDugout();

  const game = games.find((entry) => entry.id === params.gameId) ?? null;

  /* The step lives in the URL so Home can deep-link straight to Generate, and
     so the browser back button steps back through the flow. */
  const requested = (search.get('step') ?? '') as StepKey;
  const initial = STEP_KEYS.includes(requested)
    ? STEP_KEYS.indexOf(requested)
    : /* Land on the first thing that is not done yet. */
      game && !game.attendanceConfirmedAt
      ? 1
      : 1;
  const [step, setStep] = useState(initial);

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<OptimizationResult | null>(null);

  const names = useMemo(() => playerNames(players), [players]);

  const previousGame = useMemo(() => {
    if (!game) return null;
    const played = orderedGames(games).filter(
      (entry) => entry.status === 'COMPLETED' && entry.date < game.date,
    );
    return played[played.length - 1] ?? null;
  }, [game, games]);

  if (!ready) return null;

  if (!team || !game) {
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

  if (!can('game:edit')) {
    return (
      <EmptyState
        title="Assistant coaches can't build lineups"
        description="You can see the lineup once the head coach has generated it."
        action={
          <Link href={`/games/${game.id}`}>
            <Button variant="primary">Open the game</Button>
          </Link>
        }
      />
    );
  }

  const attendance = attendanceFor(game);

  const patch = async (changes: Partial<Game>) => {
    await saveGame({ ...game, ...changes });
  };

  const goTo = (index: number) => {
    setStep(index);
    router.replace(`/games/${game.id}/build?step=${STEP_KEYS[index]}`, { scroll: true });
  };

  /** Leaving Who's here is what counts as confirming it. */
  const confirmAttendance = async () => {
    await patch({ attendanceConfirmedAt: new Date().toISOString() });
    goTo(2);
  };

  const run = async (settings?: TeamSettings) => {
    setGenerating(true);
    try {
      const outcome = await generateLineup({
        team,
        game: settings ? { ...game, settingsSnapshot: settings } : game,
        players,
        history: games,
        goals,
        flags,
        seed: game.optimizerSeed,
      });
      setResult(outcome.result);
      if (outcome.result.ok) {
        await saveGame({
          ...outcome.game,
          attendanceConfirmedAt: game.attendanceConfirmedAt ?? new Date().toISOString(),
        });
        router.push(`/games/${game.id}`);
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
      case 'ALLOW_POSITION':
        await patch({
          eligibilityOverrides: [
            ...game.eligibilityOverrides,
            { playerId: action.playerId, positionId: action.positionId },
          ],
        });
        return;
      case 'USE_SMALLER_FORMATION': {
        /*
          Swap this game's formation for the largest one that fits, from the
          team's own set plus the system presets for its sport. Written to the
          game's snapshot only — the team default is untouched, because
          playing nine today says nothing about next week.
        */
        const candidates = [
          ...systemFormationsForSport(team.sport),
          ...db.formations.filter(
            (entry) => entry.teamId === team.id && entry.sport === team.sport,
          ),
        ]
          .filter((entry) => entry.positions.length <= action.positions)
          .sort((a, b) => b.positions.length - a.positions.length);

        const fit = candidates[0];
        if (!fit) return;
        await patch({ formationSnapshot: cloneFormation(fit) });
        return;
      }
      default:
        return;
    }
    await patch({ settingsSnapshot: settings });
  };

  return (
    <div className="mx-auto max-w-3xl pb-28 sm:pb-10">
      <div className="mb-6">
        <Link
          href={`/games/${game.id}`}
          className="ring-focus rounded text-sm text-ink-muted hover:text-ink"
        >
          ← vs {game.opponent || 'TBD'} · {formatDayAndDate(game.date)}
        </Link>
      </div>

      <StepHeader steps={STEPS} current={step} onGoTo={goTo} />

      <div className="mt-8">
        {step === 0 ? (
          <GameStep game={game} onPatch={patch} onNext={() => goTo(1)} />
        ) : null}

        {step === 1 ? (
          <WhosHere
            game={game}
            players={players}
            names={names}
            previousGame={previousGame}
            onChange={(gamePlayers: GamePlayer[]) => patch({ gamePlayers })}
            onNoteChange={(note) => patch({ note })}
          />
        ) : null}

        {step === 2 ? (
          <HowToCoach
            settings={game.settingsSnapshot}
            innings={game.plannedInnings}
            onChange={(settingsSnapshot) => patch({ settingsSnapshot })}
          />
        ) : null}

        {step === 3 ? (
          <GenerateStep
            game={game}
            expected={attendance.expected}
            limited={attendance.limited}
            generating={generating}
            result={result}
            onGenerate={() => run()}
            onApplyRelaxation={applyRelaxation}
          />
        ) : null}
      </div>

      <FlowFooter>
        {step > 1 ? (
          <Button variant="ghost" onClick={() => goTo(step - 1)}>
            ← Back
          </Button>
        ) : (
          <Link href={`/games/${game.id}`}>
            <Button variant="ghost">Cancel</Button>
          </Link>
        )}

        {step === 1 ? (
          <Button
            variant="primary"
            size="lg"
            disabled={attendance.expected === 0}
            onClick={confirmAttendance}
          >
            {attendance.expected === 0 ? 'Nobody is here' : 'Looks right'}
          </Button>
        ) : null}

        {step === 2 ? (
          <Button variant="primary" size="lg" onClick={() => goTo(3)}>
            Continue
          </Button>
        ) : null}

        {step === 3 ? (
          <Button
            variant="primary"
            size="lg"
            disabled={generating}
            onClick={() => run()}
          >
            {generating ? (
              <>
                <Spinner /> Building…
              </>
            ) : (
              'Generate lineup'
            )}
          </Button>
        ) : null}
      </FlowFooter>
    </div>
  );
}

/** Step 1 for a game that already exists: the few things still worth changing. */
function GameStep({
  game,
  onPatch,
  onNext,
}: {
  game: Game;
  onPatch: (changes: Partial<Game>) => Promise<void>;
  onNext: () => void;
}) {
  return (
    <div>
      <h2 className="display text-2xl text-ink sm:text-3xl">This game</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Everything here came from your team defaults. Change it only for this game.
      </p>
      <Card className="mt-5">
        <dl className="divide-y divide-border">
          <div className="flex items-baseline justify-between gap-3 px-4 py-3">
            <dt className="text-sm text-ink-muted">Opponent</dt>
            <dd className="text-sm font-medium text-ink">{game.opponent || 'TBD'}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 px-4 py-3">
            <dt className="text-sm text-ink-muted">Date</dt>
            <dd className="text-sm font-medium text-ink">{formatDayAndDate(game.date)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 px-4 py-3">
            <dt className="text-sm text-ink-muted">Innings</dt>
            <dd className="text-sm font-medium text-ink">{game.plannedInnings}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 px-4 py-3">
            <dt className="text-sm text-ink-muted">On defense</dt>
            <dd className="text-sm font-medium text-ink">
              {game.formationSnapshot.positions.length} players
            </dd>
          </div>
        </dl>
      </Card>
      <div className="mt-4">
        <Button onClick={onNext}>Looks right</Button>
      </div>
    </div>
  );
}

/**
 * The last step: what the lineup will be built from, then one button.
 *
 * It restates the inputs because this is the last moment a mistake is cheap.
 * A coach who sees "8 of 11 expected" here and meant 10 catches it before
 * generating, not after reading a grid that looks subtly wrong.
 */
function GenerateStep({
  game,
  expected,
  limited,
  generating,
  result,
  onGenerate,
  onApplyRelaxation,
}: {
  game: Game;
  expected: number;
  limited: number;
  generating: boolean;
  result: OptimizationResult | null;
  onGenerate: () => void;
  onApplyRelaxation: (suggestion: RelaxationSuggestion) => void;
}) {
  const philosophyLabel: Record<string, string> = {
    BALANCED: 'Balanced',
    DEVELOPMENT: 'Development',
    COMPETITIVE: 'Competitive',
    EQUAL_PLAYING_TIME: 'Equal playing time',
    CUSTOM: 'Custom',
  };

  return (
    <div>
      <h2 className="display text-2xl text-ink sm:text-3xl">Ready to build</h2>
      <p className="mt-1 text-sm text-ink-muted">
        A couple of seconds, and you&apos;ll have a full defense and batting order you can
        still change.
      </p>

      <Card className="mt-5">
        <dl className="divide-y divide-border">
          <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
            <dt className="text-sm text-ink-muted">Players</dt>
            <dd className="text-sm font-medium text-ink">
              <span className="tnum">{expected}</span> expected
              {limited > 0 ? (
                <span className="text-ink-muted">
                  {' · '}
                  <span className="tnum">{limited}</span> for part of the game
                </span>
              ) : null}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
            <dt className="text-sm text-ink-muted">Innings</dt>
            <dd className="text-sm font-medium text-ink">
              <span className="tnum">{game.plannedInnings}</span> ·{' '}
              {game.formationSnapshot.positions.length} on defense
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
            <dt className="text-sm text-ink-muted">Coaching style</dt>
            <dd className="text-sm font-medium text-ink">
              {philosophyLabel[game.settingsSnapshot.philosophy] ?? 'Custom'}
            </dd>
          </div>
          {Object.keys(game.pitchingPlan).length > 0 ? (
            <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
              <dt className="text-sm text-ink-muted">Pitching plan</dt>
              <dd className="text-sm font-medium text-ink">
                <span className="tnum">{Object.keys(game.pitchingPlan).length}</span>{' '}
                innings already decided
              </dd>
            </div>
          ) : null}
        </dl>
      </Card>

      {game.defensiveAssignments.length > 0 ? (
        <Notice tone="caution" className="mt-4" title="This game already has a lineup">
          Generating replaces it. Anything you locked is kept.
        </Notice>
      ) : null}

      {/*
        A failure is not a dead end: the engine says which rule it could not
        satisfy and offers the smallest change that would fix it.
      */}
      {result && !result.ok ? (
        <div className="mt-4">
          <ConflictList
            conflicts={result.conflicts}
            relaxations={result.relaxations}
            onApply={onApplyRelaxation}
          />
        </div>
      ) : null}

      <div className="mt-6 hidden sm:block">
        <Button variant="primary" size="lg" disabled={generating} onClick={onGenerate}>
          {generating ? (
            <>
              <Spinner /> Building…
            </>
          ) : (
            'Generate lineup'
          )}
        </Button>
      </div>

      {expected === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm">
          <Badge tone="critical">Nobody available</Badge>
          <span className="text-ink-muted">Go back and mark who is coming.</span>
        </p>
      ) : null}
    </div>
  );
}
