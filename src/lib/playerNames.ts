import type { Player } from '@/domain/types';

/**
 * What to call a player on screen and on paper.
 *
 * InningGrid stores a first name and at most a last initial — never a full
 * surname. Rosters of children end up in printed sheets, on a dugout wall and
 * inside share links that get forwarded through group chats, and a surname is
 * the field that turns a first name into an identifiable child. Nothing in the
 * product ever needed one: it was only ever typed in and printed out.
 *
 * That leaves disambiguation, which is this module's job. The naive answer is
 * "Jack B.", and it is a poor one — it is awkward, and it still collides for
 * Jack Brown and Jack Barnes. The jersey number is better on every count: it
 * is already stored, it is printed on the back of the child, and a parent or
 * scorekeeper can check it from the bleachers.
 *
 * So names are resolved against the roster rather than per player, and widened
 * only as far as they need to be:
 *
 *   1. first name, when no other player on the roster shares it
 *   2. first name + jersey number
 *   3. first name + last initial, when there is no number to use
 *   4. first name alone, when there is nothing left to separate them
 *
 * Step 4 is a real outcome, not an error — a coach who has entered two Jacks
 * with no numbers and no initials has not given us anything to work with, and
 * inventing a suffix would be worse than the ambiguity.
 */

export interface PlayerNames {
  /** For grids, sheets and anywhere space is tight. */
  short(playerId: string): string;
  /** For rosters, pickers and detail views. Carries the initial when there is one. */
  full(playerId: string): string;
  /**
   * First name and initial, with no disambiguation appended.
   *
   * For surfaces that already print the jersey number in its own column — the
   * dugout wall sheet, the Live view rows. There the visible number is the
   * disambiguator, so appending it to the name as well just prints it twice.
   */
  plain(playerId: string): string;
}

/** Trailing "." only when the initial does not already carry one. */
function initialWithStop(initial: string): string {
  const trimmed = initial.trim();
  if (trimmed === '') return '';
  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
}

function firstNameKey(player: Pick<Player, 'firstName'>): string {
  return player.firstName.trim().toLowerCase();
}

export function playerNames(players: Player[]): PlayerNames {
  const byId = new Map(players.map((player) => [player.id, player]));

  const sharedFirstName = new Set<string>();
  const seen = new Set<string>();
  for (const player of players) {
    const key = firstNameKey(player);
    if (key === '') continue;
    if (seen.has(key)) sharedFirstName.add(key);
    seen.add(key);
  }

  const resolve = (playerId: string, includeInitial: boolean): string => {
    const player = byId.get(playerId);
    if (!player) return '';

    const first = player.firstName.trim();
    const initial = initialWithStop(player.lastInitial ?? '');
    const base = includeInitial && initial !== '' ? `${first} ${initial}` : first;
    if (base === '') return initial;

    if (!sharedFirstName.has(firstNameKey(player))) return base;

    /*
      Ambiguous. The number wins over the initial because it is the thing on
      the child's back, and because two Jacks can easily share an initial.
    */
    const jersey = player.jerseyNumber?.trim();
    if (jersey) return `${base} #${jersey}`;
    if (!includeInitial && initial !== '') return `${first} ${initial}`;
    return base;
  };

  const plain = (playerId: string): string => {
    const player = byId.get(playerId);
    if (!player) return '';
    const initial = initialWithStop(player.lastInitial ?? '');
    return `${player.firstName.trim()} ${initial}`.trim();
  };

  return {
    short: (playerId) => resolve(playerId, false),
    full: (playerId) => resolve(playerId, true),
    plain,
  };
}
