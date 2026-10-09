import { permittedPlayerChanges, type TeamRole } from '@/domain/access';
import type { Eligibility, Player } from '@/domain/types';

/**
 * Player edits, shared by the website and the native app.
 *
 * Every change goes through the role filter, so an assistant's edit carries
 * only the fields an assistant may change — on whichever device made it.
 */

/** The order a tap on a position steps through. */
export const ELIGIBILITY_CYCLE: Eligibility[] = ['PREFERRED', 'ALLOWED', 'AVOID', 'NEVER'];

export function nextEligibility(current: Eligibility): Eligibility {
  return ELIGIBILITY_CYCLE[(ELIGIBILITY_CYCLE.indexOf(current) + 1) % ELIGIBILITY_CYCLE.length];
}

export function updatePlayer(player: Player, role: TeamRole, changes: Partial<Player>): Player {
  return { ...player, ...permittedPlayerChanges(role, changes) };
}

export function cycleEligibility(player: Player, role: TeamRole, positionId: string): Player {
  const current = player.positionRatings[positionId]?.eligibility ?? 'ALLOWED';
  return updatePlayer(player, role, {
    positionRatings: {
      ...player.positionRatings,
      [positionId]: { positionId, eligibility: nextEligibility(current) },
    },
  });
}
