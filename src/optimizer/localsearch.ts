import type { SolverContext } from './context';
import { minCostAssignment } from './hungarian';
import { cost, effectiveRules, type EffectiveRules } from './objective';
import type { Rng } from './rng';
import { cloneSolution, computeStats, EMPTY, type Solution } from './solution';

/**
 * Improvement phase. Explores four neighbourhoods against the full-game
 * objective, applying the first improving move found (deterministic order,
 * seeded shuffling) until a full pass finds nothing better.
 *
 *  1. Swap two positions within one inning.
 *  2. Swap an on-field player with a benched player in the same inning.
 *  3. Swap two assignments across different innings (redistributes innings).
 *  4. Substitute a benched player for an on-field player and re-solve the
 *     whole inning around it.
 *
 * Move 4 matters more than it looks. Moves 1-3 cannot help a player with
 * limited eligibility get onto the field: the player sitting may not be able
 * to cover any position currently held by the player who should come out, and
 * getting them on requires a three-way rotation. Without this move, restricted
 * players accumulate bench time that the season-fairness objective wants to
 * correct but the search cannot reach.
 */

export interface LocalSearchOptions {
  /**
   * Deterministic search bound. Generation must be reproducible given the same
   * inputs and seed, so depth is limited by evaluations rather than elapsed
   * time — a wall-clock budget makes results depend on how busy the machine
   * is, which would return different lineups for identical inputs.
   */
  maxEvaluations: number;
  maxPasses: number;
  /** Safety net for pathological inputs only; not expected to be reached. */
  safetyTimeMs: number;
}

export const DEFAULT_LOCAL_SEARCH: LocalSearchOptions = {
  maxEvaluations: 30_000,
  maxPasses: 40,
  safetyTimeMs: 4_000,
};

interface Mutable {
  ctx: SolverContext;
  rules: EffectiveRules;
  solution: Solution;
  best: number;
  evaluations: number;
}

function evaluate(state: Mutable): number {
  state.evaluations++;
  const stats = computeStats(state.ctx, state.solution);
  return cost(state.ctx, state.solution, stats, state.rules).total;
}

function isMutable(ctx: SolverContext, inning: number, pos: number): boolean {
  if (inning <= ctx.input.frozenInnings) return false;
  return ctx.locked[inning][pos] < 0;
}

/** Position index a player occupies in an inning, or EMPTY. */
function slotOf(solution: Solution, inning: number, playerIdx: number): number {
  const row = solution.grid[inning];
  for (let pos = 0; pos < row.length; pos++) {
    if (row[pos] === playerIdx) return pos;
  }
  return EMPTY;
}

/**
 * Arranges an exact set of players across an inning's unlocked positions,
 * writing the result into the grid. Returns false when the set cannot cover
 * the positions, leaving the grid untouched.
 *
 * Costs here only break ties sensibly (preferred spots, stronger players at
 * critical positions, avoid repeats); the caller evaluates the true full-game
 * objective afterwards.
 */
function arrangeInning(
  ctx: SolverContext,
  solution: Solution,
  inning: number,
  playerSet: number[],
): boolean {
  const openPositions: number[] = [];
  const lockedPlayers = new Set<number>();

  for (let pos = 0; pos < ctx.nPos; pos++) {
    if (isMutable(ctx, inning, pos)) openPositions.push(pos);
    else lockedPlayers.add(solution.grid[inning][pos]);
  }

  const movable = playerSet.filter((idx) => !lockedPlayers.has(idx));
  if (movable.length !== openPositions.length) return false;

  const matrix = openPositions.map((pos) =>
    movable.map((playerIdx) => {
      const player = ctx.players[playerIdx];
      if (!player.allowedAt[pos] || !player.available[inning - 1]) {
        return Number.POSITIVE_INFINITY;
      }
      let c = 0;
      const elig = player.eligibility[pos];
      if (elig === 'PREFERRED') c -= 2;
      if (elig === 'AVOID') c += 8;
      c -= ctx.critical[pos] * (player.ability[pos] - 2);
      // Discourage repeating the position the player held last inning.
      if (inning > 1 && slotOf(solution, inning - 1, playerIdx) === pos) c += 1;
      return c;
    }),
  );

  const result = minCostAssignment(matrix);
  if (!result) return false;

  for (const pos of openPositions) solution.grid[inning][pos] = EMPTY;
  result.cols.forEach((col, row) => {
    solution.grid[inning][openPositions[row]] = movable[col];
  });
  return true;
}

