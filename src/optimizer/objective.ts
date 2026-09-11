import type { VarietyLevel } from '@/domain/types';
import { clamp, type SolverContext } from './context';
import { computeStats, EMPTY, type Solution, type SolutionStats } from './solution';

/**
 * Cost model. The optimizer minimises this. Every tunable number lives either
 * in domain/weights.ts (coach-facing weights) or in TUNING below.
 */
export const TUNING = {
  /** Dominates every soft term, so hard requirements are always resolved first. */
  hardPenalty: 1_000_000,
  /** How far season position-level debt can pull a single assignment. */
  maxPositionDebtPull: 2,
  /** How far season infield debt can pull a single game. */
  maxGroupDebtPull: 3,
  /** How far season defensive-inning debt can pull a single game. */
  maxInningDebtPull: 4,
  /** Extra pull from a "prioritize next game" flag, in debt-equivalent innings. */
  priorityDebtEquivalent: 1.5,
  /** Weight of "don't sit the same kid in inning 1 every week". */
  firstInningBenchScale: 0.15,
  /** Bonus for using a coach-designated preferred pitcher/catcher. */
  preferredBatteryBonus: 0.5,
  /**
   * Scale of the seed-derived tie-break. Small enough that it can never
   * outrank a real difference in fairness or strength, large enough to pick
   * deterministically between equally good lineups.
   */
  tieBreakScale: 1e-4,
} as const;

const MIN_UNIQUE_BY_VARIETY: Record<VarietyLevel, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

const MAX_CONSECUTIVE_SAME_BY_VARIETY: Record<VarietyLevel, number> = {
  LOW: Number.POSITIVE_INFINITY,
  MEDIUM: 3,
  HIGH: 2,
};

export interface EffectiveRules {
  minUnique: number;
  maxInningsSamePosition: number;
  maxConsecutiveSamePosition: number;
  maxOutfieldInnings: number;
  minOutfieldInnings: number;
  maxConsecutiveOutfieldInnings: number;
  maxBenchInnings: number;
  /** Innings a player should hold one position before rotating. 0 = off. */
  continuityInnings: number;
  /** Infield innings the coach asked for, whether target or requirement. */
  infieldInnings: number;
  infieldRequired: boolean;
  requiredMinDefensive: number;
}

export function effectiveRules(ctx: SolverContext): EffectiveRules {
  const s = ctx.settings;
  const infield = s.infieldOpportunity;
  const continuityInnings = s.positionContinuityInnings ?? 0;

  /*
    Continuity and variety pull in opposite directions, so asking for two-inning
    blocks must lift the consecutive-innings cap that the variety dial would
    otherwise impose — at variety HIGH that cap is 2, which would fight a
    three-inning block and silently win.
  */
  const consecutiveCap =
    s.maxConsecutiveSamePosition ?? MAX_CONSECUTIVE_SAME_BY_VARIETY[s.variety];

  return {
    minUnique: s.minUniquePositions ?? MIN_UNIQUE_BY_VARIETY[s.variety],
    maxInningsSamePosition: s.maxInningsSamePosition ?? Number.POSITIVE_INFINITY,
    maxConsecutiveSamePosition: Math.max(consecutiveCap, continuityInnings),
    continuityInnings,
    maxOutfieldInnings: s.maxOutfieldInnings ?? Number.POSITIVE_INFINITY,
    minOutfieldInnings: s.minOutfieldInnings ?? 0,
    maxConsecutiveOutfieldInnings:
      s.maxConsecutiveOutfieldInnings ?? Number.POSITIVE_INFINITY,
    maxBenchInnings: s.maxBenchInnings ?? Number.POSITIVE_INFINITY,
    infieldInnings: infield.mode === 'OFF' ? 0 : infield.innings,
    infieldRequired: infield.mode === 'REQUIRED',
    requiredMinDefensive: ctx.requiredMinInnings,
  };
}

