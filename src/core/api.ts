/**
 * The shared core: InningGrid's domain logic as JSON-in, JSON-out functions.
 *
 * This is the only surface the iOS app calls. It is bundled into a single file
 * (scripts/build_core.mjs) and run inside JavaScriptCore, so the native app
 * builds lineups, records results and computes season fairness with exactly
 * the code the website runs — not a port of it. See docs/ios/architecture.md.
 *
 * Rules for anything added here:
 *
 *  - Arguments and return values must survive JSON. No Maps, Sets, functions
 *    or class instances cross this boundary; they are converted here.
 *  - Mutations take a whole document and return a whole document. The caller
 *    never edits fields itself, so a field the app does not know about is
 *    carried through untouched instead of being dropped on save.
 *  - Nothing here reads a clock, a random source or a global it was not
 *    given, except where a function's own name says so (`createId`). Same
 *    input, same output, on every engine.
 */

import { createGame, createId, createPlayer, playerName, toLastInitial } from '@/domain/factories';
import {
  cloneFormation,
  DEFAULT_FORMATION_BY_SPORT,
  getSystemFormation,
  systemFormationsForSport,
} from '@/domain/formations';
import { PHILOSOPHY_CARDS, RULE_COPY, RULE_GROUP_LABEL, RULE_GROUP_ORDER } from '@/domain/ruleCopy';
import type {
  AssignmentType,
  DevelopmentGoal,
  Formation,
  Game,
  Philosophy,
  Player,
  PriorityFlag,
  Team,
  TeamSettings,
} from '@/domain/types';
import { applyPhilosophy, defaultRuleSettings, defaultTeamSettings } from '@/domain/weights';
import { migratePlayer } from '@/data/migratePlayer';
import { extraInningFor } from '@/lib/gameDayChanges';
import { buildGameView, inningChanges, UNAVAILABLE } from '@/lib/gameView';
import { attendanceFor, nextActionFor } from '@/lib/nextAction';
import { playerNames } from '@/lib/playerNames';
import { awaitingResults, orderedGames, upcomingGames } from '@/lib/schedule';
import { orderGames, orderPlayers, stripAccess } from '@/lib/teamData';
import { whyAssignment } from '@/lib/whyAssignment';
import { cycleEligibility, updatePlayer } from '@/lib/playerEdits';
import { ROLE_PERMISSIONS, type TeamRole } from '@/domain/access';
import {
  getFairnessDebt,
  getTeamSeasonFairness,
  seasonOutlook,
  standingCounts,
  standingFor,
} from '@/services/fairness';
import {
  advanceInning,
  batterQueue,
  nextBatter,
  previousBatter,
  previousInning,
  startGame,
} from '@/services/liveGame';
import {
  clearGeneratedLineup,
  generateLineupSync,
  recordActualResults,
  regenerateBattingOrder,
  setAssignment,
  setAvailability,
  setBattingOrder,
  setBattingSlotLocked,
  setPitchingPlan,
  toggleLock,
} from '@/services/lineupService';
import {
  getPlayerGameLog,
  getPlayerSeasonUsage,
  getPositionDistribution,
} from '@/services/seasonStatistics';

/** Bumped whenever a function's contract changes, so the app can refuse a stale bundle. */
export const CORE_VERSION = 1;

// ---------------------------------------------------------------------------
// The lineup, as something a screen can draw
// ---------------------------------------------------------------------------

export interface CellJSON {
  playerId: string;
  locked: boolean;
  assignmentType: AssignmentType;
}

export interface SlotJSON {
  state: 'FIELD' | 'REST' | 'OUT';
  positionId?: string;
  code?: string;
  group?: string;
  locked?: boolean;
}

export interface LineupViewJSON {
  positions: Game['formationSnapshot']['positions'];
  innings: number[];
  /** Players on this game's roster, in roster order. */
  playerIds: string[];
  /** inning → positionId → who is there. */
  cells: Record<string, Record<string, CellJSON>>;
  /** playerId → inning → where they are. */
  byPlayer: Record<string, Record<string, SlotJSON>>;
  /** inning → playerIds resting. */
  bench: Record<string, string[]>;
  defensiveInnings: Record<string, number>;
  benchInnings: Record<string, number>;
  battingOrder: Array<{ playerId: string; slot: number; locked: boolean }>;
  names: Record<string, { short: string; full: string; plain: string }>;
  hasLineup: boolean;
  /** The pitching plan's pinned innings: inning → playerId. */
  pitchingPlan: Record<string, string>;
}

