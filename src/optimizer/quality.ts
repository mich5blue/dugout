import type { SolverContext } from './context';
import { clamp } from './context';
import { minCostAssignment } from './hungarian';
import { effectiveRules } from './objective';
import { computeStats, type Solution, type SolutionStats } from './solution';
import type { Conflict, LineupQuality, QualityMetric, QualityRating } from './types';

/**
 * Coach-facing quality summary. Separate from the cost function on purpose:
 * cost only needs to rank solutions, while these numbers have to mean something
 * to a person reading them.
 *
 * Every metric is scored against what is *achievable*, never against a
 * theoretical ideal the rules make impossible. Measuring defensive strength
 * against "the best player at every position at once" — which no lineup can
 * reach, since a player occupies one position — made a mathematically optimal
 * lineup read as 47%, which is both wrong and actively misleading.
 */

/** Innings of average deviation, beyond the achievable floor, that reads as no balance. */
const PLAYING_TIME_REFERENCE_SPREAD = 1.5;
const SEASON_REFERENCE_SPREAD = 2.0;

/**
 * The smallest average deviation from an equal share that whole innings allow.
 *
 * Eleven players across ten positions for six innings is a fair share of 5.45
 * innings each, so the best any lineup can do is some players at five and some
 * at six — an average deviation of about 0.5, never zero.
 */
function achievableDeviation(ctx: SolverContext): number {
  if (ctx.nPlayers === 0) return 0;

  const shares = ctx.players.map((player) => player.equalShare);
  const allocation = shares.map((share) => Math.floor(share));
  let remaining = ctx.totalSlots - allocation.reduce((a, b) => a + b, 0);

  // Hand the leftover innings to the largest fractional parts.
  const order = shares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (const entry of order) {
    if (remaining <= 0) break;
    allocation[entry.index] += 1;
    remaining -= 1;
  }

  const total = shares.reduce(
    (acc, share, index) => acc + Math.abs(allocation[index] - share),
    0,
  );
  return total / ctx.nPlayers;
}

/**
 * The strongest and weakest ability-weighted defence actually reachable, by
 * solving each inning as an assignment problem over the eligible players.
 */
function abilityBounds(ctx: SolverContext): { best: number; worst: number } {
  let best = 0;
  let worst = 0;

  for (let inning = 1; inning <= ctx.innings; inning++) {
    const candidates = ctx.players.filter((player) => player.available[inning - 1]);
    if (candidates.length < ctx.nPos) continue;

    const weight = (playerIdx: number, pos: number) =>
      ctx.critical[pos] * ctx.players[playerIdx].ability[pos];

    const matrix = (sign: 1 | -1) =>
      Array.from({ length: ctx.nPos }, (_, pos) =>
        candidates.map((player) =>
          player.allowedAt[pos]
            ? sign * weight(player.idx, pos)
            : Number.POSITIVE_INFINITY,
        ),
      );

    // Minimising the negated weight maximises it.
    const strongest = minCostAssignment(matrix(-1));
    const weakest = minCostAssignment(matrix(1));
    if (strongest) best += -strongest.total;
    if (weakest) worst += weakest.total;
  }

  return { best, worst };
}

function rate(value: number): QualityRating {
  if (value >= 0.9) return 'EXCELLENT';
  if (value >= 0.75) return 'GOOD';
  if (value >= 0.55) return 'FAIR';
  return 'POOR';
}

function metric(key: string, label: string, value: number, detail?: string): QualityMetric {
  const clamped = clamp(value, 0, 1);
  return { key, label, value: clamped, rating: rate(clamped), detail };
}

