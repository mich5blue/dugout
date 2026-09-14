import { createId } from '@/domain/factories';
import type {
  AssignmentType,
  DefensiveAssignment,
  DevelopmentGoal,
  Game,
  Player,
  PriorityFlag,
  Team,
} from '@/domain/types';
import { resolveWeights } from '@/domain/weights';
import { optimizer, type LockedAssignment, type OptimizationInput, type OptimizationResult } from '@/optimizer';
import { generateBattingOrder } from '@/optimizer/batting';
import { buildContext } from '@/optimizer/context';
import { getFairnessDebt } from './fairness';
import { getPlayerSeasonUsage } from './seasonStatistics';

/**
 * Orchestrates lineup generation. This is the only place that assembles an
 * OptimizationInput, so every generated lineup is reproducible from data that
 * is persisted alongside the game.
 */

export interface GenerateOptions {
  team: Team;
  game: Game;
  players: Player[];
  /** All games for the team, used for season history. */
  history: Game[];
  goals?: DevelopmentGoal[];
  flags?: PriorityFlag[];
  /** Overrides the game's stored seed, for "Generate Another". */
  seed?: number;
  /** Innings already played that must be preserved (mid-game rebalance). */
  frozenInnings?: number;
  timeBudgetMs?: number;
}

export function buildOptimizationInput(options: GenerateOptions): OptimizationInput {
  const { team, game, players, history } = options;

  // Season history excludes the game being generated.
  const priorGames = history.filter((entry) => entry.id !== game.id);
  const seasonUsage = getPlayerSeasonUsage(priorGames);
  const fairnessDebt = getFairnessDebt(priorGames, players);

  const lockedAssignments: LockedAssignment[] = game.defensiveAssignments
    .filter((assignment) => assignment.locked && assignment.assignmentType === 'PLANNED')
    .map((assignment) => ({
      inning: assignment.inning,
      positionId: assignment.positionId,
      playerId: assignment.playerId,
    }));

  const frozenInnings = options.frozenInnings ?? 0;
  const frozenAssignments: LockedAssignment[] = game.defensiveAssignments
    .filter((assignment) => assignment.inning <= frozenInnings)
    .map((assignment) => ({
      inning: assignment.inning,
      positionId: assignment.positionId,
      playerId: assignment.playerId,
    }));

  const lockedBattingSlots: Record<string, number> = {};
  for (const assignment of game.battingAssignments) {
    if (assignment.locked) lockedBattingSlots[assignment.playerId] = assignment.battingSlot;
  }

  const settings = game.settingsSnapshot ?? team.settings;

  return {
    formation: game.formationSnapshot,
    innings: game.plannedInnings,
    players,
    gamePlayers: game.gamePlayers,
    settings,
    weights: resolveWeights(settings),
    fairnessDebt,
    seasonUsage,
    developmentGoals: (options.goals ?? []).filter((goal) => goal.active),
    priorityFlags: options.flags ?? [],
    pitchingPlan: game.pitchingPlan,
    lockedAssignments,
    lockedBattingSlots,
    eligibilityOverrides: game.eligibilityOverrides,
    frozenInnings,
    frozenAssignments,
    seed: options.seed ?? game.optimizerSeed,
    timeBudgetMs: options.timeBudgetMs,
  };
}

export async function generateLineup(
  options: GenerateOptions,
): Promise<{ result: OptimizationResult; game: Game }> {
  const input = buildOptimizationInput(options);
  const result = await optimizer.generate(input);
  const game = result.ok ? applyResultToGame(options.game, result, input.seed) : options.game;
  return { result, game };
}

/**
 * Regenerates only the batting order, leaving the defensive rotation alone.
 *
 * Separate from `generateLineup` because the two are independent decisions and
 * a coach who has settled the defence should be able to reshuffle who hits
 * where without risking the grid they just finished adjusting. Locked slots
 * are honoured, exactly as the full generator honours them.
 */
export function regenerateBattingOrder(options: GenerateOptions): Game {
  const input = buildOptimizationInput(options);
  const ctx = buildContext(input);
  const order = generateBattingOrder(ctx);
  return setBattingOrder(
    options.game,
    order.map((entry) => ({
      playerId: entry.playerId,
      battingSlot: entry.battingSlot,
      locked: entry.locked,
    })),
  );
}

