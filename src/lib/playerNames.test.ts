import { describe, expect, it } from 'vitest';
import type { Player } from '@/domain/types';
import { playerNames } from '@/lib/playerNames';

function p(
  id: string,
  firstName: string,
  lastInitial?: string,
  jerseyNumber?: string,
): Player {
  return { id, firstName, lastInitial, jerseyNumber } as Player;
}

describe('player display names', () => {
  it('uses the bare first name when nothing else shares it', () => {
    const names = playerNames([p('1', 'Jack', 'B', '8'), p('2', 'Weston', 'C', '4')]);
    expect(names.short('1')).toBe('Jack');
    expect(names.short('2')).toBe('Weston');
  });

  it('carries the initial in full names', () => {
    const names = playerNames([p('1', 'Jack', 'B', '8')]);
    expect(names.full('1')).toBe('Jack B.');
  });

  it('reaches for the jersey number before the initial', () => {
    // Two Jacks who also share an initial: "Jack B." would not separate them.
    const names = playerNames([p('1', 'Jack', 'B', '8'), p('2', 'Jack', 'B', '12')]);
    expect(names.short('1')).toBe('Jack #8');
    expect(names.short('2')).toBe('Jack #12');
    expect(names.full('1')).toBe('Jack B. #8');
  });

  it('falls back to the initial when there is no number', () => {
    const names = playerNames([p('1', 'Jack', 'B'), p('2', 'Jack', 'M')]);
    expect(names.short('1')).toBe('Jack B.');
    expect(names.short('2')).toBe('Jack M.');
  });

  it('leaves two bare first names alone rather than inventing a suffix', () => {
    const names = playerNames([p('1', 'Jack'), p('2', 'Jack')]);
    expect(names.short('1')).toBe('Jack');
    expect(names.short('2')).toBe('Jack');
  });

  it('matches first names case- and space-insensitively', () => {
    const names = playerNames([p('1', 'jack ', 'B', '8'), p('2', 'Jack', 'M', '9')]);
    expect(names.short('1')).toBe('jack #8');
    expect(names.short('2')).toBe('Jack #9');
  });

  it('does not add a second full stop to an initial that has one', () => {
    const names = playerNames([p('1', 'Jack', 'B.')]);
    expect(names.full('1')).toBe('Jack B.');
  });

  it('handles a missing initial', () => {
    const names = playerNames([p('1', 'Jack')]);
    expect(names.full('1')).toBe('Jack');
  });

  it('returns empty for a player who is not on the roster it was built from', () => {
    const names = playerNames([p('1', 'Jack')]);
    expect(names.short('nope')).toBe('');
  });

  it('only disambiguates the names that actually collide', () => {
    const names = playerNames([
      p('1', 'Jack', 'B', '8'),
      p('2', 'Jack', 'M', '9'),
      p('3', 'Weston', 'C', '4'),
    ]);
    expect(names.short('1')).toBe('Jack #8');
    expect(names.short('3')).toBe('Weston');
  });
});
