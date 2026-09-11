import { cloneFormation, getSystemFormation } from '@/domain/formations';
import { createGame, createPlayer, createTeam } from '@/domain/factories';
import type {
  AbilityTier,
  DefensiveAssignment,
  Eligibility,
  Formation,
  Game,
  Player,
  Team,
  TeamSettings,
} from '@/domain/types';
import { defaultTeamSettings } from '@/domain/weights';
import { generateLineup } from '@/services/lineupService';
import type { OptimizationResult } from '@/optimizer';

/** Test fixtures for the scenarios in the build spec (section 68). */

export interface PlayerSpec {
  name: string;
  tier?: AbilityTier;
  offensiveTier?: AbilityTier;
  canPitch?: boolean;
  canCatch?: boolean;
  /** Position codes the player can never play. */
  never?: string[];
  avoid?: string[];
  preferred?: string[];
  available?: boolean;
  arrival?: number;
  departure?: number;
  maxPitchingInnings?: number;
}

export interface ScenarioSpec {
  formationId?: string;
  innings?: number;
  players: PlayerSpec[];
  settings?: Partial<TeamSettings>;
  /** Inning -> player name. */
  pitchingPlan?: Record<number, string>;
  seed?: number;
}

export interface Scenario {
  team: Team;
  formation: Formation;
  players: Player[];
  game: Game;
  byName(name: string): Player;
  positionId(code: string): string;
}

export function buildScenario(spec: ScenarioSpec): Scenario {
  const formationId = spec.formationId ?? 'baseball-10-lc-rc';
  const preset = getSystemFormation(formationId);
  if (!preset) throw new Error(`Unknown formation ${formationId}`);
  const formation = cloneFormation(preset);

  const settings: TeamSettings = { ...defaultTeamSettings(), ...spec.settings };
  const team = createTeam({
    name: 'Test Team',
    sport: formation.sport,
    defaultInnings: spec.innings ?? 6,
    defaultFormationId: formation.id,
    settings,
  });

  const positionIdByCode = new Map(formation.positions.map((p) => [p.code, p.id]));
  const positionId = (code: string): string => {
    const id = positionIdByCode.get(code);
    if (!id) throw new Error(`Unknown position code ${code}`);
    return id;
  };

  const players: Player[] = spec.players.map((playerSpec, index) => {
    const player = createPlayer({
      teamId: team.id,
      firstName: playerSpec.name,
      lastName: '',
      jerseyNumber: String(index + 1),
      overallTier: playerSpec.tier ?? 'REGULAR',
      offensiveTier: playerSpec.offensiveTier ?? playerSpec.tier ?? 'REGULAR',
      canPitch: playerSpec.canPitch ?? false,
      canCatch: playerSpec.canCatch ?? false,
      // Deterministic ordering for reproducible tests.
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    });

    const setRating = (code: string, eligibility: Eligibility) => {
      const id = positionId(code);
      player.positionRatings[id] = { positionId: id, eligibility };
    };
    for (const code of playerSpec.never ?? []) setRating(code, 'NEVER');
    for (const code of playerSpec.avoid ?? []) setRating(code, 'AVOID');
    for (const code of playerSpec.preferred ?? []) setRating(code, 'PREFERRED');
    if (playerSpec.maxPitchingInnings !== undefined) {
      player.maxPitchingInnings = playerSpec.maxPitchingInnings;
    }

    return player;
  });

  const byNameMap = new Map(players.map((player) => [player.firstName, player]));
  const byName = (name: string): Player => {
    const player = byNameMap.get(name);
    if (!player) throw new Error(`Unknown player ${name}`);
    return player;
  };

  const game = createGame({
    teamId: team.id,
    opponent: 'Opponent',
    date: '2026-04-18',
    plannedInnings: spec.innings ?? 6,
    formation,
    settings,
    players,
    seed: spec.seed ?? 1,
  });

  game.gamePlayers = game.gamePlayers.map((gp) => {
    const player = players.find((p) => p.id === gp.playerId)!;
    const playerSpec = spec.players.find((s) => s.name === player.firstName)!;
    return {
      ...gp,
      available: playerSpec.available ?? true,
      arrivalInning: playerSpec.arrival,
      departureInning: playerSpec.departure,
    };
  });

  if (spec.pitchingPlan) {
    for (const [inning, name] of Object.entries(spec.pitchingPlan)) {
      game.pitchingPlan[Number(inning)] = byName(name).id;
    }
  }

  return { team, formation, players, game, byName, positionId };
}

