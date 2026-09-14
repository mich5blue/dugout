import type { Game } from '@/domain/types';
import { todayIso } from '@/lib/format';

/**
 * Season order.
 *
 * One module so every surface agrees on what "next game" means. The schedule
 * list and the prev/next arrows on a game both read from here, which is the
 * only way walking the season with the arrows can land in the same order the
 * list showed.
 */

/**
 * Chronological, oldest first.
 *
 * Tie-broken on id so two games on the same date have a stable order rather
 * than one that depends on how the store happened to return them. Without it
 * a doubleheader would swap places between renders and the arrows would
 * disagree with the list.
 */
export function orderedGames(games: Game[]): Game[] {
  return [...games].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
}

/**
 * Still to be played, soonest first.
 *
 * Dated today or later, not merely unrecorded. Filtering on status alone meant
 * a game from May still billed itself as "Next game" in September, because
 * nobody had got round to recording it — the dashboard pointed at a game that
 * had already happened.
 */
export function upcomingGames(games: Game[], today: string = todayIso()): Game[] {
  return orderedGames(games).filter(
    (game) => game.status !== 'COMPLETED' && game.date >= today,
  );
}

/**
 * Played, but never recorded — oldest first.
 *
 * These are the games holding the season back. Every season number comes from
 * recorded results, so a coach who never opens "Record results" gets an empty
 * Season page and no fairness carry-over at all: the thing the product is for
 * silently does not run. Surfacing them is what makes the season engine
 * self-starting.
 */
export function awaitingResults(games: Game[], today: string = todayIso()): Game[] {
  return orderedGames(games).filter(
    (game) => game.status !== 'COMPLETED' && game.date < today,
  );
}

/** Recorded, most recent first. */
export function completedGames(games: Game[]): Game[] {
  return orderedGames(games)
    .filter((game) => game.status === 'COMPLETED')
    .reverse();
}

/**
 * The games either side of `gameId` in season order.
 *
 * Deliberately spans the whole season rather than only the upcoming games: the
 * arrows exist to walk through games, and stopping dead at the boundary
 * between recorded and planned would be a surprise rather than a guardrail.
 */
export function adjacentGames(
  games: Game[],
  gameId: string,
): { previous?: Game; next?: Game; position?: number; total: number } {
  const ordered = orderedGames(games);
  const index = ordered.findIndex((game) => game.id === gameId);
  if (index === -1) return { total: ordered.length };
  return {
    previous: index > 0 ? ordered[index - 1] : undefined,
    next: index < ordered.length - 1 ? ordered[index + 1] : undefined,
    position: index + 1,
    total: ordered.length,
  };
}

/** Whether a game already has a generated lineup. */
export function hasLineup(game: Game): boolean {
  return game.defensiveAssignments.length > 0;
}
