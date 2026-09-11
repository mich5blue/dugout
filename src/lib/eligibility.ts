import type { Eligibility, Game, Player, PositionDefinition } from '@/domain/types';

/**
 * Whether a player may take a position in a given game.
 *
 * Shared by every editing surface so the drag targets on the diamond and the
 * options in the swap picker can never disagree about what is legal.
 */

/** A position the coach's can-pitch / can-catch flag rules out entirely. */
export const ROLE_BLOCKED = 'ROLE_BLOCKED' as const;

export type EditEligibility = Eligibility | typeof ROLE_BLOCKED;

export function eligibilityFor(
  game: Game,
  player: Player,
  position: PositionDefinition,
): EditEligibility {
  const overridden = game.eligibilityOverrides.some(
    (entry) => entry.playerId === player.id && entry.positionId === position.id,
  );
  if (overridden) return 'ALLOWED';

  if (position.role === 'PITCHER' && !player.canPitch) return ROLE_BLOCKED;
  if (position.role === 'CATCHER' && !player.canCatch) return ROLE_BLOCKED;

  return player.positionRatings[position.id]?.eligibility ?? 'ALLOWED';
}

/** True when the assignment needs no override from the coach. */
export function canPlay(
  game: Game,
  player: Player,
  position: PositionDefinition,
): boolean {
  const eligibility = eligibilityFor(game, player, position);
  return eligibility !== 'NEVER' && eligibility !== ROLE_BLOCKED;
}

export function eligibilityLabel(eligibility: EditEligibility, position: PositionDefinition): string {
  switch (eligibility) {
    case 'PREFERRED':
      return 'Preferred';
    case 'AVOID':
      return 'Avoid';
    case 'NEVER':
      return 'Never';
    case ROLE_BLOCKED:
      return position.role === 'PITCHER' ? 'Not a pitcher' : 'Not a catcher';
    default:
      return 'Allowed';
  }
}

/** Ranking used when listing candidates for a position. */
export function eligibilityRank(eligibility: EditEligibility): number {
  switch (eligibility) {
    case 'PREFERRED':
      return 0;
    case 'ALLOWED':
      return 1;
    case 'AVOID':
      return 2;
    case 'NEVER':
      return 3;
    default:
      return 4;
  }
}
