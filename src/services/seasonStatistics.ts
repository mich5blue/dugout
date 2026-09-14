import {
  emptySeasonUsage,
  type BattingSlotStats,
  type PlayerSeasonUsage,
} from '@/domain/season';
import {
  BENCH_POSITION_ID,
  type DefensiveAssignment,
  type Game,
  type PositionGroup,
} from '@/domain/types';

/**
 * Season aggregation. Every number here comes from what ACTUALLY happened:
 * unplayed innings contribute nothing, and coach edits to a finished game
 * override the generated plan.
 */

/** Innings that count toward the season for this game. */
export function countedInnings(game: Game): number {
  return game.actualInnings ?? game.plannedInnings;
}

/** Games that contribute to season history. */
export function isCountedGame(game: Game): boolean {
  return game.status === 'COMPLETED';
}

/**
 * The assignments that actually happened: ACTUAL rows win over PLANNED rows for
 * the same inning and position, and anything past the innings actually played
 * is dropped.
 */
export function effectiveAssignments(game: Game): DefensiveAssignment[] {
  const limit = countedInnings(game);

  /*
    Fall back to the plan per *inning*, not per cell.

    Per-cell fallback made a correction impossible to record. A coach logging
    that a player sat an inning they were scheduled for removes that ACTUAL
    row, and a per-cell fallback then re-read the PLANNED row for the empty
    cell and credited the inning anyway — so the correction appeared to save
    and changed nothing, which is the worst way for fairness data to be wrong.

    An inning that has been recorded is recorded completely, so its ACTUAL rows
    are the whole truth about it. Innings never recorded still fall back, which
    is what lets a game called early count the innings that were played.
  */
  const recordedInnings = new Set<number>();
  for (const assignment of game.defensiveAssignments) {
    if (assignment.assignmentType === 'ACTUAL') recordedInnings.add(assignment.inning);
  }

  const byCell = new Map<string, DefensiveAssignment>();

  for (const assignment of game.defensiveAssignments) {
    if (assignment.inning > limit) continue;
    if (assignment.positionId === BENCH_POSITION_ID) continue;
    if (assignment.assignmentType === 'PLANNED' && recordedInnings.has(assignment.inning)) {
      continue;
    }
    const key = `${assignment.inning}|${assignment.positionId}`;
    const existing = byCell.get(key);
    if (!existing || (assignment.assignmentType === 'ACTUAL' && existing.assignmentType === 'PLANNED')) {
      byCell.set(key, assignment);
    }
  }

  return [...byCell.values()];
}

export interface GameAvailability {
  playerId: string;
  innings: number;
  available: boolean[];
}

/** Per-player availability within the innings that counted. */
export function gameAvailability(game: Game): GameAvailability[] {
  const limit = countedInnings(game);
  return game.gamePlayers
    .filter((gp) => gp.available)
    .map((gp) => {
      const arrival = gp.arrivalInning ?? 1;
      const departure = Math.min(gp.departureInning ?? limit, limit);
      const available: boolean[] = [];
      for (let inning = 1; inning <= limit; inning++) {
        available.push(inning >= arrival && inning <= departure);
      }
      return {
        playerId: gp.playerId,
        innings: available.filter(Boolean).length,
        available,
      };
    })
    .filter((entry) => entry.innings > 0);
}

export function groupCountsOf(game: Game): Record<PositionGroup, number> {
  const counts: Record<PositionGroup, number> = {
    BATTERY: 0,
    INFIELD: 0,
    OUTFIELD: 0,
    BENCH: 0,
  };
  for (const position of game.formationSnapshot.positions) counts[position.group]++;
  return counts;
}

