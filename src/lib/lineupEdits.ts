import type { AssignmentType, Game, Player } from '@/domain/types';
import { rotateBattingOrder } from '@/optimizer/batting';
import { buildGameView, UNAVAILABLE } from '@/lib/gameView';
import { adjacentGames } from '@/lib/schedule';
import { whyNotEligible } from '@/lib/whyAssignment';
import { setAssignment, setBattingOrder } from '@/services/lineupService';

/**
 * Hand edits to a generated lineup, shared by the website and the native app.
 *
 * Each one goes through `setAssignment` / `setBattingOrder`, so a move swaps
 * rather than displaces, and edits to a completed game land on the ACTUAL
 * record the season counts.
 */

/** Which rows an edit writes: once a game is completed, the record is the truth. */
export function editTypeFor(game: Game): AssignmentType {
  return game.status === 'COMPLETED' ? 'ACTUAL' : 'PLANNED';
}

export interface PositionOption {
  positionId: string;
  code: string;
  displayName: string;
  group: string;
  /** Why this player can't play here, or null. */
  blocked: string | null;
  /** Who is there this inning now, if anyone. */
  occupantId: string | null;
  current: boolean;
}

/** Everywhere one player could go in one inning, for "move Brody". */
export function positionOptions(
  game: Game,
  players: Player[],
  playerId: string,
  inning: number,
): { state: 'FIELD' | 'REST' | 'OUT'; options: PositionOption[] } {
  const view = buildGameView(game, players, editTypeFor(game));
  const slot = view.slotOf(playerId, inning);
  const state = slot === UNAVAILABLE ? 'OUT' : slot === null ? 'REST' : 'FIELD';
  const options = view.positions.map((position) => ({
    positionId: position.id,
    code: position.code,
    displayName: position.displayName,
    group: position.group,
    blocked: whyNotEligible(view, playerId, position),
    occupantId: view.playerAt(inning, position.id)?.id ?? null,
    current: slot !== UNAVAILABLE && slot !== null && slot.id === position.id,
  }));
  return { state, options };
}

/** Put a player at a position for an inning; whoever was there swaps. */
export function movePlayer(game: Game, playerId: string, inning: number, positionId: string): Game {
  return setAssignment(game, inning, positionId, playerId, editTypeFor(game));
}

/** Rest a player for an inning. */
export function restPlayer(game: Game, players: Player[], playerId: string, inning: number): Game {
  const slot = buildGameView(game, players, editTypeFor(game)).slotOf(playerId, inning);
  if (slot === null || slot === UNAVAILABLE) return game;
  return setAssignment(game, inning, slot.id, null, editTypeFor(game));
}

/** A new batting order, top to bottom. */
export function reorderBatting(game: Game, playerIds: string[]): Game {
  return setBattingOrder(
    game,
    playerIds.map((playerId, index) => ({ playerId, battingSlot: index + 1 })),
  );
}

/**
 * Everyone moves up `offset` spots from the previous game's order, filtered
 * to who is here today. Rotated from the last game, which is the only thing
 * that makes "everyone moves up two" mean anything across a season.
 */
export function rotateBattingFromPrevious(
  game: Game,
  games: Game[],
  players: Player[],
  offset: number,
): Game | null {
  const previous = adjacentGames(games, game.id).previous;
  if (!previous) return null;
  const here = players
    .filter((player) => game.gamePlayers.some((gp) => gp.playerId === player.id && gp.available))
    .map((player) => player.id);
  const rotated = rotateBattingOrder(previous.battingAssignments, offset, here);
  return setBattingOrder(
    game,
    rotated.map((entry) => ({ playerId: entry.playerId, battingSlot: entry.battingSlot, locked: entry.locked })),
  );
}
