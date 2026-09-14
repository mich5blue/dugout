import type { Game, Player, Team } from '@/domain/types';
import { playerNames } from './playerNames';
import { buildGameView, UNAVAILABLE } from './gameView';

/**
 * Read-only lineup sharing with no backend.
 *
 * The whole lineup is encoded into the link itself, so sharing costs nothing to
 * run and there is no database, no account and no expiry to manage. The
 * trade-off is deliberate: a link is a bearer token, so anyone holding it can
 * read the lineup.
 *
 * What travels in the link is exactly what a parent should see — names, batting
 * order, positions by inning, bench. Ability tiers, position restrictions,
 * fairness debt and coach notes are never encoded, so a shared link cannot leak
 * a coach's private evaluations even if someone decodes it by hand.
 */

/** Position group, shortened for the URL. */
type GroupCode = 'B' | 'I' | 'O';

export interface SharePayload {
  /** Format version, so an old link can still be read after changes. */
  v: 1;
  /** Team name. */
  t: string;
  /** Opponent. */
  o: string;
  /** Date, ISO yyyy-mm-dd. */
  d: string;
  /** Innings. */
  i: number;
  /** Position codes in formation order. */
  p: string[];
  /** Position groups, parallel to `p`. */
  g: GroupCode[];
  /** Player display names. */
  n: string[];
  /**
   * Assignments, flattened inning-major: index `(inning - 1) * positions +
   * position` holds the player index, or -1 when unfilled.
   */
  a: number[];
  /** Batting order as player indices, in slot order. */
  b: number[];
  /** Bench player indices per inning. Carried rather than derived, because a
   *  viewer cannot know who was unavailable. */
  bn: number[][];
}

const GROUP_TO_CODE: Record<string, GroupCode> = {
  BATTERY: 'B',
  INFIELD: 'I',
  OUTFIELD: 'O',
};

export const GROUP_FROM_CODE: Record<GroupCode, 'BATTERY' | 'INFIELD' | 'OUTFIELD'> = {
  B: 'BATTERY',
  I: 'INFIELD',
  O: 'OUTFIELD',
};

/** Builds the payload from a game. Only shareable fields are read. */
export function buildSharePayload(team: Team, game: Game, roster: Player[]): SharePayload {
  const view = buildGameView(game, roster, 'PLANNED');

  /* A share link is forwarded through group chats, so it carries the
     disambiguated short name and never a surname. */
  const resolver = playerNames(view.players);
  const names: string[] = [];
  const indexOf = new Map<string, number>();
  for (const player of view.players) {
    indexOf.set(player.id, names.length);
    names.push(resolver.short(player.id));
  }

  const positions = view.positions;
  const assignments: number[] = [];
  for (const inning of view.innings) {
    for (const position of positions) {
      const player = view.playerAt(inning, position.id);
      assignments.push(player ? indexOf.get(player.id) ?? -1 : -1);
    }
  }

  return {
    v: 1,
    t: team.name,
    o: game.opponent,
    d: game.date,
    i: game.plannedInnings,
    p: positions.map((position) => position.code),
    g: positions.map((position) => GROUP_TO_CODE[position.group] ?? 'I'),
    n: names,
    a: assignments,
    b: view
      .battingOrder()
      .map((entry) => indexOf.get(entry.player.id) ?? -1)
      .filter((index) => index >= 0),
    bn: view.innings.map((inning) =>
      view
        .benchAt(inning)
        .map((player) => indexOf.get(player.id) ?? -1)
        .filter((index) => index >= 0),
    ),
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(token: string): Uint8Array {
  const base64 = token.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  if (typeof atob === 'function') {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

async function deflate(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(
    new CompressionStream('deflate-raw'),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(
    new DecompressionStream('deflate-raw'),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Encodes a payload into a URL-safe token.
 *
 * Prefixed with the encoding used rather than sniffed on the way back in:
 * `c` compressed, `u` uncompressed. A six-inning ten-position lineup is a few
 * hundred characters compressed, well inside every browser's URL limit.
 */
export async function encodeShare(payload: SharePayload): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(payload));

  if (typeof CompressionStream === 'function') {
    try {
      return `c${toBase64Url(await deflate(json))}`;
    } catch {
      // Fall through to the uncompressed form rather than failing to share.
    }
  }
  return `u${toBase64Url(json)}`;
}

export async function decodeShare(token: string): Promise<SharePayload | null> {
  try {
    const marker = token.slice(0, 1);
    const body = token.slice(1);
    const bytes = fromBase64Url(body);

    const json =
      marker === 'c'
        ? new TextDecoder().decode(await inflate(bytes))
        : new TextDecoder().decode(bytes);

    const parsed = JSON.parse(json) as SharePayload;
    if (parsed.v !== 1 || !Array.isArray(parsed.p) || !Array.isArray(parsed.n)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Player at a position in an inning, or null. Innings are 1-based. */
export function sharedPlayerAt(
  payload: SharePayload,
  inning: number,
  positionIndex: number,
): string | null {
  const index = payload.a[(inning - 1) * payload.p.length + positionIndex];
  if (index === undefined || index < 0) return null;
  return payload.n[index] ?? null;
}

/**
 * Plain text for a group chat.
 *
 * Built for a phone screen pasted into GroupMe or a text thread: batting order
 * first because that is what parents ask about, then the rotation one inning per
 * block so it survives narrow wrapping.
 */
export function lineupAsText(payload: SharePayload): string {
  const lines: string[] = [];

  lines.push(`${payload.t} vs ${payload.o || 'TBD'}`);
  lines.push(payload.d);
  lines.push('');

  lines.push('BATTING');
  payload.b.forEach((playerIndex, slot) => {
    lines.push(`${slot + 1}. ${payload.n[playerIndex]}`);
  });

  for (let inning = 1; inning <= payload.i; inning++) {
    lines.push('');
    lines.push(`INNING ${inning}`);
    payload.p.forEach((code, positionIndex) => {
      const name = sharedPlayerAt(payload, inning, positionIndex);
      lines.push(`${code} — ${name ?? '—'}`);
    });
    const bench = (payload.bn[inning - 1] ?? []).map((index) => payload.n[index]);
    if (bench.length > 0) lines.push(`Bench — ${bench.join(', ')}`);
  }

  return lines.join('\n');
}

export { UNAVAILABLE };
