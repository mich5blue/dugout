import type { Game, GamePlayer } from '@/domain/types';
import { orderedGames } from '@/lib/schedule';

/**
 * Who's here, in three states — shared by the website and the native app.
 *
 * "Part" is not a new concept: the data model has carried `arrivalInning` and
 * `departureInning` from the start and the optimizer builds around them. These
 * functions are how a tap becomes those fields, so the same tap means the same
 * thing on both platforms.
 */
export type Attendance = 'PRESENT' | 'LIMITED' | 'ABSENT';

export function attendanceOf(gp: GamePlayer, innings: number): Attendance {
  if (!gp.available) return 'ABSENT';
  const late = (gp.arrivalInning ?? 1) > 1;
  const early = gp.departureInning !== undefined && gp.departureInning < innings;
  return late || early ? 'LIMITED' : 'PRESENT';
}

/** The window fields, set so that the three states round-trip cleanly. */
export function withAttendance(gp: GamePlayer, state: Attendance, innings: number): GamePlayer {
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

export function setAttendance(game: Game, playerId: string, state: Attendance): Game {
  return {
    ...game,
    gamePlayers: game.gamePlayers.map((gp) =>
      gp.playerId === playerId ? withAttendance(gp, state, game.plannedInnings) : gp,
    ),
  };
}

export function setAllAttendance(game: Game, state: Attendance): Game {
  return {
    ...game,
    gamePlayers: game.gamePlayers.map((gp) => withAttendance(gp, state, game.plannedInnings)),
  };
}

/** Arrives in / leaves after an inning. `undefined` clears it. */
export function setAttendanceWindow(
  game: Game,
  playerId: string,
  field: 'arrivalInning' | 'departureInning',
  value: number | undefined,
): Game {
  return {
    ...game,
    gamePlayers: game.gamePlayers.map((gp) =>
      gp.playerId === playerId ? { ...gp, [field]: value } : gp,
    ),
  };
}

/** The last completed game before this one, for "Same as last game". */
export function previousGameFor(game: Game, games: Game[]): Game | null {
  const played = orderedGames(games).filter(
    (entry) => entry.status === 'COMPLETED' && entry.date < game.date,
  );
  return played[played.length - 1] ?? null;
}

/**
 * Who was there last game, copied onto this one. Copies presence, not
 * innings windows: last week's late arrival is not evidence about this week.
 */
export function copyAttendance(game: Game, previous: Game): Game {
  const before = new Map(previous.gamePlayers.map((gp) => [gp.playerId, gp]));
  return {
    ...game,
    gamePlayers: game.gamePlayers.map((gp) => {
      const last = before.get(gp.playerId);
      if (!last) return gp;
      return withAttendance(gp, last.available ? 'PRESENT' : 'ABSENT', game.plannedInnings);
    }),
  };
}
