import { generateBattingOrder } from './batting';
import { buildContext, type SolverContext } from './context';
import { construct } from './construct';
import { explainLineup } from './explain';
import { analyzeFeasibility } from './feasibility';
import { improve } from './localsearch';
import { cost, effectiveRules } from './objective';
import { assessQuality } from './quality';
import { Rng } from './rng';
import { benchByInning, computeStats, EMPTY, type Solution } from './solution';
import {
  OPTIMIZER_VERSION,
  type Conflict,
  type LineupOptimizer,
  type LineupQuality,
  type OptimizationInput,
  type OptimizationResult,
  type PlannedDefensiveAssignment,
} from './types';
import { validateBatting, validateSolution } from './validate';

export * from './types';
export { rotateBattingOrder } from './batting';
export { analyzeFeasibility } from './feasibility';
export { effectiveRules } from './objective';

/** Jitter applied to construction costs on each restart. */
const RESTART_JITTER = [0, 4, 10];

/**
 * Deterministic search budget per restart. Generation is bounded by
 * evaluations, not elapsed time, so the same inputs and seed always produce
 * the same lineup regardless of how loaded the machine is. A game of the size
 * this product targets converges well before this bound.
 */
const EVALUATIONS_PER_RESTART = 30_000;

/** Wall-clock safety net for pathological inputs; not a normal search bound. */
const SAFETY_TIME_MS = 4_000;

function emptyQuality(): LineupQuality {
  return { metrics: [], checks: [], score: 0 };
}

/**
 * Construct-and-improve optimizer.
 *
 * Each inning is filled by an exact min-cost assignment (Hungarian), then the
 * whole game is improved by local search against the full-game objective in
 * objective.ts. Multiple seeded restarts are tried and the best kept.
 *
 * Why not CP-SAT: the season-aware objective is dominated by quadratic
 * deviation-from-target terms, which a MIP/CP model would have to linearise,
 * and shipping OR-Tools would mean adding a Python service to the deployment.
 * This solver is deterministic, runs in well under the 1s target in-process,
 * and sits behind the LineupOptimizer interface so it can be swapped for
 * CP-SAT later without touching any caller.
 */
