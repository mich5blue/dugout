import type { SolverContext } from './context';
import { effectiveRules } from './objective';
import { computeStats, EMPTY, type Solution, type SolutionStats } from './solution';
import type { Explanation, PlannedBattingAssignment } from './types';

/**
 * "Why this lineup?" — plain-language reasons for the decisions a coach is
 * most likely to question. Deterministic: candidates are ranked by how
 * surprising the decision is, then the top few are reported.
 *
 * Player pronouns are never stored (see the privacy rules), so these sentences
 * are written without them.
 */

const MAX_EXPLANATIONS = 7;

interface Candidate extends Explanation {
  magnitude: number;
}

function innings(count: number): string {
  return `${count} ${count === 1 ? 'inning' : 'innings'}`;
}

export function explainLineup(
  ctx: SolverContext,
  solution: Solution,
  batting: PlannedBattingAssignment[],
  stats: SolutionStats = computeStats(ctx, solution),
): Explanation[] {
  const rules = effectiveRules(ctx);
  const candidates: Candidate[] = [];

  // ---- Defensive innings driven by season debt ---------------------------
  for (const player of ctx.players) {
    const s = stats.perPlayer[player.idx];
    const debt = player.debt.defensiveDebt;
    const aboveShare = s.defensive - player.equalShare;

    if (debt >= 1 && aboveShare > 0.25) {
      candidates.push({
        playerId: player.id,
        magnitude: debt + aboveShare,
        text: `${player.name} gets ${innings(s.defensive)} in the field — more than an equal share, because ${player.name} has played ${debt.toFixed(1)} fewer innings than expected so far this season.`,
      });
    } else if (debt <= -1 && aboveShare < -0.25) {
      candidates.push({
        playerId: player.id,
        magnitude: -debt - aboveShare,
        text: `${player.name} gets ${innings(s.defensive)} in the field — slightly fewer than average, because ${player.name} has already played ${(-debt).toFixed(1)} more innings than expected this season.`,
      });
    }
  }

  // ---- Infield opportunity ----------------------------------------------
  const infieldEligible = ctx.players.filter((p) => p.canPlayInfield);
  const worstInfieldDebt = [...infieldEligible].sort(
    (a, b) => b.debt.infieldDebt - a.debt.infieldDebt,
  )[0];
  if (worstInfieldDebt && worstInfieldDebt.debt.infieldDebt > 0.5) {
    const s = stats.perPlayer[worstInfieldDebt.idx];
    if (s.byGroup.INFIELD > 0) {
      candidates.push({
        playerId: worstInfieldDebt.id,
        magnitude: worstInfieldDebt.debt.infieldDebt + 1,
        text: `${worstInfieldDebt.name} gets ${innings(s.byGroup.INFIELD)} in the infield — the largest infield shortfall among eligible players this season.`,
      });
    }
  }

  if (rules.infieldInnings > 0) {
    const met = infieldEligible.filter(
      (p) => stats.perPlayer[p.idx].byGroup.INFIELD >= rules.infieldInnings,
    ).length;
    if (met === infieldEligible.length && infieldEligible.length > 0) {
      candidates.push({
        magnitude: 0.9,
        text: `All ${infieldEligible.length} infield-eligible players get at least ${innings(rules.infieldInnings)} in the infield, because you asked for an infield opportunity for everyone.`,
      });
    }
  }

  // ---- Critical positions -----------------------------------------------
  if (ctx.settings.criticalStrength !== 'OFF') {
    const strengthLabel = ctx.settings.criticalStrength.toLowerCase();
    const criticalPositions = ctx.positions
      .map((position, pos) => ({ position, pos }))
      .filter(({ pos }) => ctx.critical[pos] >= 1)
      .sort((a, b) => a.position.sortOrder - b.position.sortOrder);

    for (const { position, pos } of criticalPositions) {
      const counts = new Map<number, number>();
      for (let inning = 1; inning <= ctx.innings; inning++) {
        const playerIdx = solution.grid[inning][pos];
        if (playerIdx === EMPTY) continue;
        counts.set(playerIdx, (counts.get(playerIdx) ?? 0) + 1);
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!top) continue;
      const [playerIdx, count] = top;
      const player = ctx.players[playerIdx];
      if (count >= 2 && player.ability[pos] >= 3) {
        candidates.push({
          playerId: player.id,
          magnitude: 0.8 + count * 0.1,
          text: `${player.name} plays ${innings(count)} at ${position.code} because Critical Position Strength is set to ${strengthLabel} and ${player.name} is marked Core there.`,
        });
      }
    }
  }

  // ---- Bench decisions ---------------------------------------------------
  const benchExplained = new Set<string>();
  for (let inning = 1; inning <= ctx.innings; inning++) {
    const assigned = new Set(solution.grid[inning].filter((p) => p !== EMPTY));
    for (const player of ctx.players) {
      if (!player.available[inning - 1] || assigned.has(player.idx)) continue;
      if (benchExplained.has(player.id)) continue;
      benchExplained.add(player.id);

      const seasonBench = player.usage.benchInnings;
      const teamAverageBench =
        ctx.players.reduce((acc, p) => acc + p.usage.benchInnings, 0) /
        Math.max(1, ctx.nPlayers);
      if (seasonBench <= teamAverageBench) {
        candidates.push({
          playerId: player.id,
          magnitude: 0.7 + (teamAverageBench - seasonBench) * 0.1,
          text: `${player.name} sits inning ${inning} because ${player.name} has sat ${seasonBench} innings this season, at or below the team average of ${teamAverageBench.toFixed(1)}.`,
        });
      }
    }
  }

  // ---- Locks and pitching plan ------------------------------------------
  const plannedInnings = Object.keys(ctx.input.pitchingPlan).map(Number).sort((a, b) => a - b);
  if (plannedInnings.length > 0) {
    candidates.push({
      magnitude: 1.2,
      text: `Your pitching plan for ${plannedInnings.length === 1 ? `inning ${plannedInnings[0]}` : `innings ${plannedInnings.join(', ')}`} is kept exactly as entered, and everything else is built around it.`,
    });
  }
  if (ctx.input.lockedAssignments.length > 0) {
    candidates.push({
      magnitude: 1.1,
      text: `${ctx.input.lockedAssignments.length} locked ${ctx.input.lockedAssignments.length === 1 ? 'assignment' : 'assignments'} ${ctx.input.lockedAssignments.length === 1 ? 'was' : 'were'} preserved, and the rest of the lineup was optimized around ${ctx.input.lockedAssignments.length === 1 ? 'it' : 'them'}.`,
    });
  }

  // ---- Batting order ----------------------------------------------------
  const topOfOrder = batting
    .filter((b) => !b.locked && b.battingSlot <= 2)
    .sort((a, b) => a.battingSlot - b.battingSlot)[0];
  if (topOfOrder) {
    const player = ctx.byId.get(topOfOrder.playerId);
    if (player) {
      if (ctx.settings.battingPhilosophy === 'ROTATE_FAIRLY' && player.debt.battingDebt > 0.05) {
        candidates.push({
          playerId: player.id,
          magnitude: 0.75,
          text: `${player.name} bats ${ordinal(topOfOrder.battingSlot)} because ${player.name} has been batting lower in the order than the rest of the team this season.`,
        });
      } else if (ctx.settings.battingPhilosophy === 'COMPETITIVE' && player.offensive >= 3) {
        candidates.push({
          playerId: player.id,
          magnitude: 0.7,
          text: `${player.name} bats ${ordinal(topOfOrder.battingSlot)} because the batting order is set to Competitive.`,
        });
      }
    }
  }

  return candidates
    .sort((a, b) => b.magnitude - a.magnitude || a.text.localeCompare(b.text))
    .slice(0, MAX_EXPLANATIONS)
    .map(({ playerId, text }) => ({ playerId, text }));
}

export function ordinal(value: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const mod100 = value % 100;
  const suffix =
    suffixes[(mod100 - 20) % 10] ?? suffixes[mod100] ?? suffixes[0];
  return `${value}${suffix}`;
}
