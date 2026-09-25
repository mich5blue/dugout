import type { Game } from '@/domain/types';
import { hasLineup } from '@/lib/schedule';

/**
 * What the coach should do next with this game, and where that happens.
 *
 * One place decides this because three surfaces ask the same question — Home's
 * primary button, the schedule row, and the game header — and a coach who is
 * told "Generate lineup" on one screen and "Confirm attendance" on the next
 * has been given two different next steps for the same game.
 *
 * Ordered by what blocks what: you cannot sensibly generate a lineup before
 * you know who turned up, and you cannot start a game without a lineup.
 */

export type NextActionKind =
  | 'CONFIRM_ATTENDANCE'
  | 'GENERATE'
  | 'START_GAME'
  | 'OPEN_LINEUP'
  | 'RECORD_RESULT';

export interface NextAction {
  kind: NextActionKind;
  /** The button. Imperative, and exactly what happens when pressed. */
  label: string;
  href: string;
  /** One line under the button, when the reason is not obvious. */
  hint?: string;
}

/** Is today on or after the game date, in the viewer's own timezone? */
function isTodayOrPast(game: Game, today: Date): boolean {
  /* Compared as YYYY-MM-DD strings: game.date has no time and no zone, so
     parsing it into a Date would shift it a day for anyone west of UTC. */
  const local = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`;
  return game.date <= local;
}

export function nextActionFor(game: Game, today: Date = new Date()): NextAction {
  if (game.status === 'COMPLETED') {
    return {
      kind: 'OPEN_LINEUP',
      label: 'Review game',
      href: `/games/${game.id}`,
    };
  }

  if (!hasLineup(game)) {
    if (!game.attendanceConfirmedAt) {
      return {
        kind: 'CONFIRM_ATTENDANCE',
        label: 'Confirm attendance',
        href: `/games/${game.id}/build`,
        hint: 'Takes about twenty seconds, then the lineup is one tap.',
      };
    }
    return {
      kind: 'GENERATE',
      label: 'Generate lineup',
      href: `/games/${game.id}/build?step=generate`,
    };
  }

  /* A lineup exists. If the game has arrived, the next thing is playing it. */
  if (game.status === 'IN_PROGRESS') {
    return {
      kind: 'START_GAME',
      label: 'Back to the game',
      href: `/games/${game.id}/live`,
    };
  }

  if (isTodayOrPast(game, today)) {
    return {
      kind: 'START_GAME',
      label: 'Start game',
      href: `/games/${game.id}/live`,
      hint: 'Opens the dugout view.',
    };
  }

  return {
    kind: 'OPEN_LINEUP',
    label: 'Open lineup',
    href: `/games/${game.id}`,
  };
}

/**
 * How much of the roster is expected, for the line above the button.
 *
 * `available` alone undercounts the useful detail: a player who is coming but
 * leaving after the fourth is present for this purpose and limited for the
 * lineup, and a coach reading "9 of 11" wants to know that.
 */
export interface Attendance {
  expected: number;
  absent: number;
  limited: number;
  total: number;
}

export function attendanceFor(game: Game): Attendance {
  let expected = 0;
  let absent = 0;
  let limited = 0;

  for (const gp of game.gamePlayers) {
    if (!gp.available) {
      absent++;
      continue;
    }
    expected++;
    const arrivesLate = (gp.arrivalInning ?? 1) > 1;
    const leavesEarly =
      gp.departureInning !== undefined && gp.departureInning < game.plannedInnings;
    if (arrivesLate || leavesEarly) limited++;
  }

  return { expected, absent, limited, total: game.gamePlayers.length };
}