export async function runScenario(
  scenario: Scenario,
  options: { history?: Game[]; seed?: number } = {},
): Promise<{ result: OptimizationResult; game: Game }> {
  return generateLineup({
    team: scenario.team,
    game: scenario.game,
    players: scenario.players,
    history: options.history ?? [],
    seed: options.seed,
  });
}

/**
 * Independent invariant checks (spec section 69). Deliberately does not reuse
 * the optimizer's own validator, so a bug there cannot hide a bad lineup.
 */
export function checkInvariants(scenario: Scenario, result: OptimizationResult): string[] {
  const problems: string[] = [];
  const { formation, game, players } = scenario;
  const innings = game.plannedInnings;

  const playersById = new Map(players.map((player) => [player.id, player]));
  const availability = new Map(
    game.gamePlayers.map((gp) => [
      gp.playerId,
      {
        available: gp.available,
        arrival: gp.arrivalInning ?? 1,
        departure: gp.departureInning ?? innings,
      },
    ]),
  );

  for (let inning = 1; inning <= innings; inning++) {
    const inningAssignments = result.defensive.filter((a) => a.inning === inning);

    for (const position of formation.positions) {
      const filled = inningAssignments.filter((a) => a.positionId === position.id);
      if (filled.length !== 1) {
        problems.push(
          `inning ${inning} ${position.code}: expected exactly 1 player, found ${filled.length}`,
        );
      }
    }

    const seen = new Set<string>();
    for (const assignment of inningAssignments) {
      if (seen.has(assignment.playerId)) {
        problems.push(`inning ${inning}: ${assignment.playerId} assigned twice`);
      }
      seen.add(assignment.playerId);

      const window = availability.get(assignment.playerId);
      if (!window || !window.available) {
        problems.push(`inning ${inning}: unavailable player assigned`);
      } else if (inning < window.arrival || inning > window.departure) {
        problems.push(
          `inning ${inning}: player assigned outside availability window (${window.arrival}-${window.departure})`,
        );
      }

      const player = playersById.get(assignment.playerId);
      const rating = player?.positionRatings[assignment.positionId];
      if (rating?.eligibility === 'NEVER') {
        problems.push(
          `inning ${inning}: ${player?.firstName} assigned to a NEVER position`,
        );
      }
      const position = formation.positions.find((p) => p.id === assignment.positionId);
      if (position?.role === 'PITCHER' && player && !player.canPitch) {
        problems.push(`inning ${inning}: ${player.firstName} pitching without canPitch`);
      }
      if (position?.role === 'CATCHER' && player && !player.canCatch) {
        problems.push(`inning ${inning}: ${player.firstName} catching without canCatch`);
      }
    }
  }

  // Locks preserved.
  for (const [inningText, playerId] of Object.entries(game.pitchingPlan)) {
    const inning = Number(inningText);
    const pitcherPosition = formation.positions.find((p) => p.role === 'PITCHER');
    if (!pitcherPosition) continue;
    const assignment = result.defensive.find(
      (a) => a.inning === inning && a.positionId === pitcherPosition.id,
    );
    if (assignment?.playerId !== playerId) {
      problems.push(`inning ${inning}: pitching plan not honoured`);
    }
  }

  // Batting order: one slot per player, no duplicates, no gaps.
  const availablePlayers = game.gamePlayers.filter((gp) => {
    if (!gp.available) return false;
    const arrival = gp.arrivalInning ?? 1;
    const departure = gp.departureInning ?? innings;
    return departure >= arrival;
  });
  const slots = result.batting.map((b) => b.battingSlot).sort((a, b) => a - b);
  const expected = Array.from({ length: availablePlayers.length }, (_, i) => i + 1);
  if (slots.length !== expected.length || slots.some((slot, i) => slot !== expected[i])) {
    problems.push(
      `batting order should be slots 1..${expected.length}, got [${slots.join(', ')}]`,
    );
  }
  const battingPlayers = new Set(result.batting.map((b) => b.playerId));
  if (battingPlayers.size !== result.batting.length) {
    problems.push('batting order contains a duplicate player');
  }

  return problems;
}