/**
 * Everything a lineup screen needs, flattened.
 *
 * `GameView` is closures over Maps, which cannot cross into Swift. This walks
 * it once and writes down every answer, so the native screens draw from plain
 * data and never re-derive a rule the web already encodes.
 */
export function lineupView(
  game: Game,
  players: Player[],
  type: AssignmentType = game.status === 'COMPLETED' ? 'ACTUAL' : 'PLANNED',
): LineupViewJSON {
  const view = buildGameView(game, players, type);

  const cells: LineupViewJSON['cells'] = {};
  const bench: LineupViewJSON['bench'] = {};
  for (const inning of view.innings) {
    const row: Record<string, CellJSON> = {};
    for (const position of view.positions) {
      const assignment = view.assignmentAt(inning, position.id);
      if (assignment) {
        row[position.id] = {
          playerId: assignment.playerId,
          locked: assignment.locked,
          assignmentType: assignment.assignmentType,
        };
      }
    }
    cells[inning] = row;
    bench[inning] = view.benchAt(inning).map((player) => player.id);
  }

  const byPlayer: LineupViewJSON['byPlayer'] = {};
  const defensiveInnings: Record<string, number> = {};
  const benchInnings: Record<string, number> = {};
  const names: LineupViewJSON['names'] = {};

  for (const player of view.players) {
    const row: Record<string, SlotJSON> = {};
    for (const inning of view.innings) {
      const slot = view.slotOf(player.id, inning);
      if (slot === UNAVAILABLE) row[inning] = { state: 'OUT' };
      else if (slot === null) row[inning] = { state: 'REST' };
      else
        row[inning] = {
          state: 'FIELD',
          positionId: slot.id,
          code: slot.code,
          group: slot.group,
          locked: view.assignmentAt(inning, slot.id)?.locked ?? false,
        };
    }
    byPlayer[player.id] = row;
    defensiveInnings[player.id] = view.defensiveInnings(player.id);
    benchInnings[player.id] = view.benchInnings(player.id);
    names[player.id] = {
      short: view.names.short(player.id),
      full: view.names.full(player.id),
      plain: view.names.plain(player.id),
    };
  }

  return {
    positions: view.positions,
    innings: view.innings,
    playerIds: view.players.map((player) => player.id),
    cells,
    byPlayer,
    bench,
    defensiveInnings,
    benchInnings,
    battingOrder: view.battingOrder().map((entry) => ({
      playerId: entry.player.id,
      slot: entry.slot,
      locked: entry.locked,
    })),
    names,
    hasLineup: view.hasLineup,
    pitchingPlan: Object.fromEntries(
      Object.entries(game.pitchingPlan).map(([inning, playerId]) => [String(inning), playerId]),
    ),
  };
}

// ---------------------------------------------------------------------------
// The season, in one call
// ---------------------------------------------------------------------------

/**
 * Everything Home and Season show, computed once.
 *
 * One call rather than seven because each of these walks the whole season,
 * and the bridge has a per-call cost; it also guarantees Home and Season can
 * never disagree about the same team at the same moment.
 */
export function seasonSummary(games: Game[], players: Player[]) {
  const debts = getFairnessDebt(games, players);
  const fairness = getTeamSeasonFairness(games, players);
  const distribution = getPositionDistribution(games);
  return {
    usage: getPlayerSeasonUsage(games),
    debts,
    standings: standingCounts(players, debts),
    standingByPlayer: Object.fromEntries(
      players.map((player) => [player.id, standingFor(debts[player.id]?.defensiveDebt ?? 0)]),
    ),
    fairness,
    outlook: seasonOutlook(games, players, debts),
    positionCodes: distribution.codes,
    positionsByPlayer: distribution.byPlayer,
    gameLog: getPlayerGameLog(games),
  };
}

