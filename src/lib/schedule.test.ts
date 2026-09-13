import { describe, expect, it } from 'vitest';
import type { Game } from '@/domain/types';
import {
  adjacentGames,
  completedGames,
  orderedGames,
  upcomingGames,
} from '@/lib/schedule';

function game(id: string, date: string, status: Game['status'] = 'PLANNED'): Game {
  return { id, date, status } as Game;
}

/** Deliberately unsorted, with two games on one date. */
const GAMES = [
  game('c', '2026-05-09'),
  game('a', '2026-04-25', 'COMPLETED'),
  game('d', '2026-05-16'),
  game('b2', '2026-05-02'),
  game('b1', '2026-05-02'),
];

describe('season order', () => {
  it('sorts by date, then by id for stability', () => {
    expect(orderedGames(GAMES).map((g) => g.id)).toEqual(['a', 'b1', 'b2', 'c', 'd']);
  });

  it('does not mutate the input', () => {
    const before = GAMES.map((g) => g.id);
    orderedGames(GAMES);
    expect(GAMES.map((g) => g.id)).toEqual(before);
  });

  it('splits upcoming from completed, each in reading order', () => {
    expect(upcomingGames(GAMES).map((g) => g.id)).toEqual(['b1', 'b2', 'c', 'd']);
    expect(completedGames(GAMES).map((g) => g.id)).toEqual(['a']);
  });

  it('walks the whole season with the arrows', () => {
    expect(adjacentGames(GAMES, 'b2')).toMatchObject({
      previous: expect.objectContaining({ id: 'b1' }),
      next: expect.objectContaining({ id: 'c' }),
      position: 3,
      total: 5,
    });
  });

  it('has no previous at the start and no next at the end', () => {
    const first = adjacentGames(GAMES, 'a');
    expect(first.previous).toBeUndefined();
    expect(first.next?.id).toBe('b1');

    const last = adjacentGames(GAMES, 'd');
    expect(last.previous?.id).toBe('c');
    expect(last.next).toBeUndefined();
  });

  it('crosses the recorded/planned boundary rather than stopping at it', () => {
    // 'a' is completed and 'b1' is planned; the arrows still connect them.
    expect(adjacentGames(GAMES, 'a').next?.id).toBe('b1');
  });

  it('reports nothing useful for an unknown game', () => {
    expect(adjacentGames(GAMES, 'nope')).toEqual({ total: 5 });
  });
});
