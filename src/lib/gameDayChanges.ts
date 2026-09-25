import { playerShortName } from '@/domain/factories';
import type { Game, Player, PositionDefinition } from '@/domain/types';
import { canPlay } from '@/lib/eligibility';
import { UNAVAILABLE, type GameView } from '@/lib/gameView';

/**
 * The two things that actually change during a youth game.
 *
 * A pitcher gets through an inning on ten pitches and can go again, or a
 * player has to come out. Both are decided at the fence with a live ball, so
 * the job of this module is to work out the whole consequence *before* the
 * coach commits to anything — the surfaces then state it in one sentence
 * rather than making them reason about a grid.
 *
 * Pure functions over a GameView. Nothing here writes; the callers hand the
 * result to lineupService.
 */

/**
 * The position the pitching plan and the solver both treat as "the pitcher":
 * the first PITCHER-role position in the formation's own order.
 */
export function primaryPitcherPosition(view: GameView): PositionDefinition | undefined {
  return view.positions.find((position) => position.role === 'PITCHER');
}

/** Planned innings this player is down to pitch, across the whole game. */
export function plannedPitchingInnings(view: GameView, playerId: string): number {
  const pitcherPositions = new Set(
    view.positions.filter((p) => p.role === 'PITCHER').map((p) => p.id),
  );
  return view.innings.reduce((total, inning) => {
    const slot = view.slotOf(playerId, inning);
    if (slot === UNAVAILABLE || slot === null) return total;
    return pitcherPositions.has(slot.id) ? total + 1 : total;
  }, 0);
}

/** The pitching cap that applies to this player in this game, if any. */
export function pitchingCap(game: Game, player: Player): number | undefined {
  const caps = [
    game.gamePlayers.find((gp) => gp.playerId === player.id)?.maxPitchingInnings,
    player.maxPitchingInnings,
    game.settingsSnapshot.maxPitchingInningsPerPlayer,
  ].filter((value): value is number => typeof value === 'number');
  return caps.length > 0 ? Math.min(...caps) : undefined;
}

/**
 * What happens if the pitcher of `inning` stays on for the next one.
 *
 * The swap is a straight exchange: the pitcher holds the mound, and whoever
 * was down to pitch next takes the spot the pitcher was going to play. That is
 * exactly what `setAssignment` does when a player already has an assignment in
 * the target inning, so the preview here and the write there cannot disagree.
 *
 * Returns null when the question does not arise — last inning, no pitcher, or
 * the same player is already down to pitch both innings.
 */
export interface ExtraInning {
  inning: number;
  nextInning: number;
  pitcherPositionId: string;
  pitcher: Player;
  /** Whoever was down to pitch the next inning, if anyone. */
  displaced?: Player;
  /** Where the pitcher was going to play next inning; undefined means bench. */
  pitcherNextPosition?: PositionDefinition;
  /** One sentence naming the consequence, for a button or a printed note. */
  summary: string;
  /** Set when the swap is legal but worth flagging. */
  warning?: string;
  /** Set when the swap should not be offered at all. */
  blocked?: string;
}

export function extraInningFor(view: GameView, inning: number): ExtraInning | null {
  const position = primaryPitcherPosition(view);
  if (!position) return null;

  const nextInning = inning + 1;
  if (nextInning > view.innings.length) return null;

  const pitcher = view.playerAt(inning, position.id);
  if (!pitcher) return null;

  const nextPitcher = view.playerAt(nextInning, position.id);
  if (nextPitcher && nextPitcher.id === pitcher.id) return null;

  const pitcherNextSlot = view.slotOf(pitcher.id, nextInning);
  const pitcherNextPosition = pitcherNextSlot === UNAVAILABLE || pitcherNextSlot === null
    ? undefined
    : pitcherNextSlot;

  const base: ExtraInning = {
    inning,
    nextInning,
    pitcherPositionId: position.id,
    pitcher,
    displaced: nextPitcher,
    pitcherNextPosition,
    summary: '',
  };

  // A pitcher who has gone home cannot stay on.
  if (pitcherNextSlot === UNAVAILABLE) {
    return {
      ...base,
      summary: `${playerShortName(pitcher)} is not available in inning ${nextInning}`,
      blocked: `${playerShortName(pitcher)} is not available in inning ${nextInning}.`,
    };
  }

  /*
    Both sides of the swap, in one sentence.

    It used to name only the displaced player — "Emerson moves to 3B" — which
    is the half a coach already suspects. What they are deciding is what it
    costs, and that is two facts: their pitcher stays on, and somebody else
    goes somewhere they were not going.
  */
  const where = pitcherNextPosition ? pitcherNextPosition.code : 'a rest';
  const summary = nextPitcher
    ? `${playerShortName(pitcher)} pitches inning ${nextInning} too. ${playerShortName(nextPitcher)}, who was down to pitch it, takes ${
        pitcherNextPosition ? `${where} instead` : 'a rest instead'
      }.`
    : `${playerShortName(pitcher)} stays on the mound for inning ${nextInning}.`;

  // Does the displaced pitcher's new spot actually work for them?
  let warning: string | undefined;
  if (nextPitcher && pitcherNextPosition) {
    if (!canPlay(view.game, nextPitcher, pitcherNextPosition)) {
      warning = `${playerShortName(nextPitcher)} is not normally played at ${pitcherNextPosition.code}.`;
    }
  } else if (nextPitcher && !pitcherNextPosition) {
    warning = `${playerShortName(nextPitcher)} would sit inning ${nextInning}.`;
  }

  // Pitching caps are the usual reason a coach cannot do this, so say so
  // rather than letting them find out from a conflict list afterwards.
  const cap = pitchingCap(view.game, pitcher);
  if (cap !== undefined) {
    const planned = plannedPitchingInnings(view, pitcher.id);
    if (planned + 1 > cap) {
      return {
        ...base,
        summary,
        blocked: `${playerShortName(pitcher)} is capped at ${cap} ${cap === 1 ? 'inning' : 'innings'} of pitching.`,
      };
    }
  }

  return { ...base, summary, warning };
}

/** Every inning where the "goes another inning" question could come up. */
export function extraInningPlan(view: GameView): ExtraInning[] {
  return view.innings
    .map((inning) => extraInningFor(view, inning))
    .filter((entry): entry is ExtraInning => entry !== null && !entry.blocked);
}