/** Defensive innings per player id. */
export function defensiveInnings(result: OptimizationResult): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const assignment of result.defensive) {
    counts[assignment.playerId] = (counts[assignment.playerId] ?? 0) + 1;
  }
  return counts;
}

export function inningsInGroup(
  scenario: Scenario,
  result: OptimizationResult,
  group: 'BATTERY' | 'INFIELD' | 'OUTFIELD',
): Record<string, number> {
  const groupByPositionId = new Map(
    scenario.formation.positions.map((p) => [p.id, p.group]),
  );
  const counts: Record<string, number> = {};
  for (const player of scenario.players) counts[player.id] = 0;
  for (const assignment of result.defensive) {
    if (groupByPositionId.get(assignment.positionId) === group) {
      counts[assignment.playerId] = (counts[assignment.playerId] ?? 0) + 1;
    }
  }
  return counts;
}

export function positionCounts(
  scenario: Scenario,
  result: OptimizationResult,
  playerId: string,
): Record<string, number> {
  const codeByPositionId = new Map(
    scenario.formation.positions.map((p) => [p.id, p.code]),
  );
  const counts: Record<string, number> = {};
  for (const assignment of result.defensive) {
    if (assignment.playerId !== playerId) continue;
    const code = codeByPositionId.get(assignment.positionId)!;
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

export function benchInnings(
  scenario: Scenario,
  result: OptimizationResult,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const player of scenario.players) counts[player.id] = 0;
  for (const [, playerIds] of Object.entries(result.bench)) {
    for (const playerId of playerIds) counts[playerId] = (counts[playerId] ?? 0) + 1;
  }
  return counts;
}

export interface SyntheticGameSpec {
  date: string;
  innings: number;
  /** Inning -> names of players sitting that inning. */
  benchPlan?: Record<number, string[]>;
  /** Player name -> position code they always occupy when on the field. */
  fixedPositions?: Record<string, string>;
  /** Batting order by player name; defaults to roster order. */
  battingOrder?: string[];
  /** Innings actually played; defaults to `innings`. */
  actualInnings?: number;
  /** Formation to play this game under; defaults to the scenario's formation. */
  formationId?: string;
}

/**
 * Builds a COMPLETED game directly from an explicit plan, so tests can create
 * precise season history (and therefore precise fairness debt) without going
 * through the optimizer.
 */
export function syntheticCompletedGame(
  scenario: Scenario,
  spec: SyntheticGameSpec,
): Game {
  const preset = spec.formationId ? getSystemFormation(spec.formationId) : scenario.formation;
  if (!preset) throw new Error(`Unknown formation ${spec.formationId}`);
  const formation = cloneFormation(preset);
  const positions = [...formation.positions].sort((a, b) => a.sortOrder - b.sortOrder);

  const assignments: DefensiveAssignment[] = [];
  const gameId = `hist_${spec.date}_${formation.id}`;
  let counter = 0;

  for (let inning = 1; inning <= spec.innings; inning++) {
    const sitting = new Set(spec.benchPlan?.[inning] ?? []);
    const onField = scenario.players.filter((player) => !sitting.has(player.firstName));
    if (onField.length !== positions.length) {
      throw new Error(
        `Inning ${inning}: ${onField.length} players on the field but the formation needs ${positions.length}`,
      );
    }

    const remainingPositions = new Set(positions.map((p) => p.code));
    const placement = new Map<string, string>(); // position code -> playerId

    // Honour fixed positions first.
    for (const player of onField) {
      const code = spec.fixedPositions?.[player.firstName];
      if (code && remainingPositions.has(code)) {
        placement.set(code, player.id);
        remainingPositions.delete(code);
      }
    }

    // Rotate the rest so history contains varied positions.
    const flexible = onField.filter(
      (player) => ![...placement.values()].includes(player.id),
    );
    const openCodes = positions
      .map((p) => p.code)
      .filter((code) => remainingPositions.has(code));
    flexible.forEach((player, index) => {
      const code = openCodes[(index + inning) % openCodes.length];
      if (!placement.has(code)) {
        placement.set(code, player.id);
      } else {
        const free = openCodes.find((candidate) => !placement.has(candidate));
        if (free) placement.set(free, player.id);
      }
    });

    for (const position of positions) {
      const playerId = placement.get(position.code);
      if (!playerId) continue;
      assignments.push({
        id: `${gameId}_${counter++}`,
        gameId,
        inning,
        positionId: position.id,
        playerId,
        locked: false,
        assignmentType: 'PLANNED',
      });
    }
  }

  const orderedNames = spec.battingOrder ?? scenario.players.map((p) => p.firstName);
  const battingAssignments = orderedNames.map((name, index) => ({
    gameId,
    playerId: scenario.byName(name).id,
    battingSlot: index + 1,
    locked: false,
  }));

  const game: Game = {
    id: gameId,
    teamId: scenario.team.id,
    opponent: 'History',
    date: spec.date,
    plannedInnings: spec.innings,
    actualInnings: null,
    formationSnapshot: formation,
    status: 'PLANNED',
    settingsSnapshot: { ...scenario.team.settings },
    optimizerVersion: 'test',
    optimizerSeed: 1,
    gamePlayers: scenario.players.map((player) => ({
      playerId: player.id,
      available: true,
    })),
    pitchingPlan: {},
    defensiveAssignments: assignments,
    battingAssignments,
    eligibilityOverrides: [],
    createdAt: `${spec.date}T12:00:00.000Z`,
  };

  return completeGame(game, spec.actualInnings ?? spec.innings);
}

/**
 * Turns a generated game into completed season history, as if the coach
 * recorded `actualInnings` innings of it.
 */
export function completeGame(
  game: Game,
  actualInnings: number,
  edits: Array<{ inning: number; positionId: string; playerId: string }> = [],
): Game {
  const editMap = new Map(
    edits.map((edit) => [`${edit.inning}|${edit.positionId}`, edit.playerId]),
  );
  const actuals: DefensiveAssignment[] = game.defensiveAssignments
    .filter((a) => a.assignmentType === 'PLANNED' && a.inning <= actualInnings)
    .map((assignment, index) => ({
      ...assignment,
      id: `actual_${game.id}_${index}`,
      playerId:
        editMap.get(`${assignment.inning}|${assignment.positionId}`) ?? assignment.playerId,
      assignmentType: 'ACTUAL' as const,
      locked: false,
    }));

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
 * Checks the season-fairness claim at the granularity it actually holds:
 * players who are owed innings receive, on average, at least as many as
 * players who have already had more than their share.
 *
 * A per-player guarantee is deliberately not asserted. Debts accumulated in a
 * single game are small (with 11 players and 10 positions nobody can fall more
 * than half an inning behind), and the spec is explicit that compensation
 * happens across games rather than through rigid per-game equality.
 */
export function compensationDirectionHolds(
  players: Player[],
  debtOf: (playerId: string) => number,
  inningsOf: (playerId: string) => number,
): { owedMean: number; aheadMean: number; holds: boolean } {
  const owed = players.filter((player) => debtOf(player.id) > 0);
  const ahead = players.filter((player) => debtOf(player.id) < 0);

  const mean = (group: Player[]) =>
    group.length === 0
      ? 0
      : group.reduce((acc, player) => acc + inningsOf(player.id), 0) / group.length;

  const owedMean = mean(owed);
  const aheadMean = mean(ahead);

  return {
    owedMean,
    aheadMean,
    holds: owed.length === 0 || ahead.length === 0 || owedMean >= aheadMean,
  };
}