export interface CostBreakdown {
  total: number;
  hard: number;
  terms: Record<string, number>;
}

function sq(x: number): number {
  return x * x;
}

function shortfall(required: number, actual: number): number {
  return Math.max(0, required - actual);
}

export function cost(
  ctx: SolverContext,
  solution: Solution,
  stats: SolutionStats = computeStats(ctx, solution),
  rules: EffectiveRules = effectiveRules(ctx),
): CostBreakdown {
  const w = ctx.weights;
  const n = Math.max(1, ctx.nPlayers);
  const slots = Math.max(1, ctx.totalSlots);

  let playingTime = 0;
  let seasonFairness = 0;
  let variety = 0;
  let repeated = 0;
  let groupBalance = 0;
  let infieldOpportunity = 0;
  let preferences = 0;
  let avoid = 0;
  let critical = 0;
  let development = 0;
  let consecutiveBench = 0;
  let continuity = 0;
  let outfield = 0;
  let tieBreak = 0;
  let hard = 0;

  // ---- Per-assignment terms ----------------------------------------------
  for (let inning = 1; inning <= ctx.innings; inning++) {
    const row = solution.grid[inning];

    // Critical-position strength is measured *within* each inning, centred on
    // the average ability of the players actually on the field. Without that
    // centring the term rewards simply having stronger players out there,
    // which quietly turns a positional preference into a playing-time
    // decision and benches developing players regardless of what they are
    // owed. Centred, it only asks: of the players on the field this inning,
    // are the strongest at the positions the coach marked critical?
    let inningAbilitySum = 0;
    let inningAssigned = 0;
    for (let pos = 0; pos < ctx.nPos; pos++) {
      const playerIdx = row[pos];
      if (playerIdx === EMPTY) continue;
      inningAbilitySum += ctx.players[playerIdx].ability[pos];
      inningAssigned++;
    }
    const meanAbility = inningAssigned > 0 ? inningAbilitySum / inningAssigned : 0;

    for (let pos = 0; pos < ctx.nPos; pos++) {
      const playerIdx = row[pos];
      if (playerIdx === EMPTY) {
        hard += TUNING.hardPenalty;
        continue;
      }
      const player = ctx.players[playerIdx];
      const position = ctx.positions[pos];

      if (!player.allowedAt[pos] || !player.available[inning - 1]) {
        hard += TUNING.hardPenalty;
      }

      const elig = player.eligibility[pos];
      if (elig === 'PREFERRED') preferences -= 1;
      if (elig === 'AVOID') avoid += 1;

      if (position.role === 'PITCHER' && player.preferredPitcher) {
        preferences -= TUNING.preferredBatteryBonus;
      }
      if (position.role === 'CATCHER' && player.preferredCatcher) {
        preferences -= TUNING.preferredBatteryBonus;
      }

      // Stronger players at critical positions, relative to whoever else is
      // on the field this inning.
      critical -= ctx.critical[pos] * (player.ability[pos] - meanAbility);

      development -= player.goalPull[pos];

      // Season position-level debt: favour positions this player is owed,
      // discourage ones they have already had a big share of.
      const posDebt = clamp(
        player.debt.positionDebt[position.code] ?? 0,
        -TUNING.maxPositionDebtPull,
        TUNING.maxPositionDebtPull,
      );
      seasonFairness -= posDebt;

      tieBreak += ctx.tieBreak[playerIdx][pos];
    }
  }

  preferences /= slots;
  critical /= slots;
  development /= slots;

  // ---- Per-player terms ---------------------------------------------------
  let seasonPerPlayer = 0;
  for (let i = 0; i < ctx.nPlayers; i++) {
    const player = ctx.players[i];
    const s = stats.perPlayer[i];

    // Playing-time equality keeps innings clustered around an equal share.
    playingTime += sq(s.defensive - player.equalShare);

    // Season fairness decides *who* gets the extra inning when innings cannot
    // divide evenly. It is deliberately linear: a quadratic pull toward a
    // debt-adjusted target competes with the equality term above and cancels
    // most of the signal, whereas a linear reward ranks players by what they
    // are owed without distorting overall equality.
    const inningDebt =
      clamp(
        player.debt.defensiveDebt,
        -TUNING.maxInningDebtPull,
        TUNING.maxInningDebtPull,
      ) + (player.priority.defensive ? TUNING.priorityDebtEquivalent : 0);
    seasonPerPlayer -= inningDebt * (s.defensive - player.equalShare);

    const minUnique = Math.min(
      rules.minUnique,
      s.defensive,
      player.allowedAt.filter(Boolean).length,
    );
    variety += sq(shortfall(minUnique, s.unique));

    /*
      Position continuity: a player holding one spot for `continuityInnings` at
      a time needs ceil(defensive / block) stints, so every stint beyond that is
      a rotation the coach did not ask for. Counting stints rather than rewarding
      adjacency means a forced move — a pitching change, a late arrival — costs
      one unit instead of cascading.
    */
    if (rules.continuityInnings > 1 && s.defensive > 0) {
      /*
        The floor is per playing run, not per total: a bench inning splits a
        block, so a player who sits mid-game legitimately needs an extra stint.
        Charging them for it would make the objective chase something
        unreachable and trade away real fairness to do it.
      */
      let floorStints = 0;
      let run = 0;
      for (let inning = 1; inning <= ctx.innings; inning++) {
        if (solution.grid[inning].includes(i)) {
          run++;
        } else if (run > 0) {
          floorStints += Math.ceil(run / rules.continuityInnings);
          run = 0;
        }
      }
      if (run > 0) floorStints += Math.ceil(run / rules.continuityInnings);

      continuity += sq(Math.max(0, s.positionStints - floorStints));
    }

    for (let pos = 0; pos < ctx.nPos; pos++) {
      const count = s.posCount[pos];
      // With continuity on, innings inside one block are the point, so only
      // repeats beyond a single block's worth are penalised.
      const freeRepeats = rules.continuityInnings > 1 ? rules.continuityInnings : 1;
      if (count > freeRepeats) repeated += sq(count - freeRepeats);
      if (count > rules.maxInningsSamePosition) {
        repeated += sq(count - rules.maxInningsSamePosition) * 4;
      }
    }
    if (s.longestSamePositionRun > rules.maxConsecutiveSamePosition) {
      repeated += sq(s.longestSamePositionRun - rules.maxConsecutiveSamePosition) * 4;
    }

    groupBalance +=
      sq(s.byGroup.INFIELD - s.defensive * player.groupShare.INFIELD) +
      sq(s.byGroup.OUTFIELD - s.defensive * player.groupShare.OUTFIELD);

    if (player.canPlayInfield && rules.infieldInnings > 0) {
      const want = Math.min(rules.infieldInnings, s.defensive);
      infieldOpportunity += sq(shortfall(want, s.byGroup.INFIELD));
    }
    const infieldDebtPull = clamp(
      player.debt.infieldDebt,
      -TUNING.maxGroupDebtPull,
      TUNING.maxGroupDebtPull,
    );
    const infieldPriority = player.priority.infield ? 1 : 0;
    infieldOpportunity -= (infieldDebtPull + infieldPriority) * s.byGroup.INFIELD;

    consecutiveBench += s.consecutiveBenchPairs;
    if (s.benchedFirstInning) {
      consecutiveBench += player.usage.firstInningBenchGames * TUNING.firstInningBenchScale;
    }

    if (s.byGroup.OUTFIELD > rules.maxOutfieldInnings) {
      outfield += sq(s.byGroup.OUTFIELD - rules.maxOutfieldInnings);
    }
    if (s.byGroup.OUTFIELD < rules.minOutfieldInnings && s.defensive >= rules.minOutfieldInnings) {
      outfield += sq(rules.minOutfieldInnings - s.byGroup.OUTFIELD);
    }
    if (s.longestOutfieldRun > rules.maxConsecutiveOutfieldInnings) {
      outfield += sq(s.longestOutfieldRun - rules.maxConsecutiveOutfieldInnings);
    }

    // ---- Hard requirements -------------------------------------------------
    if (s.pitching > player.maxPitching) {
      hard += TUNING.hardPenalty * (s.pitching - player.maxPitching);
    }
    if (s.catching > player.maxCatching) {
      hard += TUNING.hardPenalty * (s.catching - player.maxCatching);
    }
    if (s.bench > rules.maxBenchInnings) {
      hard += TUNING.hardPenalty * (s.bench - rules.maxBenchInnings);
    }
    if (rules.requiredMinDefensive > 0) {
      const required = Math.min(rules.requiredMinDefensive, player.availableInnings);
      hard += TUNING.hardPenalty * shortfall(required, s.defensive);
    }
    if (rules.infieldRequired && player.canPlayInfield) {
      const required = Math.min(rules.infieldInnings, player.availableInnings);
      hard += TUNING.hardPenalty * shortfall(required, s.byGroup.INFIELD);
    }
    if (ctx.settings.maxConsecutiveCatcherInnings !== undefined) {
      // Catching runs are bounded via the per-position consecutive check below.
      const catcherRun = longestRunAtPositions(ctx, solution, i, ctx.catcherPositions);
      if (catcherRun > ctx.settings.maxConsecutiveCatcherInnings) {
        hard +=
          TUNING.hardPenalty * (catcherRun - ctx.settings.maxConsecutiveCatcherInnings);
      }
    }
    if (ctx.settings.restrictPitcherCatcherTransition && s.batteryTransition) {
      hard += TUNING.hardPenalty;
    }

    // Unmet "at least one inning" development goals.
    for (let pos = 0; pos < ctx.nPos; pos++) {
      if (player.goalAtLeastOne[pos] && s.posCount[pos] === 0) development += 1;
    }
  }

  playingTime /= n;
  seasonPerPlayer /= n;
  variety /= n;
  repeated /= n;
  groupBalance /= n;
  continuity /= n;
  infieldOpportunity /= n;
  // Season term combines per-player inning debt with per-assignment position debt.
  seasonFairness = seasonPerPlayer + seasonFairness / slots;

  const terms: Record<string, number> = {
    playingTimeEquality: w.playingTimeEquality * playingTime,
    seasonFairness: w.seasonFairness * seasonFairness,
    positionVariety: w.positionVariety * variety,
    positionContinuity: w.positionContinuity * continuity,
    repeatedPositionPenalty: w.repeatedPositionPenalty * repeated,
    positionGroupBalance: w.positionGroupBalance * groupBalance,
    infieldOpportunity: w.infieldOpportunity * infieldOpportunity,
    playerPreferences: w.playerPreferences * preferences,
    avoidPositionPenalty: w.avoidPositionPenalty * avoid,
    criticalPositionStrength: w.criticalPositionStrength * critical,
    developmentGoals: w.developmentGoals * development,
    consecutiveBenchPenalty: w.consecutiveBenchPenalty * consecutiveBench,
    excessiveOutfieldPenalty: w.excessiveOutfieldPenalty * outfield,
  };

  let total = hard + tieBreak * TUNING.tieBreakScale;
  for (const value of Object.values(terms)) total += value;

  return { total, hard, terms };
}

/** Longest run of consecutive innings a player spent in any of `positions`. */
export function longestRunAtPositions(
  ctx: SolverContext,
  solution: Solution,
  playerIdx: number,
  positions: number[],
): number {
  if (positions.length === 0) return 0;
  const inSet = new Set(positions);
  let run = 0;
  let longest = 0;
  for (let inning = 1; inning <= ctx.innings; inning++) {
    const pos = solution.grid[inning].indexOf(playerIdx);
    if (pos >= 0 && inSet.has(pos)) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return longest;
}