export function improve(
  ctx: SolverContext,
  initial: Solution,
  rng: Rng,
  options: LocalSearchOptions = DEFAULT_LOCAL_SEARCH,
): { solution: Solution; cost: number; iterations: number } {
  const state: Mutable = {
    ctx,
    rules: effectiveRules(ctx),
    solution: cloneSolution(initial),
    best: 0,
    evaluations: 0,
  };
  state.best = evaluate(state);

  const started = Date.now();
  const exhausted = () =>
    state.evaluations >= options.maxEvaluations ||
    Date.now() - started > options.safetyTimeMs;
  const innings: number[] = [];
  for (let inning = ctx.input.frozenInnings + 1; inning <= ctx.innings; inning++) {
    innings.push(inning);
  }

  let pass = 0;
  let improvedAnything = true;

  while (improvedAnything && pass < options.maxPasses) {
    if (exhausted()) break;
    improvedAnything = false;
    pass++;

    // ---- 1 & 2: within-inning moves --------------------------------------
    for (const inning of rng.shuffled(innings)) {
      if (exhausted()) break;

      const positions = rng.shuffled(
        Array.from({ length: ctx.nPos }, (_, i) => i).filter((pos) =>
          isMutable(ctx, inning, pos),
        ),
      );

      // Swap two on-field positions.
      for (let a = 0; a < positions.length; a++) {
        for (let b = a + 1; b < positions.length; b++) {
          const posA = positions[a];
          const posB = positions[b];
          const playerA = state.solution.grid[inning][posA];
          const playerB = state.solution.grid[inning][posB];
          if (playerA === EMPTY || playerB === EMPTY) continue;
          if (!ctx.players[playerA].allowedAt[posB]) continue;
          if (!ctx.players[playerB].allowedAt[posA]) continue;

          state.solution.grid[inning][posA] = playerB;
          state.solution.grid[inning][posB] = playerA;
          const candidate = evaluate(state);
          if (candidate < state.best - 1e-9) {
            state.best = candidate;
            improvedAnything = true;
          } else {
            state.solution.grid[inning][posA] = playerA;
            state.solution.grid[inning][posB] = playerB;
          }
        }
      }

      // Swap an on-field player with someone sitting.
      const assigned = new Set(state.solution.grid[inning].filter((p) => p !== EMPTY));
      const benched = rng.shuffled(
        ctx.players
          .filter((p) => p.available[inning - 1] && !assigned.has(p.idx))
          .map((p) => p.idx),
      );
      for (const pos of positions) {
        const current = state.solution.grid[inning][pos];
        if (current === EMPTY) continue;
        for (const benchedIdx of benched) {
          if (!ctx.players[benchedIdx].allowedAt[pos]) continue;
          if (state.solution.grid[inning].includes(benchedIdx)) continue;

          state.solution.grid[inning][pos] = benchedIdx;
          const candidate = evaluate(state);
          if (candidate < state.best - 1e-9) {
            state.best = candidate;
            improvedAnything = true;
            break;
          }
          state.solution.grid[inning][pos] = current;
        }
      }
    }

    // ---- 4: substitute a benched player and re-solve the inning ----------
    for (const inning of rng.shuffled(innings)) {
      if (exhausted()) break;

      const onField = state.solution.grid[inning].filter((idx) => idx !== EMPTY);
      const assigned = new Set(onField);
      const benched = ctx.players
        .filter((p) => p.available[inning - 1] && !assigned.has(p.idx))
        .map((p) => p.idx);
      if (benched.length === 0) continue;

      for (const incoming of rng.shuffled(benched)) {
        let applied = false;
        for (const outgoing of rng.shuffled(onField)) {
          // A locked assignment pins its player into the inning.
          if (!isMutable(ctx, inning, slotOf(state.solution, inning, outgoing))) continue;

          const before = state.solution.grid[inning].slice();
          const nextSet = onField.filter((idx) => idx !== outgoing).concat(incoming);

          if (!arrangeInning(ctx, state.solution, inning, nextSet)) {
            state.solution.grid[inning] = before;
            continue;
          }

          const candidate = evaluate(state);
          if (candidate < state.best - 1e-9) {
            state.best = candidate;
            improvedAnything = true;
            applied = true;
            break;
          }
          state.solution.grid[inning] = before;
        }
        if (applied) break;
      }
    }

    // ---- 3: cross-inning swaps -------------------------------------------
    for (const inningA of rng.shuffled(innings)) {
      if (exhausted()) break;
      for (const inningB of innings) {
        if (inningB <= inningA) continue;
        for (let posA = 0; posA < ctx.nPos; posA++) {
          if (!isMutable(ctx, inningA, posA)) continue;
          const playerA = state.solution.grid[inningA][posA];
          if (playerA === EMPTY) continue;

          for (let posB = 0; posB < ctx.nPos; posB++) {
            if (!isMutable(ctx, inningB, posB)) continue;
            const playerB = state.solution.grid[inningB][posB];
            if (playerB === EMPTY || playerA === playerB) continue;

            // Each player must be free and eligible in the other inning.
            if (!ctx.players[playerA].available[inningB - 1]) continue;
            if (!ctx.players[playerB].available[inningA - 1]) continue;
            if (!ctx.players[playerA].allowedAt[posB]) continue;
            if (!ctx.players[playerB].allowedAt[posA]) continue;
            if (slotOf(state.solution, inningB, playerA) !== EMPTY) continue;
            if (slotOf(state.solution, inningA, playerB) !== EMPTY) continue;

            state.solution.grid[inningA][posA] = playerB;
            state.solution.grid[inningB][posB] = playerA;
            const candidate = evaluate(state);
            if (candidate < state.best - 1e-9) {
              state.best = candidate;
              improvedAnything = true;
            } else {
              state.solution.grid[inningA][posA] = playerA;
              state.solution.grid[inningB][posB] = playerB;
            }
          }
        }
      }
    }
  }

  return { solution: state.solution, cost: state.best, iterations: state.evaluations };
}
