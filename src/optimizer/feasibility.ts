import type { SolverContext } from './context';
import { minCostAssignment } from './hungarian';
import { effectiveRules } from './objective';
import type { Conflict, RelaxationSuggestion } from './types';

/**
 * Pre-flight analysis. InningGrid must never say "unable to generate" without
 * explaining why, so every structural impossibility is detected here and
 * paired with the smallest changes that would fix it.
 */

export interface FeasibilityReport {
  conflicts: Conflict[];
  relaxations: RelaxationSuggestion[];
  /** True when no ERROR-level conflict was found. */
  feasible: boolean;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function analyzeFeasibility(ctx: SolverContext): FeasibilityReport {
  const conflicts: Conflict[] = [];
  const relaxations: RelaxationSuggestion[] = [];
  const rules = effectiveRules(ctx);

  const addError = (code: string, message: string) =>
    conflicts.push({ severity: 'ERROR', code, message });
  const addWarning = (code: string, message: string) =>
    conflicts.push({ severity: 'WARNING', code, message });

  // ---- 1. Enough bodies on the field ------------------------------------
  for (let inning = 1; inning <= ctx.innings; inning++) {
    const available = ctx.players.filter((p) => p.available[inning - 1]);
    if (available.length < ctx.nPos) {
      addError(
        'NOT_ENOUGH_PLAYERS',
        `Inning ${inning} has only ${plural(available.length, 'available player')} but the formation needs ${ctx.nPos}.`,
      );
      relaxations.push({
        message: `Use a formation with ${available.length} defensive positions for this game.`,
        impact: 3,
      });
    }
  }

  // ---- 2. Each inning must admit a complete assignment -------------------
  for (let inning = 1; inning <= ctx.innings; inning++) {
    const available = ctx.players.filter((p) => p.available[inning - 1]);
    if (available.length < ctx.nPos) continue;

    const openPositions: number[] = [];
    const taken = new Set<number>();
    for (let pos = 0; pos < ctx.nPos; pos++) {
      const lockedPlayer = ctx.locked[inning][pos];
      if (lockedPlayer >= 0 && !taken.has(lockedPlayer)) {
        taken.add(lockedPlayer);
      } else {
        openPositions.push(pos);
      }
    }
    const candidates = available.filter((p) => !taken.has(p.idx));

    const matrix = openPositions.map((pos) =>
      candidates.map((p) => (p.allowedAt[pos] ? 0 : Number.POSITIVE_INFINITY)),
    );

    if (candidates.length < openPositions.length || !minCostAssignment(matrix)) {
      // Find the specific positions with too few eligible players.
      for (const pos of openPositions) {
        const eligible = candidates.filter((p) => p.allowedAt[pos]);
        const position = ctx.positions[pos];
        if (eligible.length === 0) {
          addError(
            'NO_ELIGIBLE_PLAYER',
            `No eligible player is available at ${position.displayName} (${position.code}) in inning ${inning}.`,
          );
          relaxations.push({
            message: `Allow another player at ${position.code}.`,
            impact: 1,
            action: { type: 'ADD_ELIGIBLE_PLAYER', positionId: position.id },
          });
        }
      }
      if (!conflicts.some((c) => c.code === 'NO_ELIGIBLE_PLAYER')) {
        addError(
          'INNING_INFEASIBLE',
          `Inning ${inning} cannot be filled: too many positions depend on the same few eligible players.`,
        );
      }
    }
  }

  // ---- 3. Single-eligible positions with limited availability ------------
  for (let pos = 0; pos < ctx.nPos; pos++) {
    const position = ctx.positions[pos];
    const eligible = ctx.players.filter((p) => p.allowedAt[pos]);
    if (eligible.length === 1) {
      const only = eligible[0];
      if (only.availableInnings < ctx.innings) {
        const lastInning = only.available.lastIndexOf(true) + 1;
        addWarning(
          'SOLE_ELIGIBLE_LIMITED',
          `${only.name} is the only player eligible at ${position.code} and is only available through inning ${lastInning}.`,
        );
        relaxations.push({
          message: `Allow another player at ${position.code}.`,
          impact: 1,
          action: { type: 'ADD_ELIGIBLE_PLAYER', positionId: position.id },
        });
      }
    }
  }

  // ---- 4. Required minimum defensive innings ----------------------------
  if (rules.requiredMinDefensive > 0) {
    const demand = ctx.players.reduce(
      (acc, p) => acc + Math.min(rules.requiredMinDefensive, p.availableInnings),
      0,
    );
    if (demand > ctx.totalSlots) {
      const feasibleMin = feasibleMinimum(ctx);
      addError(
        'MIN_INNINGS_IMPOSSIBLE',
        `${plural(rules.requiredMinDefensive, 'defensive inning')} cannot be guaranteed to all ${ctx.nPlayers} players with ${ctx.nPos} defensive positions in a ${ctx.innings}-inning game.`,
      );
      relaxations.push({
        message: `Reduce minimum playing time from ${rules.requiredMinDefensive} innings to ${feasibleMin}.`,
        impact: 2,
        action: { type: 'REDUCE_MIN_DEFENSIVE_INNINGS', to: feasibleMin },
      });
    }
  }

  // ---- 5. Required infield opportunity ----------------------------------
  if (rules.infieldRequired && ctx.infieldPositions.length > 0) {
    const infieldSlots = ctx.innings * ctx.infieldPositions.length;
    const eligible = ctx.players.filter((p) => p.canPlayInfield);
    const demand = eligible.reduce(
      (acc, p) => acc + Math.min(rules.infieldInnings, p.availableInnings),
      0,
    );
    if (demand > infieldSlots) {
      addError(
        'INFIELD_IMPOSSIBLE',
        `${plural(rules.infieldInnings, 'infield inning')} for all ${eligible.length} eligible players needs ${demand} infield innings, but only ${infieldSlots} exist in this game.`,
      );
      const to = Math.max(1, Math.floor(infieldSlots / Math.max(1, eligible.length)));
      relaxations.push({
        message:
          to < rules.infieldInnings
            ? `Reduce the infield guarantee to ${plural(to, 'inning')}.`
            : `Make the infield guarantee a target instead of a requirement.`,
        impact: 2,
        action: { type: 'RELAX_INFIELD_REQUIREMENT', to },
      });
    }
  }

  // ---- 6. Battery capacity ----------------------------------------------
  checkRoleCapacity(ctx, 'PITCHER', conflicts, relaxations);
  checkRoleCapacity(ctx, 'CATCHER', conflicts, relaxations);

  // ---- 7. Pitching plan sanity ------------------------------------------
  const primaryPitcher = ctx.pitcherPositions[0];
  if (primaryPitcher !== undefined) {
    for (const [inningKey, playerId] of Object.entries(ctx.input.pitchingPlan)) {
      const inning = Number(inningKey);
      const player = ctx.byId.get(playerId);
      if (!player) {
        addError(
          'PLANNED_PITCHER_UNAVAILABLE',
          `The pitcher planned for inning ${inning} is not available for this game.`,
        );
        continue;
      }
      if (!player.available[inning - 1]) {
        addError(
          'PLANNED_PITCHER_UNAVAILABLE',
          `${player.name} is planned to pitch inning ${inning} but is not available that inning.`,
        );
      }
      if (!player.allowedAt[primaryPitcher]) {
        addError(
          'PLANNED_PITCHER_INELIGIBLE',
          `${player.name} is planned to pitch inning ${inning} but is not marked as a pitcher.`,
        );
      }
    }

    const plannedCounts = new Map<string, number>();
    for (const playerId of Object.values(ctx.input.pitchingPlan)) {
      plannedCounts.set(playerId, (plannedCounts.get(playerId) ?? 0) + 1);
    }
    for (const [playerId, count] of plannedCounts) {
      const player = ctx.byId.get(playerId);
      if (player && count > player.maxPitching) {
        addError(
          'PLANNED_PITCHER_OVER_CAP',
          `${player.name} is planned for ${plural(count, 'inning')} of pitching but is capped at ${player.maxPitching}.`,
        );
        relaxations.push({
          message: `Raise ${player.name}'s pitching limit to ${count} innings.`,
          impact: 1,
          action: { type: 'RAISE_PITCHING_CAP', to: count },
        });
      }
    }
  }

  // ---- 8. Bench capacity -------------------------------------------------
  if (rules.maxBenchInnings !== Number.POSITIVE_INFINITY) {
    const totalAvailability = ctx.players.reduce((acc, p) => acc + p.availableInnings, 0);
    const benchInnings = totalAvailability - ctx.totalSlots;
    const capacity = rules.maxBenchInnings * ctx.nPlayers;
    if (benchInnings > capacity) {
      addError(
        'BENCH_CAP_IMPOSSIBLE',
        `This game creates ${plural(benchInnings, 'bench inning')}, which cannot fit under a limit of ${rules.maxBenchInnings} per player.`,
      );
      relaxations.push({
        message: `Raise the maximum bench innings to ${Math.ceil(benchInnings / ctx.nPlayers)}.`,
        impact: 2,
      });
    }
  }

  // ---- 9. No-consecutive-bench feasibility ------------------------------
  if (ctx.settings.noConsecutiveBench) {
    const benchPerInning = ctx.players.filter((p) => p.available[0]).length - ctx.nPos;
    const spare = ctx.nPlayers - ctx.nPos;
    if (benchPerInning > 0 && spare > 0 && benchPerInning * 2 > ctx.nPlayers) {
      addWarning(
        'CONSECUTIVE_BENCH_TIGHT',
        `With ${plural(benchPerInning, 'player')} sitting each inning, some players may have to sit twice in a row.`,
      );
      relaxations.push({
        message: 'Allow consecutive bench innings.',
        impact: 2,
        action: { type: 'ALLOW_CONSECUTIVE_BENCH' },
      });
    }
  }

  relaxations.sort((a, b) => a.impact - b.impact);

  return {
    conflicts,
    relaxations: dedupeRelaxations(relaxations),
    feasible: !conflicts.some((c) => c.severity === 'ERROR'),
  };
}

/** Largest minimum-innings value that every player could actually receive. */
export function feasibleMinimum(ctx: SolverContext): number {
  for (let candidate = ctx.innings; candidate >= 0; candidate--) {
    const demand = ctx.players.reduce(
      (acc, p) => acc + Math.min(candidate, p.availableInnings),
      0,
    );
    if (demand <= ctx.totalSlots) return candidate;
  }
  return 0;
}

function checkRoleCapacity(
  ctx: SolverContext,
  role: 'PITCHER' | 'CATCHER',
  conflicts: Conflict[],
  relaxations: RelaxationSuggestion[],
): void {
  const positions = role === 'PITCHER' ? ctx.pitcherPositions : ctx.catcherPositions;
  if (positions.length === 0) return;

  const needed = ctx.innings * positions.length;
  const eligible = ctx.players.filter((p) => positions.some((pos) => p.allowedAt[pos]));
  const capacityOf = (p: (typeof ctx.players)[number]) =>
    Math.min(role === 'PITCHER' ? p.maxPitching : p.maxCatching, p.availableInnings);
  const capacity = eligible.reduce((acc, p) => acc + capacityOf(p), 0);

  const label = role === 'PITCHER' ? 'pitching' : 'catching';

  if (eligible.length === 0) {
    conflicts.push({
      severity: 'ERROR',
      code: role === 'PITCHER' ? 'NO_PITCHERS' : 'NO_CATCHERS',
      message: `No player in this game is marked as able to ${role === 'PITCHER' ? 'pitch' : 'catch'}.`,
    });
    return;
  }

  if (capacity < needed) {
    conflicts.push({
      severity: 'ERROR',
      code: role === 'PITCHER' ? 'PITCHING_CAPACITY' : 'CATCHING_CAPACITY',
      message: `This game needs ${plural(needed, `${label} inning`)}, but the eligible players can only cover ${capacity} under their current limits.`,
    });
    const perPlayer = Math.ceil(needed / eligible.length);
    relaxations.push({
      message: `Raise the ${label} limit to ${plural(perPlayer, 'inning')} per player, or mark another player as able to ${role === 'PITCHER' ? 'pitch' : 'catch'}.`,
      impact: 1,
      action:
        role === 'PITCHER'
          ? { type: 'RAISE_PITCHING_CAP', to: perPlayer }
          : { type: 'RAISE_CATCHING_CAP', to: perPlayer },
    });
  }

  // Per-inning coverage, which a season-level capacity check can miss.
  for (let inning = 1; inning <= ctx.innings; inning++) {
    const availableEligible = eligible.filter((p) => p.available[inning - 1]);
    if (availableEligible.length < positions.length) {
      conflicts.push({
        severity: 'ERROR',
        code: role === 'PITCHER' ? 'NO_PITCHER_IN_INNING' : 'NO_CATCHER_IN_INNING',
        message: `No eligible ${role === 'PITCHER' ? 'pitcher' : 'catcher'} is available for inning ${inning}.`,
      });
    }
  }
}

function dedupeRelaxations(items: RelaxationSuggestion[]): RelaxationSuggestion[] {
  const seen = new Set<string>();
  const out: RelaxationSuggestion[] = [];
  for (const item of items) {
    if (seen.has(item.message)) continue;
    seen.add(item.message);
    out.push(item);
  }
  return out;
}