export function assessQuality(
  ctx: SolverContext,
  solution: Solution,
  score: number,
  stats: SolutionStats = computeStats(ctx, solution),
): { quality: LineupQuality; warnings: Conflict[] } {
  const rules = effectiveRules(ctx);
  const warnings: Conflict[] = [];
  const n = Math.max(1, ctx.nPlayers);

  // ---- Playing time ------------------------------------------------------
  const absDev = ctx.players.map((p, i) =>
    Math.abs(stats.perPlayer[i].defensive - p.equalShare),
  );
  const meanAbsDev = absDev.reduce((a, b) => a + b, 0) / n;
  const floorDev = achievableDeviation(ctx);
  const playingTime = metric(
    'playingTime',
    'Playing Time',
    1 - Math.max(0, meanAbsDev - floorDev) / PLAYING_TIME_REFERENCE_SPREAD,
    meanAbsDev - floorDev < 0.05
      ? 'As even as whole innings allow'
      : `Average difference from an equal share: ${meanAbsDev.toFixed(1)} innings`,
  );

  // ---- Position variety --------------------------------------------------
  let varietyAchieved = 0;
  let varietyPossible = 0;
  ctx.players.forEach((player, i) => {
    const s = stats.perPlayer[i];
    const achievable = Math.min(s.defensive, player.allowedAt.filter(Boolean).length);
    if (achievable <= 0) return;
    varietyPossible += Math.min(achievable, rules.minUnique + 1);
    varietyAchieved += Math.min(s.unique, rules.minUnique + 1);
  });
  const variety = metric(
    'positionVariety',
    'Position Variety',
    varietyPossible === 0 ? 1 : varietyAchieved / varietyPossible,
  );

  // ---- Infield opportunity -----------------------------------------------
  const infieldEligible = ctx.players.filter((p) => p.canPlayInfield);
  const infieldTarget = Math.max(1, rules.infieldInnings);
  const infieldMet = infieldEligible.filter(
    (p) =>
      stats.perPlayer[p.idx].byGroup.INFIELD >=
      Math.min(infieldTarget, stats.perPlayer[p.idx].defensive),
  ).length;
  const infield = metric(
    'infieldOpportunity',
    'Infield Opportunity',
    infieldEligible.length === 0 ? 1 : infieldMet / infieldEligible.length,
    `${infieldMet} of ${infieldEligible.length} eligible players get ${infieldTarget === 1 ? 'an infield inning' : `${infieldTarget} infield innings`}`,
  );

  // ---- Defensive strength ------------------------------------------------
  let actual = 0;
  for (let inning = 1; inning <= ctx.innings; inning++) {
    for (let pos = 0; pos < ctx.nPos; pos++) {
      const playerIdx = solution.grid[inning][pos];
      if (playerIdx < 0) continue;
      actual += ctx.critical[pos] * ctx.players[playerIdx].ability[pos];
    }
  }
  const bounds = abilityBounds(ctx);
  const strengthValue =
    bounds.best > bounds.worst
      ? (actual - bounds.worst) / (bounds.best - bounds.worst)
      : 1;
  const strength = metric(
    'defensiveStrength',
    'Defensive Strength',
    strengthValue,
    'How much stronger players are used at the positions you marked critical',
  );

  // ---- Season fairness ---------------------------------------------------
  const projectedDebt = ctx.players.map((p, i) => {
    const played = stats.perPlayer[i].defensive;
    return p.debt.defensiveDebt - (played - p.equalShare);
  });
  const meanProjected = projectedDebt.reduce((a, b) => a + Math.abs(b), 0) / n;
  const seasonFairness = metric(
    'seasonFairness',
    'Season Balance',
    1 - meanProjected / SEASON_REFERENCE_SPREAD,
    `Average outstanding imbalance after this game: ${meanProjected.toFixed(1)} innings`,
  );

  // ---- Bench rotation ----------------------------------------------------
  const noConsecutive = ctx.players.filter(
    (p) => stats.perPlayer[p.idx].consecutiveBenchPairs === 0,
  ).length;
  const benchRotation = metric(
    'benchRotation',
    'Bench Rotation',
    ctx.nPlayers === 0 ? 1 : noConsecutive / n,
  );

  // ---- Checks ------------------------------------------------------------
  const checks: LineupQuality['checks'] = [];

  if (ctx.settings.minDefensiveInnings > 0) {
    const target = ctx.settings.minDefensiveInnings;
    const everyone = ctx.players.every(
      (p) => stats.perPlayer[p.idx].defensive >= Math.min(target, p.availableInnings),
    );
    checks.push({
      ok: everyone,
      label: `Everyone plays at least ${target} ${target === 1 ? 'inning' : 'innings'}`,
    });
  }

  if (ctx.settings.noConsecutiveBench) {
    const ok = noConsecutive === ctx.nPlayers;
    checks.push({ ok, label: 'Nobody sits twice in a row' });
    if (!ok) {
      for (const player of ctx.players) {
        if (stats.perPlayer[player.idx].consecutiveBenchPairs > 0) {
          warnings.push({
            severity: 'WARNING',
            code: 'CONSECUTIVE_BENCH',
            message: `${player.name} sits two innings in a row because no valid alternative satisfied the higher-priority rules.`,
          });
        }
      }
    }
  }

  if (rules.infieldInnings > 0) {
    checks.push({
      ok: infieldMet === infieldEligible.length,
      label:
        rules.infieldInnings === 1
          ? 'Every eligible player gets an infield inning'
          : `Every eligible player gets ${rules.infieldInnings} infield innings`,
    });
  }

  const planEntries = Object.entries(ctx.input.pitchingPlan);
  if (planEntries.length > 0) {
    const primaryPitcher = ctx.pitcherPositions[0];
    const ok =
      primaryPitcher !== undefined &&
      planEntries.every(([inningKey, playerId]) => {
        const inning = Number(inningKey);
        const assigned = solution.grid[inning]?.[primaryPitcher];
        return assigned !== undefined && ctx.players[assigned]?.id === playerId;
      });
    checks.push({ ok, label: 'Pitching plan satisfied' });
  }

  const restrictionsOk = ctx.players.every((player) =>
    stats.perPlayer[player.idx].posCount.every(
      (count, pos) => count === 0 || player.allowedAt[pos],
    ),
  );
  checks.push({ ok: restrictionsOk, label: 'All position restrictions satisfied' });
  checks.push({
    ok: stats.unfilledSlots === 0,
    label: 'Every position filled in every inning',
  });

  // ---- Soft-rule warnings ------------------------------------------------
  for (const player of ctx.players) {
    const s = stats.perPlayer[player.idx];
    if (
      rules.maxConsecutiveOutfieldInnings !== Number.POSITIVE_INFINITY &&
      s.longestOutfieldRun > rules.maxConsecutiveOutfieldInnings
    ) {
      warnings.push({
        severity: 'WARNING',
        code: 'CONSECUTIVE_OUTFIELD',
        message: `${player.name} receives ${s.longestOutfieldRun} consecutive outfield innings because no valid alternative satisfies all higher-priority constraints.`,
      });
    } else if (s.longestOutfieldRun >= 3 && ctx.outfieldPositions.length > 0) {
      warnings.push({
        severity: 'WARNING',
        code: 'CONSECUTIVE_OUTFIELD',
        message: `${player.name} plays ${s.longestOutfieldRun} straight innings in the outfield.`,
      });
    }
    if (player.canPlayInfield && s.byGroup.INFIELD === 0 && s.defensive > 0) {
      warnings.push({
        severity: 'WARNING',
        code: 'NO_INFIELD',
        message: `${player.name} does not get an infield inning in this game.`,
      });
    }
  }

  return {
    quality: {
      metrics: [playingTime, variety, infield, strength, seasonFairness, benchRotation],
      checks,
      score,
    },
    warnings,
  };
}
