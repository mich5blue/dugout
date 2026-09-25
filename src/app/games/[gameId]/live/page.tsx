'use client';

import { useDugout } from '@/app/providers';
import { FieldView } from '@/components/game/FieldView';
import { SomeoneOutSheet } from '@/components/game/SomeoneOutSheet';
import { Button, EmptyState, Modal, Spinner } from '@/components/ui';
import type { Game } from '@/domain/types';
import { cn } from '@/lib/cn';
import { extraInningFor, type ExtraInning } from '@/lib/gameDayChanges';
import { buildGameView, inningChanges } from '@/lib/gameView';
import {
  advanceInning,
  batterQueue,
  currentInning,
  nextBatter,
  previousBatter,
  previousInning,
  startGame,
} from '@/services/liveGame';
import { generateLineup, recordActualResults, setAssignment, setAvailability } from '@/services/lineupService';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

/**
 * Game day.
 *
 * A different product from the planning screens, and it should feel like one.
 * The constraints are physical: one hand, bright sun, a phone that has been in
 * a pocket, a connection that comes and goes, and about two seconds of
 * attention between pitches. So: no app navigation, no small text, no control
 * that needs a second tap to confirm something harmless, and every number big
 * enough to read at arm's length.
 *
 * Dark, always, rather than following the theme. Not for taste — the planning
 * screens are light by default and a white field of view at 3pm in July is
 * unreadable, while a dark one with a bright accent stays legible.
 *
 * Nothing here writes ACTUAL rows. What was really played is recorded once, at
 * the end, from the plan plus whatever the coach changed — see
 * `services/liveGame.ts` for why inning-by-inning recording is the wrong
 * trade.
 */