export function getPlayerSeasonUsage(games: Game[]): Record<string, PlayerSeasonUsage> {
  const usage: Record<string, PlayerSeasonUsage> = {};
  const uniqueCodes = new Map<string, Set<string>>();

  const ordered = [...games]
    .filter(isCountedGame)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

  for (const game of ordered) {
    const limit = countedInnings(game);
    if (limit <= 0) continue;

    const positionsById = new Map(
      game.formationSnapshot.positions.map((p) => [p.id, p]),
    );
    const assignments = effectiveAssignments(game);
    const availability = gameAvailability(game);
    const battingSize = game.battingAssignments.length;

    const ensure = (playerId: string): PlayerSeasonUsage => {
      if (!usage[playerId]) usage[playerId] = emptySeasonUsage(playerId);
      if (!uniqueCodes.has(playerId)) uniqueCodes.set(playerId, new Set());
      return usage[playerId];
    };

    // Defensive innings by player.
    const playedInning = new Map<string, Set<number>>();
    for (const assignment of assignments) {
      const position = positionsById.get(assignment.positionId);
      if (!position) continue;
      const record = ensure(assignment.playerId);

      record.defensiveInnings++;
      record.byGroup[position.group]++;
      record.byPositionCode[position.code] =
        (record.byPositionCode[position.code] ?? 0) + 1;
      uniqueCodes.get(assignment.playerId)!.add(position.code);
      if (position.role === 'PITCHER') record.pitchingInnings++;
      if (position.role === 'CATCHER') record.catchingInnings++;

      const set = playedInning.get(assignment.playerId) ?? new Set<number>();
      set.add(assignment.inning);
      playedInning.set(assignment.playerId, set);
    }

    for (const entry of availability) {
      const record = ensure(entry.playerId);
      record.games++;
      record.availableInnings += entry.innings;

      const played = playedInning.get(entry.playerId) ?? new Set<number>();
      let bench = 0;
      for (let inning = 1; inning <= limit; inning++) {
        if (entry.available[inning - 1] && !played.has(inning)) bench++;
      }
      record.benchInnings += bench;
      record.byGroup.BENCH += bench;

      if (entry.available[0] && !played.has(1)) record.firstInningBenchGames++;
    }

    for (const batting of game.battingAssignments) {
      if (!availability.some((entry) => entry.playerId === batting.playerId)) continue;
      const record = ensure(batting.playerId);
      record.battingHistory.push({
        gameId: game.id,
        slot: batting.battingSlot,
        orderSize: battingSize,
      });
    }
  }

  for (const [playerId, codes] of uniqueCodes) {
    usage[playerId].uniquePositionCodes = codes.size;
  }

  return usage;
}

/** One completed game, from one player's point of view. */
export interface PlayerGameLine {
  gameId: string;
  date: string;
  opponent: string;
  /** Innings actually played in the field. */
  innings: number;
  /** Innings they were available for but sat. */
  benchInnings: number;
  /** Innings that counted in this game, for the whole team. */
  gameInnings: number;
  byGroup: Record<PositionGroup, number>;
}

/**
 * Per-player, per-game playing time.
 *
 * The season totals answer "how much", but not "when". A player can sit on a
 * healthy season average and still have been parked for two games running —
 * which is the thing a parent notices and the coach cannot see in a total.
 * Ordered oldest first, so a strip of these reads left to right as the season.
 */
export function getPlayerGameLog(games: Game[]): Record<string, PlayerGameLine[]> {
  const log: Record<string, PlayerGameLine[]> = {};

  const ordered = [...games]
    .filter(isCountedGame)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

  for (const game of ordered) {
    const limit = countedInnings(game);
    if (limit <= 0) continue;

    const positionsById = new Map(game.formationSnapshot.positions.map((p) => [p.id, p]));
    const playedInning = new Map<string, Set<number>>();
    const groups = new Map<string, Record<PositionGroup, number>>();

    for (const assignment of effectiveAssignments(game)) {
      const position = positionsById.get(assignment.positionId);
      if (!position) continue;
      const set = playedInning.get(assignment.playerId) ?? new Set<number>();
      set.add(assignment.inning);
      playedInning.set(assignment.playerId, set);

      const byGroup =
        groups.get(assignment.playerId) ??
        ({ BATTERY: 0, INFIELD: 0, OUTFIELD: 0, BENCH: 0 } as Record<PositionGroup, number>);
      byGroup[position.group]++;
      groups.set(assignment.playerId, byGroup);
    }

    for (const entry of gameAvailability(game)) {
      const played = playedInning.get(entry.playerId) ?? new Set<number>();
      let bench = 0;
      for (let inning = 1; inning <= limit; inning++) {
        if (entry.available[inning - 1] && !played.has(inning)) bench++;
      }
      const byGroup =
        groups.get(entry.playerId) ??
        ({ BATTERY: 0, INFIELD: 0, OUTFIELD: 0, BENCH: 0 } as Record<PositionGroup, number>);

      log[entry.playerId] ??= [];
      log[entry.playerId].push({
        gameId: game.id,
        date: game.date,
        opponent: game.opponent,
        innings: played.size,
        benchInnings: bench,
        gameInnings: limit,
        byGroup: { ...byGroup, BENCH: bench },
      });
    }
  }

  return log;
}

