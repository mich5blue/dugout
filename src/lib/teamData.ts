import { migratePlayer } from '@/data/migratePlayer';
import type { Game, Player, Team } from '@/domain/types';

/**
 * How a team's stored documents become what the engine is given.
 *
 * Shared by the website and the iOS app (through src/core/api.ts) because the
 * order matters, not just the contents: the optimizer breaks ties by the order
 * players arrive in, so two apps that sorted the same roster differently could
 * build different lineups from identical data. One function, one order.
 */

/** Fields on a team document that describe who may see it, not the team. */
export const ACCESS_KEYS = ['ownerUid', 'memberUids', 'assistantEmails', 'roles'] as const;

export function stripAccess<T extends Record<string, unknown>>(data: T): Team {
  const team = { ...data } as Record<string, unknown>;
  for (const key of ACCESS_KEYS) delete team[key];
  return team as unknown as Team;
}

/**
 * Oldest first. Array.prototype.sort is stable in every engine since ES2019,
 * so players created in the same millisecond keep the order they arrived in —
 * which is document-id order from Firestore, on both platforms.
 */
export function orderPlayers(players: Player[], teamId?: string): Player[] {
  return players
    .filter((player) => teamId === undefined || player.teamId === teamId)
    .map((player) => migratePlayer(player as unknown as Parameters<typeof migratePlayer>[0]))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Newest first, as the schedule and the engine's history both expect. */
export function orderGames(games: Game[], teamId?: string): Game[] {
  return games
    .filter((game) => teamId === undefined || game.teamId === teamId)
    .sort((a, b) => b.date.localeCompare(a.date));
}