export class DugoutOptimizer implements LineupOptimizer {
  async generate(input: OptimizationInput): Promise<OptimizationResult> {
    const started = Date.now();
    const ctx = buildContext(input);
    const feasibility = analyzeFeasibility(ctx);

    if (!feasibility.feasible) {
      return {
        ok: false,
        defensive: [],
        bench: {},
        batting: [],
        quality: emptyQuality(),
        explanations: [],
        conflicts: feasibility.conflicts,
        relaxations: feasibility.relaxations,
        seed: input.seed,
        optimizerVersion: OPTIMIZER_VERSION,
        elapsedMs: Date.now() - started,
        iterations: 0,
      };
    }

    let best: { solution: Solution; cost: number } | null = null;
    let iterations = 0;

    for (let restart = 0; restart < RESTART_JITTER.length; restart++) {
      const constructRng = new Rng(input.seed + restart * 7919);
      const candidate = construct(ctx, constructRng, RESTART_JITTER[restart]);
      if (!candidate) continue;

      const searchRng = new Rng(input.seed + restart * 104729 + 13);
      const improved = improve(ctx, candidate, searchRng, {
        maxEvaluations: EVALUATIONS_PER_RESTART,
        maxPasses: 40,
        safetyTimeMs: input.timeBudgetMs ?? SAFETY_TIME_MS,
      });
      iterations += improved.iterations;

      if (!best || improved.cost < best.cost - 1e-9) {
        best = { solution: improved.solution, cost: improved.cost };
      }
    }

    if (!best) {
      return {
        ok: false,
        defensive: [],
        bench: {},
        batting: [],
        quality: emptyQuality(),
        explanations: [],
        conflicts: [
          ...feasibility.conflicts,
          {
            severity: 'ERROR',
            code: 'NO_FEASIBLE_LINEUP',
            message:
              'No lineup satisfies every rule for this game. The suggestions below are the smallest changes that would make it possible.',
          },
        ],
        relaxations:
          feasibility.relaxations.length > 0
            ? feasibility.relaxations
            : fallbackRelaxations(ctx),
        seed: input.seed,
        optimizerVersion: OPTIMIZER_VERSION,
        elapsedMs: Date.now() - started,
        iterations,
      };
    }

    const stats = computeStats(ctx, best.solution);
    const breakdown = cost(ctx, best.solution, stats, effectiveRules(ctx));
    const batting = generateBattingOrder(ctx);

    const defensive: PlannedDefensiveAssignment[] = [];
    for (let inning = 1; inning <= ctx.innings; inning++) {
      for (let pos = 0; pos < ctx.nPos; pos++) {
        const playerIdx = best.solution.grid[inning][pos];
        if (playerIdx === EMPTY) continue;
        defensive.push({
          inning,
          positionId: ctx.positions[pos].id,
          playerId: ctx.players[playerIdx].id,
          locked: ctx.locked[inning][pos] === playerIdx,
        });
      }
    }

    const structural = validateSolution(ctx, best.solution);
    const battingIssues = validateBatting(
      ctx.players.map((p) => p.id),
      batting,
    );

    const { quality, warnings } = assessQuality(ctx, best.solution, breakdown.total, stats);

    const conflicts: Conflict[] = [
      ...feasibility.conflicts,
      ...structural.map<Conflict>((issue) => ({
        severity: 'ERROR',
        code: issue.code,
        message: issue.message,
      })),
      ...battingIssues.map<Conflict>((issue) => ({
        severity: 'ERROR',
        code: issue.code,
        message: issue.message,
      })),
      ...warnings,
    ];

    const relaxations =
      structural.length > 0
        ? [...feasibility.relaxations, ...fallbackRelaxations(ctx)]
        : feasibility.relaxations;

    return {
      ok: structural.length === 0 && battingIssues.length === 0,
      defensive,
      bench: benchByInning(ctx, best.solution),
      batting,
      quality,
      explanations: explainLineup(ctx, best.solution, batting, stats),
      conflicts,
      relaxations: relaxations.slice(0, 5),
      seed: input.seed,
      optimizerVersion: OPTIMIZER_VERSION,
      elapsedMs: Date.now() - started,
      iterations,
    };
  }
}

/** Generic ranked suggestions when nothing structural was detectable up front. */
function fallbackRelaxations(ctx: SolverContext) {
  const rules = effectiveRules(ctx);
  const suggestions: OptimizationResult['relaxations'] = [];

  if (rules.requiredMinDefensive > 1) {
    suggestions.push({
      message: `Reduce minimum playing time from ${rules.requiredMinDefensive} innings to ${rules.requiredMinDefensive - 1}.`,
      impact: 2,
      action: { type: 'REDUCE_MIN_DEFENSIVE_INNINGS', to: rules.requiredMinDefensive - 1 },
    });
  }
  if (rules.infieldRequired) {
    suggestions.push({
      message: 'Make the infield guarantee a target instead of a requirement.',
      impact: 2,
      action: { type: 'RELAX_INFIELD_REQUIREMENT', to: rules.infieldInnings },
    });
  }
  if (ctx.settings.noConsecutiveBench) {
    suggestions.push({
      message: 'Allow consecutive bench innings.',
      impact: 3,
      action: { type: 'ALLOW_CONSECUTIVE_BENCH' },
    });
  }

  const tightest = ctx.positions
    .map((position, pos) => ({
      position,
      eligible: ctx.players.filter((p) => p.allowedAt[pos]).length,
    }))
    .filter((entry) => entry.eligible <= 2)
    .sort((a, b) => a.eligible - b.eligible)[0];
  if (tightest) {
    suggestions.push({
      message: `Allow another player at ${tightest.position.code} — only ${tightest.eligible} ${tightest.eligible === 1 ? 'player is' : 'players are'} eligible there.`,
      impact: 1,
      action: { type: 'ADD_ELIGIBLE_PLAYER', positionId: tightest.position.id },
    });
  }

  return suggestions.sort((a, b) => a.impact - b.impact);
}

/** Single shared instance; the solver is stateless between calls. */
export const optimizer: LineupOptimizer = new DugoutOptimizer();