/** Writes a generated lineup onto the game as PLANNED assignments. */
export function applyResultToGame(
  game: Game,
  result: OptimizationResult,
  seed: number,
): Game {
  // Keep any ACTUAL rows: recording results must survive a re-generation.
  const actuals = game.defensiveAssignments.filter((a) => a.assignmentType === 'ACTUAL');

  const planned: DefensiveAssignment[] = result.defensive.map((assignment) => ({
    id: createId('asg'),
    gameId: game.id,
    inning: assignment.inning,
    positionId: assignment.positionId,
    playerId: assignment.playerId,
    locked: assignment.locked,
    assignmentType: 'PLANNED',
  }));

  return {
    ...game,
    defensiveAssignments: [...planned, ...actuals],
    battingAssignments: result.batting.map((assignment) => ({
      gameId: game.id,
      playerId: assignment.playerId,
      battingSlot: assignment.battingSlot,
      locked: assignment.locked,
    })),
    optimizerVersion: result.optimizerVersion,
    optimizerSeed: seed,
  };
}

/** Planned assignments as a lookup: `${inning}|${positionId}` -> assignment. */
export function plannedGrid(game: Game): Map<string, DefensiveAssignment> {
  const map = new Map<string, DefensiveAssignment>();
  for (const assignment of game.defensiveAssignments) {
    if (assignment.assignmentType !== 'PLANNED') continue;
    map.set(`${assignment.inning}|${assignment.positionId}`, assignment);
  }
  return map;
}

export function assignmentsForInning(
  game: Game,
  inning: number,
  type: DefensiveAssignment['assignmentType'] = 'PLANNED',
): DefensiveAssignment[] {
  return game.defensiveAssignments.filter(
    (assignment) => assignment.inning === inning && assignment.assignmentType === type,
  );
}

export function benchedPlayerIds(game: Game, inning: number): string[] {
  const assigned = new Set(
    assignmentsForInning(game, inning).map((assignment) => assignment.playerId),
  );
  return game.gamePlayers
    .filter((gp) => {
      if (!gp.available) return false;
      const arrival = gp.arrivalInning ?? 1;
      const departure = gp.departureInning ?? game.plannedInnings;
      return inning >= arrival && inning <= departure && !assigned.has(gp.playerId);
    })
    .map((gp) => gp.playerId);
}

/**
 * Manual edit: put `playerId` at a position in an inning. If that player is
 * already on the field that inning the two swap; otherwise whoever held the
 * position goes to the bench. Passing null empties the position.
 *
 * `type` decides whether this edits the plan or the record of what happened.
 * Both need identical semantics — the actual-side used to have its own simpler
 * version that only overwrote the target cell, which left a player standing at
 * two positions in the same inning whenever a coach corrected a result. The
 * duplicate then fed straight into season statistics as two innings played.
 */
export function setAssignment(
  game: Game,
  inning: number,
  positionId: string,
  playerId: string | null,
  type: AssignmentType = 'PLANNED',
): Game {
  const planned = game.defensiveAssignments.filter((a) => a.assignmentType === type);
  const others = game.defensiveAssignments.filter((a) => a.assignmentType !== type);

  const targetIndex = planned.findIndex(
    (a) => a.inning === inning && a.positionId === positionId,
  );
  const displaced = targetIndex >= 0 ? planned[targetIndex] : null;

  if (playerId === null) {
    const next = targetIndex >= 0 ? planned.filter((_, i) => i !== targetIndex) : planned;
    return { ...game, defensiveAssignments: [...next, ...others] };
  }

  const existingIndex = planned.findIndex(
    (a) => a.inning === inning && a.playerId === playerId,
  );

  const updated = planned.map((assignment) => ({ ...assignment }));

  if (existingIndex >= 0 && displaced) {
    // Straight swap between two positions in the same inning.
    updated[existingIndex] = { ...updated[existingIndex], playerId: displaced.playerId };
    updated[targetIndex] = { ...updated[targetIndex], playerId };
    return { ...game, defensiveAssignments: [...updated, ...others] };
  }

  if (existingIndex >= 0) {
    updated[existingIndex] = { ...updated[existingIndex], positionId };
    return { ...game, defensiveAssignments: [...updated, ...others] };
  }

  if (targetIndex >= 0) {
    updated[targetIndex] = { ...updated[targetIndex], playerId };
    return { ...game, defensiveAssignments: [...updated, ...others] };
  }

  updated.push({
    id: createId('asg'),
    gameId: game.id,
    inning,
    positionId,
    playerId,
    locked: false,
    assignmentType: type,
  });
  return { ...game, defensiveAssignments: [...updated, ...others] };
}

export function toggleLock(game: Game, inning: number, positionId: string): Game {
  return {
    ...game,
    defensiveAssignments: game.defensiveAssignments.map((assignment) =>
      assignment.assignmentType === 'PLANNED' &&
      assignment.inning === inning &&
      assignment.positionId === positionId
        ? { ...assignment, locked: !assignment.locked }
        : assignment,
    ),
  };
}

