import { describe, expect, it } from 'vitest';
import type { Player } from '@/domain/types';
import { migratePlayer, needsMigration } from '@/data/migratePlayer';

/** A player as stored before surnames were dropped. */
function legacy(lastName: string, extra: Partial<Player> = {}): Player {
  return { id: 'p1', firstName: 'Brody', lastName, ...extra } as unknown as Player;
}

describe('surname migration', () => {
  it('reduces a stored surname to its initial', () => {
    expect(migratePlayer(legacy('Borek')).lastInitial).toBe('B');
  });

  it('drops the surname rather than keeping it alongside the initial', () => {
    const migrated = migratePlayer(legacy('Borek'));
    expect('lastName' in migrated).toBe(false);
  });

  it('leaves an already-migrated player untouched', () => {
    const current = { id: 'p1', firstName: 'Brody', lastInitial: 'B' } as Player;
    expect(migratePlayer(current)).toBe(current);
    expect(needsMigration(current)).toBe(false);
  });

  it('prefers an initial that is already set over deriving one', () => {
    const both = legacy('Borek', { lastInitial: 'Z' } as Partial<Player>);
    expect(migratePlayer(both).lastInitial).toBe('Z');
  });

  it('handles an empty stored surname', () => {
    expect(migratePlayer(legacy('')).lastInitial).toBeUndefined();
    expect('lastName' in migratePlayer(legacy(''))).toBe(false);
  });

  it('detects what still needs migrating', () => {
    expect(needsMigration(legacy('Borek'))).toBe(true);
    expect(needsMigration(legacy(''))).toBe(true);
  });

  it('keeps every other field', () => {
    const migrated = migratePlayer(
      legacy('Borek', { jerseyNumber: '8', canPitch: true, active: true }),
    );
    expect(migrated).toMatchObject({
      id: 'p1',
      firstName: 'Brody',
      jerseyNumber: '8',
      canPitch: true,
      active: true,
    });
  });
});
