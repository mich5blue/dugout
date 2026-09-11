import type { SolverContext } from './context';
import { effectiveRules } from './objective';
import { computeStats, EMPTY, type Solution } from './solution';
import type { PlannedBattingAssignment } from './types';

/**
 * Post-optimization invariant checks. Solver output is never trusted blindly:
 * if any of these fail the result is reported as not-ok rather than shown to a
 * coach as valid.
 */

export interface ValidationIssue {
  code: string;
  message: string;
}

export function validateSolution(ctx: SolverContext, solution: Solution): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const rules = effectiveRules(ctx);
  const stats = computeStats(ctx, solution);

  for (let inning = 1; inning <= ctx.innings; inning++) {
    const row = solution.grid[inning];
    const seen = new Map<number, number>();

    for (let pos = 0; pos < ctx.nPos; pos++) {
      const playerIdx = row[pos];
      const position = ctx.positions[pos];

      if (playerIdx === EMPTY) {
        issues.push({
          code: 'UNFILLED_POSITION',
          message: `Inning ${inning}: ${position.code} is unfilled.`,
        });
        continue;
      }

      const player = ctx.players[playerIdx];

      if (seen.has(playerIdx)) {
        issues.push({
          code: 'DUPLICATE_PLAYER',
          message: `Inning ${inning}: ${player.name} is assigned to two positions.`,
        });
      }
      seen.set(playerIdx, pos);

      if (!player.available[inning - 1]) {
        issues.push({
          code: 'UNAVAILABLE_PLAYER',
          message: `Inning ${inning}: ${player.name} is not available.`,
        });
      }

      if (!player.allowedAt[pos]) {
        issues.push({
          code: 'FORBIDDEN_POSITION',
          message: `Inning ${inning}: ${player.name} cannot play ${position.code}.`,
        });
      }

      const lockedPlayer = ctx.locked[inning][pos];
      if (lockedPlayer >= 0 && lockedPlayer !== playerIdx) {
        issues.push({
          code: 'LOCK_BROKEN',
          message: `Inning ${inning}: ${position.code} was locked to ${ctx.players[lockedPlayer].name}.`,
        });
      }
    }
  }

  ctx.players.forEach((player, idx) => {
    const s = stats.perPlayer[idx];

    if (rules.requiredMinDefensive > 0) {
      const required = Math.min(rules.requiredMinDefensive, player.availableInnings);
      if (s.defensive < required) {
        issues.push({
          code: 'MIN_INNINGS_VIOLATED',
          message: `${player.name} has ${s.defensive} defensive innings but ${required} are required.`,
        });
      }
    }

    if (rules.infieldRequired && player.canPlayInfield) {
      const required = Math.min(rules.infieldInnings, player.availableInnings);
      if (s.byGroup.INFIELD < required) {
        issues.push({
          code: 'INFIELD_REQUIREMENT_VIOLATED',
          message: `${player.name} has ${s.byGroup.INFIELD} infield innings but ${required} are required.`,
        });
      }
    }

    if (s.pitching > player.maxPitching) {
      issues.push({
        code: 'PITCHING_CAP_EXCEEDED',
        message: `${player.name} pitches ${s.pitching} innings, above the limit of ${player.maxPitching}.`,
      });
    }

    if (s.catching > player.maxCatching) {
      issues.push({
        code: 'CATCHING_CAP_EXCEEDED',
        message: `${player.name} catches ${s.catching} innings, above the limit of ${player.maxCatching}.`,
      });
    }

    if (s.bench > rules.maxBenchInnings) {
      issues.push({
        code: 'BENCH_CAP_EXCEEDED',
        message: `${player.name} sits ${s.bench} innings, above the limit of ${rules.maxBenchInnings}.`,
      });
    }
  });

  return issues;
}

export function validateBatting(
  playerIds: string[],
  batting: PlannedBattingAssignment[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const slots = new Map<number, string[]>();

  for (const assignment of batting) {
    const list = slots.get(assignment.battingSlot) ?? [];
    list.push(assignment.playerId);
    slots.set(assignment.battingSlot, list);
  }

  for (const [slot, players] of slots) {
    if (players.length > 1) {
      issues.push({
        code: 'DUPLICATE_BATTING_SLOT',
        message: `Batting slot ${slot} is assigned to ${players.length} players.`,
      });
    }
  }

  const assignedPlayers = new Set(batting.map((b) => b.playerId));
  for (const playerId of playerIds) {
    if (!assignedPlayers.has(playerId)) {
      issues.push({
        code: 'MISSING_BATTING_SLOT',
        message: `A player in the lineup has no batting slot.`,
      });
      break;
    }
  }

  for (let slot = 1; slot <= playerIds.length; slot++) {
    if (!slots.has(slot)) {
      issues.push({
        code: 'BATTING_SLOT_GAP',
        message: `Batting order has a gap at slot ${slot}.`,
      });
      break;
    }
  }

  return issues;
}