export function setInningLocked(game: Game, inning: number, locked: boolean): Game {
  return {
    ...game,
    defensiveAssignments: game.defensiveAssignments.map((assignment) =>
      assignment.assignmentType === 'PLANNED' && assignment.inning === inning
        ? { ...assignment, locked }
        : assignment,
    ),
  };
}

export function setPlayerScheduleLocked(
  game: Game,
  playerId: string,
  locked: boolean,
): Game {
  return {
    ...game,
    defensiveAssignments: game.defensiveAssignments.map((assignment) =>
      assignment.assignmentType === 'PLANNED' && assignment.playerId === playerId
        ? { ...assignment, locked }
        : assignment,
    ),
  };
}

export function setBattingSlotLocked(game: Game, playerId: string, locked: boolean): Game {
  return {
    ...game,
    battingAssignments: game.battingAssignments.map((assignment) =>
      assignment.playerId === playerId ? { ...assignment, locked } : assignment,
    ),
  };
}

export function setBattingOrder(
  game: Game,
  order: Array<{ playerId: string; battingSlot: number; locked?: boolean }>,
): Game {
  const lockedByPlayer = new Map(
    game.battingAssignments.map((a) => [a.playerId, a.locked]),
  );
  return {
    ...game,
    battingAssignments: order.map((entry) => ({
      gameId: game.id,
      playerId: entry.playerId,
      battingSlot: entry.battingSlot,
      locked: entry.locked ?? lockedByPlayer.get(entry.playerId) ?? false,
    })),
  };
}

/**
 * Records what actually happened. Planned assignments are materialised as
 * ACTUAL rows for the innings that were played, so later edits to team settings
 * or re-generation cannot rewrite history.
 */
export function recordActualResults(
  game: Game,
  actualInnings: number,
  edits: Array<{ inning: number; positionId: string; playerId: string }> = [],
): Game {
  const editMap = new Map(edits.map((edit) => [`${edit.inning}|${edit.positionId}`, edit.playerId]));

  const actuals: DefensiveAssignment[] = [];
  for (const assignment of game.defensiveAssignments) {
    if (assignment.assignmentType !== 'PLANNED') continue;
    if (assignment.inning > actualInnings) continue;
    const key = `${assignment.inning}|${assignment.positionId}`;
    actuals.push({
      id: createId('asg'),
      gameId: game.id,
      inning: assignment.inning,
      positionId: assignment.positionId,
      playerId: editMap.get(key) ?? assignment.playerId,
      locked: false,
      assignmentType: 'ACTUAL',
    });
    editMap.delete(key);
  }

  // Edits for cells that had no planned assignment.
  for (const [key, playerId] of editMap) {
    const [inningText, positionId] = key.split('|');
    const inning = Number(inningText);
    if (inning > actualInnings) continue;
    actuals.push({
      id: createId('asg'),
      gameId: game.id,
      inning,
      positionId,
      playerId,
      locked: false,
      assignmentType: 'ACTUAL',
    });
  }

  return {
    ...game,
    actualInnings,
    status: 'COMPLETED',
    defensiveAssignments: [
      ...game.defensiveAssignments.filter((a) => a.assignmentType === 'PLANNED'),
      ...actuals,
    ],
  };
}

/**
 * Correct what actually happened in a recorded game.
 *
 * Delegates so a correction behaves exactly like a planned edit: swapping
 * rather than duplicating, and accepting null to bench a player who sat when
 * they were not scheduled to.
 */
export function updateActualAssignment(
  game: Game,
  inning: number,
  positionId: string,
  playerId: string | null,
): Game {
  return setAssignment(game, inning, positionId, playerId, 'ACTUAL');
}

export function setAvailability(
  game: Game,
  playerId: string,
  changes: Partial<{ available: boolean; arrivalInning?: number; departureInning?: number }>,
): Game {
  return {
    ...game,
    gamePlayers: game.gamePlayers.map((gp) =>
      gp.playerId === playerId ? { ...gp, ...changes } : gp,
    ),
  };
}

export function setPitchingPlan(game: Game, inning: number, playerId: string | null): Game {
  const plan = { ...game.pitchingPlan };
  if (playerId === null) delete plan[inning];
  else plan[inning] = playerId;
  return { ...game, pitchingPlan: plan };
}

/** Drops every generated assignment, keeping locks and the pitching plan. */
export function clearGeneratedLineup(game: Game): Game {
  return {
    ...game,
    defensiveAssignments: game.defensiveAssignments.filter(
      (assignment) => assignment.assignmentType === 'ACTUAL' || assignment.locked,
    ),
    battingAssignments: game.battingAssignments.filter((assignment) => assignment.locked),
  };
}
