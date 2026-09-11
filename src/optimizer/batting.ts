import type { PlayerSeasonUsage } from '@/domain/season';
import type { BattingPhilosophy } from '@/domain/types';
import type { SolverContext } from './context';
import { minCostAssignment } from './hungarian';
import type { PlannedBattingAssignment } from './types';

/**
 * Batting order generation, solved independently of the defensive rotation as
 * an exact minimum-cost assignment of slots to players.
 *
 * Fairness is measured on a *relative* slot (0 = leadoff, 1 = last) so that a
 * season with changing roster sizes still compares cleanly.
 */

const BATTING_TUNING = {
  /** Weight on evening out each player's season-average batting position. */
  fairnessScale: 100,
  /** Weight on putting stronger hitters in advantageous slots. */
  offenseScale: 40,
  /** Extra cost for extending a bottom-third streak, per game of streak. */
  bottomThirdStreakPenalty: 12,
  /** Weight on the season batting debt carried into this game. */
  debtScale: 20,
} as const;

const PHILOSOPHY_MIX: Record<BattingPhilosophy, { fairness: number; offense: number }> = {
  ROTATE_FAIRLY: { fairness: 1, offense: 0 },
  BALANCED: { fairness: 0.6, offense: 0.5 },
  COMPETITIVE: { fairness: 0.15, offense: 1 },
  MANUAL: { fairness: 1, offense: 0 },
};

/** Relative slot position: 0 for leadoff, 1 for the last spot. */
function relativeSlot(slot: number, orderSize: number): number {
  if (orderSize <= 1) return 0;
  return (slot - 1) / (orderSize - 1);
}

/**
 * Offensive value of a slot. Front of the order gets the most plate
 * appearances, with the classic small premium on the 3-4 spots.
 */
function slotOffensiveValue(slot: number, orderSize: number): number {
  const rel = relativeSlot(slot, orderSize);
  const appearances = 1 - 0.8 * rel;
  const heartOfOrder = slot >= 3 && slot <= 4 ? 0.1 : 0;
  return appearances + heartOfOrder;
}

function seasonRelativeAverage(usage: PlayerSeasonUsage): { sum: number; games: number } {
  let sum = 0;
  for (const entry of usage.battingHistory) {
    sum += relativeSlot(entry.slot, entry.orderSize);
  }
  return { sum, games: usage.battingHistory.length };
}

export function consecutiveBottomThird(usage: PlayerSeasonUsage): number {
  let streak = 0;
  for (let i = usage.battingHistory.length - 1; i >= 0; i--) {
    const entry = usage.battingHistory[i];
    if (relativeSlot(entry.slot, entry.orderSize) >= 2 / 3) streak++;
    else break;
  }
  return streak;
}

export function generateBattingOrder(ctx: SolverContext): PlannedBattingAssignment[] {
  const players = ctx.players;
  const orderSize = players.length;
  if (orderSize === 0) return [];

  const philosophy = ctx.settings.battingPhilosophy;
  const locked = ctx.input.lockedBattingSlots;

  const assignments: PlannedBattingAssignment[] = [];
  const takenSlots = new Set<number>();
  const placedPlayers = new Set<string>();

  for (const player of players) {
    const slot = locked[player.id];
    if (slot !== undefined && slot >= 1 && slot <= orderSize && !takenSlots.has(slot)) {
      assignments.push({ playerId: player.id, battingSlot: slot, locked: true });
      takenSlots.add(slot);
      placedPlayers.add(player.id);
    }
  }

  const openSlots: number[] = [];
  for (let slot = 1; slot <= orderSize; slot++) {
    if (!takenSlots.has(slot)) openSlots.push(slot);
  }
  const openPlayers = players.filter((p) => !placedPlayers.has(p.id));

  if (philosophy === 'MANUAL') {
    // Keep the coach's pinned slots and fill the rest in roster order.
    openPlayers.forEach((player, i) => {
      assignments.push({ playerId: player.id, battingSlot: openSlots[i], locked: false });
    });
    return assignments.sort((a, b) => a.battingSlot - b.battingSlot);
  }

  const mix = PHILOSOPHY_MIX[philosophy];
  const fairnessWeight =
    mix.fairness * (ctx.weights.battingOrderFairness / 100) * BATTING_TUNING.fairnessScale;
  const offenseWeight = mix.offense * BATTING_TUNING.offenseScale;

  // Rows = open slots, columns = unplaced players.
  const matrix = openSlots.map((slot) =>
    openPlayers.map((player) => {
      const { sum, games } = seasonRelativeAverage(player.usage);
      const rel = relativeSlot(slot, orderSize);
      const projectedAverage = (sum + rel) / (games + 1);

      // Fairness: pull every player's season average toward the middle.
      let c = fairnessWeight * (projectedAverage - 0.5) ** 2 * 4;

      // Season batting debt: positive means they have batted lower than expected.
      c += BATTING_TUNING.debtScale * player.debt.battingDebt * (0.5 - rel) * -1;

      // Don't park the same player in the bottom third week after week.
      if (rel >= 2 / 3) {
        c +=
          BATTING_TUNING.bottomThirdStreakPenalty *
          consecutiveBottomThird(player.usage) *
          (ctx.weights.battingOrderFairness / 100);
      }

      if (player.priority.batting) c += fairnessWeight * 0.5 * rel;

      // Offense: stronger hitters earn the valuable slots.
      c -= offenseWeight * slotOffensiveValue(slot, orderSize) * (player.offensive - 2);

      return c;
    }),
  );

  const result = minCostAssignment(matrix);
  if (result) {
    result.cols.forEach((col, row) => {
      assignments.push({
        playerId: openPlayers[col].id,
        battingSlot: openSlots[row],
        locked: false,
      });
    });
  } else {
    openPlayers.forEach((player, i) => {
      assignments.push({ playerId: player.id, battingSlot: openSlots[i], locked: false });
    });
  }

  return assignments.sort((a, b) => a.battingSlot - b.battingSlot);
}

/**
 * "Rotate Last Order": shift every player up by `offset` spots, wrapping the
 * top of the order to the bottom. A common youth-coaching workflow.
 */
export function rotateBattingOrder(
  previous: Array<{ playerId: string; battingSlot: number }>,
  offset: number,
  availablePlayerIds: string[],
): PlannedBattingAssignment[] {
  const available = new Set(availablePlayerIds);
  const ordered = previous
    .filter((entry) => available.has(entry.playerId))
    .sort((a, b) => a.battingSlot - b.battingSlot)
    .map((entry) => entry.playerId);

  // Anyone who did not bat last game joins the bottom of the rotated order.
  const missing = availablePlayerIds.filter((id) => !ordered.includes(id));
  const size = ordered.length;
  const rotated: string[] = [];
  for (let i = 0; i < size; i++) {
    rotated.push(ordered[(i + (((offset % size) + size) % size)) % size]);
  }
  const finalOrder = [...rotated, ...missing];

  return finalOrder.map((playerId, index) => ({
    playerId,
    battingSlot: index + 1,
    locked: false,
  }));
}
