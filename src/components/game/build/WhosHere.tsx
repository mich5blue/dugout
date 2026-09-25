'use client';

import { Badge, Button, Input, Label, PlayerChip, Select } from '@/components/ui';
import type { Game, GamePlayer, Player } from '@/domain/types';
import { cn } from '@/lib/cn';
import type { PlayerNames } from '@/lib/playerNames';
import { attendanceFor } from '@/lib/nextAction';
import { useState } from 'react';

/**
 * Who's here — the screen a coach uses standing in a car park.
 *
 * Three states, not two. "Late / limited" is not a new concept bolted on: the
 * data model has carried `arrivalInning` and `departureInning` since the
 * beginning, and the optimizer already builds around them. What was missing was
 * anywhere to say it in under five taps — it lived behind an availability panel
 * on the game page that a coach in a hurry never opened.
 *
 * Deliberately not a spreadsheet. One row per player, one tap for the common
 * case, and the inning pickers appear only for the player they apply to.
 */

export type Attendance = 'PRESENT' | 'LIMITED' | 'ABSENT';

const STATES: Array<{
  value: Attendance;
  label: string;
  /** Shape as well as colour: the tick, the clock and the cross differ. */
  glyph: string;
  active: string;
}> = [
  { value: 'PRESENT', label: 'Here', glyph: '✓', active: 'border-positive bg-positive-soft text-positive' },
  { value: 'LIMITED', label: 'Part', glyph: '◐', active: 'border-caution bg-caution-soft text-caution' },
  { value: 'ABSENT', label: 'Out', glyph: '✕', active: 'border-critical bg-critical-soft text-critical' },
];

export function attendanceOf(gp: GamePlayer, innings: number): Attendance {
  if (!gp.available) return 'ABSENT';
  const late = (gp.arrivalInning ?? 1) > 1;
  const early = gp.departureInning !== undefined && gp.departureInning < innings;
  return late || early ? 'LIMITED' : 'PRESENT';
}

/** The window fields, set so that the three states round-trip cleanly. */
function withAttendance(gp: GamePlayer, state: Attendance, innings: number): GamePlayer {
  if (state === 'ABSENT') {
    /* Windows are cleared: an absent player with a leftover arrival inning
       reads as Limited the moment they are marked back in. */
    return { ...gp, available: false, arrivalInning: undefined, departureInning: undefined };
  }
  if (state === 'PRESENT') {
    return { ...gp, available: true, arrivalInning: undefined, departureInning: undefined };
  }
  /* Limited needs a window that actually limits something, or the state would
     not survive a reload. Default to leaving after the second-to-last inning. */
  const alreadyLimited =
    (gp.arrivalInning ?? 1) > 1 ||
    (gp.departureInning !== undefined && gp.departureInning < innings);
  return alreadyLimited
    ? { ...gp, available: true }
    : { ...gp, available: true, departureInning: Math.max(1, innings - 1) };
}