/** A custom formation by id, else the system preset with that id. */
function findFormation(formations: Formation[], id: string): Formation | undefined {
  return formations.find((entry) => entry.id === id) ?? getSystemFormation(id);
}

// ---------------------------------------------------------------------------
// The API object
// ---------------------------------------------------------------------------

/**
 * Exposed as `globalThis.InningGridCore`.
 *
 * Every member is a plain function. The bridge in Swift calls them by name
 * with JSON-encoded arguments, so renaming one here is a breaking change for
 * the app — bump CORE_VERSION when a signature changes.
 */
export const InningGridCore = {
  version: CORE_VERSION,

  // ---- reading -----------------------------------------------------------
  /**
   * Turn a team's stored documents into exactly what the website hands the
   * engine: access fields stripped from the team, players migrated and in
   * creation order, games newest first. Call this before anything that takes
   * a roster — the optimizer breaks ties by roster order, so an app that
   * ordered the same players differently could build a different lineup.
   */
  prepareTeam: (teamDocument: Record<string, unknown>, players: Player[], games: Game[]) => {
    const team = stripAccess(teamDocument);
    return {
      team,
      players: orderPlayers(players, team.id),
      games: orderGames(games, team.id),
    };
  },
  /** Normalise a stored player (legacy surname → initial), as the web does on read. */
  migratePlayer: (raw: unknown) => migratePlayer(raw as Parameters<typeof migratePlayer>[0]),
  lineupView,
  seasonSummary,
  playerNames: (players: Player[]) => {
    const names = playerNames(players);
    return Object.fromEntries(
      players.map((player) => [
        player.id,
        { short: names.short(player.id), full: names.full(player.id), plain: names.plain(player.id) },
      ]),
    );
  },
  playerName: (player: Player) => playerName(player),

  // ---- who may do what ---------------------------------------------------
  /* The same table the website reads. Showing a control is a courtesy — the
     Firestore rules are what actually refuse an edit. */
  permissions: (role: TeamRole) => [...(ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.ASSISTANT)],
  updatePlayer: (player: Player, role: TeamRole, changes: Partial<Player>) =>
    updatePlayer(player, role, changes),
  cycleEligibility: (player: Player, role: TeamRole, positionId: string) =>
    cycleEligibility(player, role, positionId),

  // ---- schedule ----------------------------------------------------------
  orderedGames: (games: Game[]) => orderedGames(games).map((game) => game.id),
  /* `today` is passed in, never read here: the device knows the coach's local
     date, and a bundle reading its own clock would make these untestable. */
  upcomingGames: (games: Game[], todayIso: string) =>
    upcomingGames(games, todayIso).map((game) => game.id),
  awaitingResults: (games: Game[], todayIso: string) =>
    awaitingResults(games, todayIso).map((game) => game.id),
  /* Noon on the given day, so no timezone shift can move it across midnight. */
  nextAction: (game: Game, todayIso: string) =>
    nextActionFor(game, new Date(`${todayIso}T12:00:00`)),
  attendance: (game: Game) => attendanceFor(game),

  // ---- creating ----------------------------------------------------------
  createId: (prefix: string) => createId(prefix),
  createGame: (options: Parameters<typeof createGame>[0]) => createGame(options),
  /** The team's default formation: its own custom one, else the system one. */
  teamFormation: (team: Team, formations: Formation[]) =>
    findFormation(formations, team.defaultFormationId) ?? null,
  /**
   * A new game the way the website's New Game page makes one: the team's own
   * formation if it has a custom one by that id, otherwise the system one, and
   * the team's settings snapshotted onto the game.
   */
  newGame: (
    team: Team,
    players: Player[],
    formations: Formation[],
    options: { opponent: string; date: string; plannedInnings?: number; formationId?: string; seed?: number },
  ) => {
    const formationId = options.formationId ?? team.defaultFormationId;
    const formation = findFormation(formations, formationId);
    if (!formation) throw new Error(`Unknown formation ${formationId}`);
    return createGame({
      teamId: team.id,
      opponent: options.opponent,
      date: options.date,
      plannedInnings: options.plannedInnings ?? team.defaultInnings,
      formation,
      settings: team.settings,
      players,
      seed: options.seed,
    });
  },
  createPlayer: (options: Parameters<typeof createPlayer>[0]) => createPlayer(options),
  toLastInitial: (value: string) => toLastInitial(value) ?? null,
  defaultTeamSettings: () => defaultTeamSettings(),
  defaultRuleSettings: () => defaultRuleSettings(),
  applyPhilosophy: (settings: TeamSettings, philosophy: Philosophy) =>
    applyPhilosophy(settings, philosophy),
  systemFormations: (sport: Team['sport']) => systemFormationsForSport(sport),
  systemFormation: (id: string) => getSystemFormation(id) ?? null,
  defaultFormationId: (sport: Team['sport']) => DEFAULT_FORMATION_BY_SPORT[sport],
  cloneFormation: (formation: Formation) => cloneFormation(formation),

  // ---- the lineup --------------------------------------------------------
  /**
   * Build a lineup. Synchronous on purpose: JavaScriptCore does not run promise
   * callbacks when control returns to Swift, so an awaited generate would
   * never finish in the app. Returns the engine's full result — quality,
   * checks, explanations, conflicts and one-tap relaxations — alongside the
   * updated game.
   */
  generate: (options: {
    team: Team;
    game: Game;
    players: Player[];
    history: Game[];
    goals?: DevelopmentGoal[];
    flags?: PriorityFlag[];
    seed?: number;
    frozenInnings?: number;
  }) => generateLineupSync(options),
  regenerateBattingOrder: (options: Parameters<typeof regenerateBattingOrder>[0]) =>
    regenerateBattingOrder(options),
  setAssignment: (
    game: Game,
    inning: number,
    positionId: string,
    playerId: string | null,
    type: AssignmentType = 'PLANNED',
  ) => setAssignment(game, inning, positionId, playerId, type),
  toggleLock: (game: Game, inning: number, positionId: string) =>
    toggleLock(game, inning, positionId),
  setAvailability: (
    game: Game,
    playerId: string,
    changes: Parameters<typeof setAvailability>[2],
  ) => setAvailability(game, playerId, changes),
  setPitchingPlan: (game: Game, inning: number, playerId: string | null) =>
    setPitchingPlan(game, inning, playerId),
  setBattingOrder: (game: Game, order: Parameters<typeof setBattingOrder>[1]) =>
    setBattingOrder(game, order),
  setBattingSlotLocked: (game: Game, playerId: string, locked: boolean) =>
    setBattingSlotLocked(game, playerId, locked),
  clearGeneratedLineup: (game: Game) => clearGeneratedLineup(game),
  whyAssignment: (game: Game, players: Player[], playerId: string, inning: number, games: Game[]) => {
    const view = buildGameView(
      game,
      players,
      game.status === 'COMPLETED' ? 'ACTUAL' : 'PLANNED',
    );
    return whyAssignment(view, playerId, inning, getFairnessDebt(games, players)[playerId]);
  },

  // ---- game day ----------------------------------------------------------
  startGame: (game: Game, nowIso: string) => startGame(game, new Date(nowIso)),
  advanceInning: (game: Game) => advanceInning(game),
  previousInning: (game: Game) => previousInning(game),
  nextBatter: (game: Game) => nextBatter(game),
  previousBatter: (game: Game) => previousBatter(game),
  batterQueue: (game: Game, count = 3) => batterQueue(game, count),
  inningChanges: (game: Game, players: Player[], from: number, to: number) =>
    inningChanges(buildGameView(game, players), from, to),
  extraInning: (game: Game, players: Player[], inning: number) =>
    extraInningFor(buildGameView(game, players), inning),
  recordActualResults: (game: Game, actualInnings: number) =>
    recordActualResults(game, actualInnings),

  // ---- words -------------------------------------------------------------
  /** The plain-English rule copy, so the app and the website say the same thing. */
  ruleCopy: () => ({
    rules: RULE_COPY,
    groups: RULE_GROUP_ORDER.map((group) => ({ group, label: RULE_GROUP_LABEL[group] })),
    philosophies: PHILOSOPHY_CARDS,
  }),
};

export type InningGridCoreApi = typeof InningGridCore;
