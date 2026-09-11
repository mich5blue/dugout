import type { PositionGroup } from '@/domain/types';
import type { SolverContext } from './context';

/**
 * A full-game defensive solution.
 *
 * grid[inning][positionIndex] = player index, or EMPTY.
 * Inning 0 is unused so that innings stay 1-based throughout the optimizer.
 * Bench is derived: an available player with no position that inning is sitting.
 */
export const EMPTY = -1;

export interface Solution {
  grid: number[][];
}

export interface PlayerStats {
  defensive: number;
  bench: number;
  byGroup: Record<PositionGroup, number>;
  posCount: number[];
  unique: number;
  /** Number of adjacent available-inning pairs where the player sat both. */
  consecutiveBenchPairs: number;
  longestBenchRun: number;
  longestSamePositionRun: number;
  longestOutfieldRun: number;
  pitching: number;
  catching: number;
  benchedFirstInning: boolean;
  /** True when the player pitched and caught in adjacent innings. */
  batteryTransition: boolean;
}

export interface SolutionStats {
  perPlayer: PlayerStats[];
  unfilledSlots: number;
}

export function createEmptySolution(ctx: SolverContext): Solution {
  return {
    grid: Array.from({ length: ctx.innings + 1 }, () =>
      new Array<number>(ctx.nPos).fill(EMPTY),
    ),
  };
}

export function cloneSolution(solution: Solution): Solution {
  return { grid: solution.grid.map((row) => row.slice()) };
}

function emptyPlayerStats(nPos: number): PlayerStats {
  return {
    defensive: 0,
    bench: 0,
    byGroup: { BATTERY: 0, INFIELD: 0, OUTFIELD: 0, BENCH: 0 },
    posCount: new Array<number>(nPos).fill(0),
    unique: 0,
    consecutiveBenchPairs: 0,
    longestBenchRun: 0,
    longestSamePositionRun: 0,
    longestOutfieldRun: 0,
    pitching: 0,
    catching: 0,
    benchedFirstInning: false,
    batteryTransition: false,
  };
}

export function computeStats(ctx: SolverContext, solution: Solution): SolutionStats {
  const perPlayer = ctx.players.map(() => emptyPlayerStats(ctx.nPos));
  let unfilledSlots = 0;

  // Where each player played, per inning: position index, or EMPTY for bench.
  const playerInning: number[][] = ctx.players.map(() =>
    new Array<number>(ctx.innings + 1).fill(EMPTY),
  );

  for (let inning = 1; inning <= ctx.innings; inning++) {
    const row = solution.grid[inning];
    for (let pos = 0; pos < ctx.nPos; pos++) {
      const playerIdx = row[pos];
      if (playerIdx === EMPTY) {
        unfilledSlots++;
        continue;
      }
      playerInning[playerIdx][inning] = pos;
      const stats = perPlayer[playerIdx];
      stats.defensive++;
      stats.byGroup[ctx.groupOf[pos]]++;
      stats.posCount[pos]++;
    }
  }

  const isPitcher = new Array<boolean>(ctx.nPos).fill(false);
  const isCatcher = new Array<boolean>(ctx.nPos).fill(false);
  const isOutfield = new Array<boolean>(ctx.nPos).fill(false);
  for (const p of ctx.pitcherPositions) isPitcher[p] = true;
  for (const p of ctx.catcherPositions) isCatcher[p] = true;
  for (const p of ctx.outfieldPositions) isOutfield[p] = true;

  ctx.players.forEach((player, idx) => {
    const stats = perPlayer[idx];
    stats.unique = stats.posCount.reduce((acc, count) => acc + (count > 0 ? 1 : 0), 0);
    stats.pitching = ctx.pitcherPositions.reduce((acc, p) => acc + stats.posCount[p], 0);
    stats.catching = ctx.catcherPositions.reduce((acc, p) => acc + stats.posCount[p], 0);

    let benchRun = 0;
    let samePosRun = 0;
    let outfieldRun = 0;
    let previousSlot = EMPTY;
    let previousAvailable = false;

    for (let inning = 1; inning <= ctx.innings; inning++) {
      if (!player.available[inning - 1]) {
        // Gaps in availability break every run; an absent inning is not bench time.
        benchRun = 0;
        samePosRun = 0;
        outfieldRun = 0;
        previousSlot = EMPTY;
        previousAvailable = false;
        continue;
      }

      const slot = playerInning[idx][inning];

      if (slot === EMPTY) {
        stats.bench++;
        stats.byGroup.BENCH++;
        benchRun++;
        if (benchRun > stats.longestBenchRun) stats.longestBenchRun = benchRun;
        if (previousAvailable && previousSlot === EMPTY) stats.consecutiveBenchPairs++;
        samePosRun = 0;
        outfieldRun = 0;
        if (inning === 1) stats.benchedFirstInning = true;
      } else {
        benchRun = 0;
        samePosRun = previousAvailable && previousSlot === slot ? samePosRun + 1 : 1;
        if (samePosRun > stats.longestSamePositionRun) stats.longestSamePositionRun = samePosRun;
        if (isOutfield[slot]) {
          outfieldRun = outfieldRun + 1;
          if (outfieldRun > stats.longestOutfieldRun) stats.longestOutfieldRun = outfieldRun;
        } else {
          outfieldRun = 0;
        }
        if (
          previousAvailable &&
          previousSlot !== EMPTY &&
          ((isPitcher[previousSlot] && isCatcher[slot]) ||
            (isCatcher[previousSlot] && isPitcher[slot]))
        ) {
          stats.batteryTransition = true;
        }
      }

      previousSlot = slot;
      previousAvailable = true;
    }
  });

  return { perPlayer, unfilledSlots };
}

/** Players sitting each inning, keyed by inning. */
export function benchByInning(ctx: SolverContext, solution: Solution): Record<number, string[]> {
  const result: Record<number, string[]> = {};
  for (let inning = 1; inning <= ctx.innings; inning++) {
    const assigned = new Set(solution.grid[inning].filter((p) => p !== EMPTY));
    result[inning] = ctx.players
      .filter((p) => p.available[inning - 1] && !assigned.has(p.idx))
      .map((p) => p.id);
  }
  return result;
}