export default function LiveGamePage() {
  const params = useParams<{ gameId: string }>();
  const router = useRouter();
  const { ready, team, players, games, saveGame, goals, flags } = useDugout();

  const [busy, setBusy] = useState(false);
  const [someoneOut, setSomeoneOut] = useState(false);
  const [impact, setImpact] = useState<ExtraInning | null>(null);
  const [finishing, setFinishing] = useState(false);

  const game = games.find((entry) => entry.id === params.gameId) ?? null;
  const view = useMemo(
    () => (game ? buildGameView(game, players) : null),
    [game, players],
  );

  /*
    Arriving here begins the game, so a coach does not press Start and then
    press it again every time their phone locks. In an effect rather than in
    render: saving during render re-renders, which would start the game again,
    forever.
  */
  const needsStart = Boolean(
    game && !game.liveState && game.status !== 'COMPLETED' && game.defensiveAssignments.length > 0,
  );
  useEffect(() => {
    if (!game || !needsStart) return;
    void saveGame(startGame(game));
  }, [game, needsStart, saveGame]);

  if (!ready) return null;

  if (!team || !game || !view) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <EmptyState
          title="Game not found"
          action={
            <Link href="/games">
              <Button variant="primary">Back to the schedule</Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (!view.hasLineup) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <EmptyState
          title="No lineup to play"
          description="Build the lineup first and this screen becomes the dugout view."
          action={
            <Link href={`/games/${game.id}/build`}>
              <Button variant="primary">Build the lineup</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const inning = currentInning(game);
  const queue = batterQueue(game, 3);
  const extra = extraInningFor(view, inning);
  const changes = inning < game.plannedInnings ? inningChanges(view, inning, inning + 1) : [];

  const patch = async (next: Game) => {
    await saveGame(next);
  };

  const commitExtraInning = async (plan: ExtraInning) => {
    setBusy(true);
    try {
      /* Put the pitcher in next inning's pitcher slot; setAssignment swaps
         whoever was there rather than displacing them to nowhere. */
      const next = setAssignment(
        game,
        plan.nextInning,
        plan.pitcherPositionId,
        plan.pitcher.id,
      );
      await patch(next);
      setImpact(null);
    } finally {
      setBusy(false);
    }
  };

  const finish = async (actualInnings: number) => {
    setBusy(true);
    try {
      await saveGame({ ...recordActualResults(game, actualInnings), liveState: null });
      router.push(`/games/${game.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    /*
      Its own dark surface rather than the theme's. `min-h-dvh` and the
      safe-area padding keep it edge to edge on a phone without hiding the top
      row under a notch.
    */
    <div
      className="min-h-dvh bg-[#07090b] text-[#f3f7f9]"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {/* ---- top bar --------------------------------------------------- */}
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <span className="scoreboard text-sm text-white/50">LIVE</span>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
          {team.name} <span className="text-white/40">vs</span>{' '}
          {game.opponent || 'TBD'}
        </p>
        <Link
          href={`/games/${game.id}`}
          className="ring-focus flex h-11 items-center rounded-lg border border-white/20 px-4 text-sm font-semibold text-white/80"
        >
          Exit
        </Link>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-4 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-6">
        {/* ---- left: inning + field ------------------------------------ */}
        <div className="min-w-0">
          {/*
            The inning stepper. Oversized because it is the control used most
            and the one used with the least care — a 44px target is the
            minimum and these are bigger.
          */}
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <button
              type="button"
              aria-label="Previous inning"
              disabled={inning <= 1}
              onClick={() => patch(previousInning(game))}
              className="ring-focus flex size-14 items-center justify-center rounded-xl border border-white/20 text-2xl disabled:opacity-30"
            >
              −
            </button>
            <div className="text-center">
              <p className="scoreboard text-xs tracking-[0.2em] text-white/50">INNING</p>
              <p className="display text-6xl leading-none text-[#d4ff3d]">{inning}</p>
              <p className="mt-1 text-xs text-white/40">of {game.plannedInnings}</p>
            </div>
            <button
              type="button"
              aria-label="Next inning"
              disabled={inning >= game.plannedInnings}
              onClick={() => patch(advanceInning(game))}
              className="ring-focus flex size-14 items-center justify-center rounded-xl border border-white/20 text-2xl disabled:opacity-30"
            >
              +
            </button>
          </div>

          {/*
            The field, not the grid. A coach glancing down between pitches has
            to see the defense in one look, and reading a ten-row table is not
            one look.
          */}
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-2">
            <FieldView
              view={view}
              inning={inning}
              onInningChange={(next) => {
                if (next > inning) void patch(advanceInning(game));
                else if (next < inning) void patch(previousInning(game));
              }}
              readOnly
            />
          </div>
        </div>

        {/* ---- right: batting, next inning, actions -------------------- */}
        <div className="mt-4 space-y-4 lg:mt-0">
          {/* Who's up. The largest type on the screen after the inning. */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="scoreboard text-xs tracking-[0.2em] text-white/50">BATTING</p>
            {queue.length > 0 ? (
              <>
                <p className="display mt-1 text-4xl leading-tight">
                  {view.names.short(queue[0])}
                </p>
                <div className="mt-3 space-y-1.5 border-t border-white/10 pt-3 text-sm">
                  {queue[1] ? (
                    <p className="flex items-baseline gap-2">
                      <span className="w-16 shrink-0 text-xs text-white/40">ON DECK</span>
                      <span className="font-medium">{view.names.short(queue[1])}</span>
                    </p>
                  ) : null}
                  {queue[2] ? (
                    <p className="flex items-baseline gap-2">
                      <span className="w-16 shrink-0 text-xs text-white/40">IN HOLE</span>
                      <span className="text-white/70">{view.names.short(queue[2])}</span>
                    </p>
                  ) : null}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => patch(previousBatter(game))}
                    className="ring-focus h-11 flex-1 rounded-xl border border-white/20 text-sm font-semibold"
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    onClick={() => patch(nextBatter(game))}
                    className="ring-focus h-11 flex-[2] rounded-xl bg-[#d4ff3d] text-sm font-bold text-[#0a1000]"
                  >
                    Next batter →
                  </button>
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-white/50">No batting order for this game.</p>
            )}
          </section>

          {/* Next inning preview: only who moves, because that is the work. */}
          {inning < game.plannedInnings ? (
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="scoreboard text-xs tracking-[0.2em] text-white/50">
                NEXT INNING ({inning + 1})
              </p>
              {changes.length === 0 ? (
                <p className="mt-2 text-sm text-white/50">Nobody moves.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {changes.slice(0, 6).map((change) => (
                    <li
                      key={change.playerId}
                      className="flex items-baseline gap-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {change.playerName}
                      </span>
                      <span className="scoreboard shrink-0 text-white/40">{change.from}</span>
                      <span aria-hidden className="shrink-0 text-white/30">→</span>
                      <span className="scoreboard shrink-0 text-[#d4ff3d]">{change.to}</span>
                    </li>
                  ))}
                  {changes.length > 6 ? (
                    <li className="text-xs text-white/40">
                      and {changes.length - 6} more
                    </li>
                  ) : null}
                </ul>
              )}
            </section>
          ) : null}

          {/* Quick actions. Each one names what happens, not what it is. */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="scoreboard text-xs tracking-[0.2em] text-white/50">
              SOMETHING CHANGED
            </p>
            <div className="mt-2.5 space-y-2">
              {extra ? (
                <ActionButton
                  label={`Keep ${view.names.short(extra.pitcher.id)} pitching`}
                  hint={
                    extra.blocked
                      ? extra.blocked
                      : `Into inning ${extra.nextInning}. You'll see what it changes first.`
                  }
                  disabled={Boolean(extra.blocked)}
                  onClick={() => setImpact(extra)}
                />
              ) : null}
              <ActionButton
                label="Someone has to come out"
                hint="Records it and rebuilds the rest of the game around it."
                onClick={() => setSomeoneOut(true)}
              />
              <ActionButton
                label="Finish game"
                hint="Record how many innings were actually played."
                onClick={() => setFinishing(true)}
              />
            </div>
          </section>
        </div>
      </div>

      {/* ---- impact preview ------------------------------------------- */}
      {impact ? (
        <Modal
          open
          onClose={() => setImpact(null)}
          title={`Keep ${view.names.short(impact.pitcher.id)} pitching?`}
        >
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-ink">{impact.summary}</p>
            {impact.warning ? (
              <p className="rounded-lg border border-caution/40 bg-caution-soft px-3 py-2.5 text-sm text-ink">
                <span className="font-semibold">Worth knowing: </span>
                {impact.warning}
              </p>
            ) : null}
            <p className="text-xs text-ink-subtle">
              Nothing has changed yet. The rest of the game stays as planned unless you
              update it.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="lg"
                disabled={busy}
                onClick={() => commitExtraInning(impact)}
              >
                {busy ? (
                  <>
                    <Spinner /> Updating…
                  </>
                ) : (
                  'Update the rotation'
                )}
              </Button>
              <Button size="lg" onClick={() => setImpact(null)}>
                Keep the original plan
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* ---- finish --------------------------------------------------- */}
      {finishing ? (
        <Modal open onClose={() => setFinishing(false)} title="How many innings were played?">
          <div className="space-y-4">
            <p className="text-sm text-ink-muted">
              Only innings that were actually played count toward the season. Anything
              called off counts against nobody.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: game.plannedInnings }, (_, i) => i + 1)
                .reverse()
                .map((count) => (
                  <Button
                    key={count}
                    size="lg"
                    variant={count === game.plannedInnings ? 'primary' : 'secondary'}
                    disabled={busy}
                    onClick={() => finish(count)}
                  >
                    {count}
                  </Button>
                ))}
            </div>
            <p className="text-xs text-ink-subtle">
              You can correct this afterwards from the game page.
            </p>
          </div>
        </Modal>
      ) : null}

      <SomeoneOutSheet
        view={view}
        open={someoneOut}
        currentInning={inning}
        onClose={() => setSomeoneOut(false)}
        onApply={async (playerId, lastInning) => {
          const withDeparture =
            lastInning <= 0
              ? setAvailability(game, playerId, { available: false })
              : setAvailability(game, playerId, { departureInning: lastInning });
          await patch(withDeparture);

          setBusy(true);
          try {
            const outcome = await generateLineup({
              team,
              game: withDeparture,
              players,
              history: games,
              goals,
              flags,
              seed: game.optimizerSeed,
              /* Everything already played is frozen: what happened stays
                 happened, and only the remaining innings are re-planned. */
              frozenInnings: Math.max(0, lastInning),
            });
            if (outcome.result.ok) await saveGame(outcome.game);
          } finally {
            setBusy(false);
            setSomeoneOut(false);
          }
        }}
      />
    </div>
  );
}

/** A full-width action with its consequence written underneath it. */
function ActionButton({
  label,
  hint,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'ring-focus w-full rounded-xl border border-white/20 px-3.5 py-3 text-left transition-colors',
        disabled ? 'opacity-40' : 'hover:border-white/40 hover:bg-white/5',
      )}
    >
      <span className="block text-sm font-semibold">{label}</span>
      <span className="mt-0.5 block text-xs leading-relaxed text-white/50">{hint}</span>
    </button>
  );
}
