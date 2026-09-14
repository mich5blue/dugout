import { playerNames, type PlayerNames } from '@/lib/playerNames';
import type {
  AssignmentType,
  DefensiveAssignment,
  Game,
  Player,
  PositionDefinition,
} from '@/domain/types';

/**
 * Read-only projection of a game for rendering. The UI never assumes a
 * position exists — it always renders whatever the game's formation snapshot
 * contains.
 */

export const UNAVAILABLE = 'UNAVAILABLE' as const;

export interface GameView {
  game: Game;
  positions: PositionDefinition[];
  innings: number[];
  players: Player[];
  playerById: Map<string, Player>;
  /**
   * Display names resolved against this game's roster, so two players who
   * share a first name are separated by jersey number. Every surface that
   * shows a name to a coach, a kid or a parent should use these rather than
   * the unqualified helpers in domain/factories.
   */
  names: PlayerNames;
  hasLineup: boolean;
  assignmentAt(inning: number, positionId: string): DefensiveAssignment | undefined;
  playerAt(inning: number, positionId: string): Player | undefined;
  /** Position the player occupies, null for bench, UNAVAILABLE when absent. */
  slotOf(playerId: string, inning: number): PositionDefinition | null | typeof UNAVAILABLE;
  isAvailable(playerId: string, inning: number): boolean;
  availableAt(inning: number): Player[];
  benchAt(inning: number): Player[];
  defensiveInnings(playerId: string): number;
  benchInnings(playerId: string): number;
  battingOrder(): Array<{ player: Player; slot: number; locked: boolean }>;
}

export function buildGameView(
  game: Game,
  roster: Player[],
  assignmentType: AssignmentType = 'PLANNED',
): GameView {
  const positions = [...game.formationSnapshot.positions].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const innings = Array.from({ length: game.plannedInnings }, (_, i) => i + 1);
  const playerById = new Map(roster.map((player) => [player.id, player]));

  // Prefer the requested type, falling back to PLANNED so a partially recorded
  // game still renders completely.
  const cells = new Map<string, DefensiveAssignment>();
  for (const assignment of game.defensiveAssignments) {
    const key = `${assignment.inning}|${assignment.positionId}`;
    const existing = cells.get(key);
    if (!existing) {
      cells.set(key, assignment);
      continue;
    }
    if (assignment.assignmentType === assignmentType && existing.assignmentType !== assignmentType) {
      cells.set(key, assignment);
    }
  }

  const byPlayerInning = new Map<string, string>();
  for (const assignment of cells.values()) {
    byPlayerInning.set(`${assignment.playerId}|${assignment.inning}`, assignment.positionId);
  }

  const availability = new Map(
    game.gamePlayers.map((gp) => [
      gp.playerId,
      {
        available: gp.available,
        arrival: gp.arrivalInning ?? 1,
        departure: gp.departureInning ?? game.plannedInnings,
      },
    ]),
  );

  const isAvailable = (playerId: string, inning: number): boolean => {
    const window = availability.get(playerId);
    if (!window || !window.available) return false;
    return inning >= window.arrival && inning <= window.departure;
  };

  const positionById = new Map(positions.map((position) => [position.id, position]));

  const view: GameView = {
    game,
    names: playerNames(roster),
    positions,
    innings,
    players: roster.filter((player) => availability.has(player.id)),
    playerById,
    hasLineup: cells.size > 0,
    assignmentAt: (inning, positionId) => cells.get(`${inning}|${positionId}`),
    playerAt: (inning, positionId) => {
      const assignment = cells.get(`${inning}|${positionId}`);
      return assignment ? playerById.get(assignment.playerId) : undefined;
    },
    slotOf: (playerId, inning) => {
      if (!isAvailable(playerId, inning)) return UNAVAILABLE;
      const positionId = byPlayerInning.get(`${playerId}|${inning}`);
      if (!positionId) return null;
      return positionById.get(positionId) ?? null;
    },
    isAvailable,
    availableAt: (inning) =>
      roster.filter((player) => isAvailable(player.id, inning)),
    benchAt: (inning) =>
      roster.filter(
        (player) =>
          isAvailable(player.id, inning) && !byPlayerInning.has(`${player.id}|${inning}`),
      ),
    defensiveInnings: (playerId) =>
      innings.reduce(
        (acc, inning) => acc + (byPlayerInning.has(`${playerId}|${inning}`) ? 1 : 0),
        0,
      ),
    benchInnings: (playerId) =>
      innings.reduce(
        (acc, inning) =>
          acc +
          (isAvailable(playerId, inning) && !byPlayerInning.has(`${playerId}|${inning}`)
            ? 1
            : 0),
        0,
      ),
    battingOrder: () =>
      [...game.battingAssignments]
        .sort((a, b) => a.battingSlot - b.battingSlot)
        .flatMap((assignment) => {
          const player = playerById.get(assignment.playerId);
          if (!player) return [];
          return [{ player, slot: assignment.battingSlot, locked: assignment.locked }];
        }),
  };

  return view;
}

/** Inning-to-inning changes, for the mobile game-day view. */
export interface InningChange {
  playerId: string;
  playerName: string;
  from: string;
  to: string;
}

export function inningChanges(
  view: GameView,
  fromInning: number,
  toInning: number,
): InningChange[] {
  const changes: InningChange[] = [];
  /* Disambiguated against the roster: two Jacks on one bench make an
     unqualified first name useless in exactly the moment this is read. */
  const resolver = playerNames(view.players);

  for (const player of view.players) {
    const before = view.slotOf(player.id, fromInning);
    const after = view.slotOf(player.id, toInning);
    if (before === UNAVAILABLE && after === UNAVAILABLE) continue;

    const label = (slot: typeof before): string => {
      if (slot === UNAVAILABLE) return 'Out';
      if (slot === null) return 'Bench';
      return slot.code;
    };

    const fromLabel = label(before);
    const toLabel = label(after);
    if (fromLabel === toLabel) continue;

    changes.push({
      playerId: player.id,
      playerName: resolver.short(player.id),
      from: fromLabel,
      to: toLabel,
    });
  }

  return changes;
}