export function WhosHere({
  game,
  players,
  names,
  previousGame,
  onChange,
  onNoteChange,
}: {
  game: Game;
  players: Player[];
  names: PlayerNames;
  /** The last game played, for "Use last game". */
  previousGame: Game | null;
  onChange: (gamePlayers: GamePlayer[]) => void;
  onNoteChange: (note: string) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(Boolean(game.note));
  const innings = game.plannedInnings;
  const counts = attendanceFor(game);

  const byId = new Map(game.gamePlayers.map((gp) => [gp.playerId, gp]));
  const roster = players.filter((player) => player.active && byId.has(player.id));

  const setAll = (state: Attendance) => {
    onChange(game.gamePlayers.map((gp) => withAttendance(gp, state, innings)));
  };

  const setOne = (playerId: string, state: Attendance) => {
    onChange(
      game.gamePlayers.map((gp) =>
        gp.playerId === playerId ? withAttendance(gp, state, innings) : gp,
      ),
    );
  };

  const setWindow = (playerId: string, field: 'arrivalInning' | 'departureInning', value: number | undefined) => {
    onChange(
      game.gamePlayers.map((gp) =>
        gp.playerId === playerId ? { ...gp, [field]: value } : gp,
      ),
    );
  };

  const useLastGame = () => {
    if (!previousGame) return;
    const previous = new Map(previousGame.gamePlayers.map((gp) => [gp.playerId, gp]));
    onChange(
      game.gamePlayers.map((gp) => {
        const before = previous.get(gp.playerId);
        if (!before) return gp;
        /* Copies who was there, not their innings windows: last week's late
           arrival is not evidence about this week. */
        return withAttendance(gp, before.available ? 'PRESENT' : 'ABSENT', innings);
      }),
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display text-2xl text-ink sm:text-3xl">Who&apos;s here?</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Tap anyone who isn&apos;t coming. Everyone starts marked here.
          </p>
        </div>
        <p className="flex items-baseline gap-1.5">
          <span className="display text-3xl text-ink">{counts.expected}</span>
          <span className="text-sm text-ink-muted">of {counts.total} expected</span>
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setAll('PRESENT')}>
          All here
        </Button>
        <Button size="sm" onClick={() => setAll('ABSENT')}>
          All out
        </Button>
        {previousGame ? (
          <Button size="sm" variant="ghost" onClick={useLastGame}>
            Same as last game
          </Button>
        ) : null}
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {roster.map((player) => {
          const gp = byId.get(player.id)!;
          const state = attendanceOf(gp, innings);
          return (
            <li
              key={player.id}
              className={cn(
                'rounded-xl border bg-surface p-3 transition-colors',
                state === 'ABSENT' ? 'border-border opacity-60' : 'border-border',
              )}
            >
              <div className="flex items-center gap-3">
                <PlayerChip
                  name={names.short(player.id)}
                  jerseyNumber={player.jerseyNumber}
                  className="min-w-0 flex-1"
                  muted={state === 'ABSENT'}
                />

                <div
                  role="radiogroup"
                  aria-label={`${names.short(player.id)} attendance`}
                  className="flex shrink-0 gap-1"
                >
                  {STATES.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={state === option.value}
                      aria-label={option.label}
                      title={
                        option.value === 'LIMITED'
                          ? 'Here for part of the game'
                          : option.label
                      }
                      onClick={() => setOne(player.id, option.value)}
                      className={cn(
                        'ring-focus flex h-9 min-w-9 items-center justify-center gap-1 rounded-lg border px-2 text-xs font-semibold transition-colors',
                        state === option.value
                          ? option.active
                          : 'border-border text-ink-subtle hover:text-ink',
                      )}
                    >
                      <span aria-hidden>{option.glyph}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* The innings window, only for the player it applies to. */}
              {state === 'LIMITED' ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-2.5 text-xs text-ink-muted">
                  <label className="flex items-center gap-1.5">
                    From inning
                    <Select
                      className="h-8 w-16"
                      value={gp.arrivalInning ?? 1}
                      onChange={(event) =>
                        setWindow(
                          player.id,
                          'arrivalInning',
                          Number(event.target.value) === 1
                            ? undefined
                            : Number(event.target.value),
                        )
                      }
                    >
                      {Array.from({ length: innings }, (_, i) => i + 1).map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="flex items-center gap-1.5">
                    through
                    <Select
                      className="h-8 w-16"
                      value={gp.departureInning ?? innings}
                      onChange={(event) =>
                        setWindow(
                          player.id,
                          'departureInning',
                          Number(event.target.value) === innings
                            ? undefined
                            : Number(event.target.value),
                        )
                      }
                    >
                      {Array.from({ length: innings }, (_, i) => i + 1).map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {counts.limited > 0 ? (
        <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <Badge tone="caution">Part of the game</Badge>
          InningGrid only expects innings from players for the part they&apos;re there —
          nobody falls behind for time they couldn&apos;t play.
        </p>
      ) : null}

      {/* An optional note, collapsed. Attendance is not a form. */}
      <div className="mt-5">
        {noteOpen ? (
          <div>
            <Label htmlFor="game-note">Note for this game</Label>
            <Input
              id="game-note"
              className="mt-1.5"
              placeholder="Doubleheader, short bench, umpire running late…"
              value={game.note ?? ''}
              onChange={(event) => onNoteChange(event.target.value)}
            />
            <p className="mt-1.5 text-xs text-ink-subtle">
              Notes are for you. They never appear on a shared lineup.
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setNoteOpen(true)}
            className="ring-focus rounded-md text-sm text-ink-muted underline hover:text-ink"
          >
            Add a note about this game
          </button>
        )}
      </div>
    </div>
  );
}