export function getPositionDistribution(
  games: Game[],
): { codes: Array<{ code: string; displayName: string; group: PositionGroup }>; byPlayer: Record<string, Record<string, number>> } {
  const codeInfo = new Map<string, { code: string; displayName: string; group: PositionGroup; sortOrder: number }>();
  const byPlayer: Record<string, Record<string, number>> = {};

  for (const game of games.filter(isCountedGame)) {
    const positionsById = new Map(game.formationSnapshot.positions.map((p) => [p.id, p]));
    for (const position of game.formationSnapshot.positions) {
      if (!codeInfo.has(position.code)) {
        codeInfo.set(position.code, {
          code: position.code,
          displayName: position.displayName,
          group: position.group,
          sortOrder: position.sortOrder,
        });
      }
    }
    for (const assignment of effectiveAssignments(game)) {
      const position = positionsById.get(assignment.positionId);
      if (!position) continue;
      byPlayer[assignment.playerId] ??= {};
      byPlayer[assignment.playerId][position.code] =
        (byPlayer[assignment.playerId][position.code] ?? 0) + 1;
    }
  }

  const codes = [...codeInfo.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
    .map(({ code, displayName, group }) => ({ code, displayName, group }));

  return { codes, byPlayer };
}

export function getPositionGroupDistribution(
  games: Game[],
): Record<string, Record<PositionGroup, number>> {
  const usage = getPlayerSeasonUsage(games);
  const result: Record<string, Record<PositionGroup, number>> = {};
  for (const [playerId, record] of Object.entries(usage)) {
    result[playerId] = record.byGroup;
  }
  return result;
}

export function getBenchDistribution(games: Game[]): Record<string, number> {
  const usage = getPlayerSeasonUsage(games);
  const result: Record<string, number> = {};
  for (const [playerId, record] of Object.entries(usage)) {
    result[playerId] = record.benchInnings;
  }
  return result;
}

export function getBattingSlotDistribution(
  games: Game[],
): Record<string, BattingSlotStats> {
  const usage = getPlayerSeasonUsage(games);
  const result: Record<string, BattingSlotStats> = {};

  for (const [playerId, record] of Object.entries(usage)) {
    const history = record.battingHistory;
    if (history.length === 0) {
      result[playerId] = {
        averageSlot: null,
        timesFirst: 0,
        timesLast: 0,
        timesTopThird: 0,
        timesMiddleThird: 0,
        timesBottomThird: 0,
        consecutiveGamesBottomThird: 0,
      };
      continue;
    }

    let sum = 0;
    let timesFirst = 0;
    let timesLast = 0;
    let top = 0;
    let middle = 0;
    let bottom = 0;

    for (const entry of history) {
      sum += entry.slot;
      if (entry.slot === 1) timesFirst++;
      if (entry.slot === entry.orderSize) timesLast++;
      const rel = entry.orderSize <= 1 ? 0 : (entry.slot - 1) / (entry.orderSize - 1);
      if (rel < 1 / 3) top++;
      else if (rel < 2 / 3) middle++;
      else bottom++;
    }

    let streak = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];
      const rel = entry.orderSize <= 1 ? 0 : (entry.slot - 1) / (entry.orderSize - 1);
      if (rel >= 2 / 3) streak++;
      else break;
    }

    result[playerId] = {
      averageSlot: sum / history.length,
      timesFirst,
      timesLast,
      timesTopThird: top,
      timesMiddleThird: middle,
      timesBottomThird: bottom,
      consecutiveGamesBottomThird: streak,
    };
  }

  return result;
}
