import { playerNames } from '@/lib/playerNames';
import { describe, expect, it } from 'vitest';
import { buildScenario, runScenario } from '@/test/fixtures';
import {
  buildSharePayload,
  decodeShare,
  encodeShare,
  lineupAsText,
  sharedPlayerAt,
} from './shareLink';

/**
 * Sharing has no backend, so the encoding is the feature. These tests cover the
 * round trip, the size budget, and the privacy guarantee that a coach's private
 * evaluations never travel in a link.
 */

const NAMES = [
  'Brody',
  'Race',
  'Weston',
  'Calvin',
  'Emerson',
  'Solomon',
  'Finnegan',
  'Vasil',
  'Mehki',
  'Ashur',
  'Walter',
];

async function sharedGame() {
  const scenario = buildScenario({
    innings: 6,
    seed: 5,
    players: NAMES.map((name, index) => ({
      name,
      canPitch: index < 7,
      canCatch: index % 2 === 0,
      tier: index < 3 ? ('CORE' as const) : ('REGULAR' as const),
      never: index > 8 ? ['1B'] : undefined,
    })),
  });

  const { result, game } = await runScenario(scenario);
  expect(result.ok).toBe(true);

  const payload = buildSharePayload(scenario.team, game, scenario.players);
  return { scenario, game, payload };
}

describe('share link', () => {
  it('round-trips a full lineup', async () => {
    const { payload } = await sharedGame();
    const token = await encodeShare(payload);
    const decoded = await decodeShare(token);

    expect(decoded).not.toBeNull();
    expect(decoded).toEqual(payload);
  });

  it('carries every assignment, inning by inning', async () => {
    const { game, scenario, payload } = await sharedGame();
    const token = await encodeShare(payload);
    const decoded = (await decodeShare(token))!;

    const codeOf = new Map(
      game.formationSnapshot.positions.map((position) => [position.id, position.code]),
    );
    const resolver = playerNames(scenario.players);
    const nameOf = new Map(
      scenario.players.map((player) => [player.id, resolver.short(player.id)]),
    );

    for (const assignment of game.defensiveAssignments.filter(
      (entry) => entry.assignmentType === 'PLANNED',
    )) {
      const positionIndex = decoded.p.indexOf(codeOf.get(assignment.positionId)!);
      expect(positionIndex).toBeGreaterThanOrEqual(0);
      expect(sharedPlayerAt(decoded, assignment.inning, positionIndex)).toBe(
        nameOf.get(assignment.playerId),
      );
    }
  });

  it('fits comfortably in a URL', async () => {
    const { payload } = await sharedGame();
    const token = await encodeShare(payload);

    // Browsers and messaging apps handle ~2000 characters without trouble; a
    // six-inning ten-position lineup should be nowhere near that.
    expect(token.length).toBeLessThan(1200);
    expect(token).toMatch(/^[cu][A-Za-z0-9_-]+$/);
  });

  it('never carries ability, restrictions or fairness debt', async () => {
    const { payload } = await sharedGame();
    const serialised = JSON.stringify(payload);

    for (const leak of [
      'CORE',
      'DEVELOPING',
      'REGULAR',
      'NEVER',
      'AVOID',
      'PREFERRED',
      'overallTier',
      'positionRatings',
      'debt',
      'canPitch',
    ]) {
      expect(serialised).not.toContain(leak);
    }
  });

  it('rejects a token that is not a lineup', async () => {
    expect(await decodeShare('')).toBeNull();
    expect(await decodeShare('cnonsense')).toBeNull();
    expect(await decodeShare('u' + Buffer.from('{"v":2}').toString('base64url'))).toBeNull();
    expect(await decodeShare('u' + Buffer.from('not json').toString('base64url'))).toBeNull();
  });

  it('survives the uncompressed fallback', async () => {
    const { payload } = await sharedGame();
    // Simulates a browser without CompressionStream.
    const token = 'u' + Buffer.from(JSON.stringify(payload)).toString('base64url');
    expect(await decodeShare(token)).toEqual(payload);
  });

  it('renders text a coach can paste into a group chat', async () => {
    const { payload } = await sharedGame();
    const text = lineupAsText(payload);

    expect(text).toContain('vs Opponent');
    expect(text).toContain('BATTING');
    expect(text).toContain('1. Brody');
    expect(text).toContain('INNING 1');
    expect(text).toContain('INNING 6');

    // Every inning lists every position.
    for (const code of ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LC', 'RC', 'RF']) {
      expect(text).toContain(`${code} — `);
    }

    // Narrow-friendly: nothing wraps badly in a phone-width chat.
    for (const line of text.split('\n')) {
      expect(line.length).toBeLessThan(40);
    }
  });
});
