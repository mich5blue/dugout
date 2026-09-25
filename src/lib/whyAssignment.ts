import type { FairnessDebt } from '@/domain/season';
import type { PositionDefinition } from '@/domain/types';
import { eligibilityFor, ROLE_BLOCKED } from '@/lib/eligibility';
import { UNAVAILABLE, type GameView } from '@/lib/gameView';

/**
 * Why this player is here, this inning.
 *
 * Derived from the saved game rather than from the solver. The optimizer's own
 * `explainLineup` needs a live `SolverContext`, which exists only during
 * generation — so asking "why?" about a lineup loaded from storage would mean
 * re-running the whole search to answer a tap. These reasons are read off the
 * grid, the roster and the season instead.
 *
 * The consequence to be honest about: this explains **what is true of the
 * assignment**, not the search path that produced it. Every line is a fact the
 * coach can check — eligible here, hasn't played here today, two infield
 * innings behind for the season — and none of them claims to be the single
 * cause. A confident-sounding fiction about the optimizer's reasoning would be
 * worse than a short list of true things.
 */

export type ReasonKind =
  | 'LOCKED'
  | 'PITCHING_PLAN'
  | 'ELIGIBILITY'
  | 'PREFERRED'
  | 'VARIETY'
  | 'INFIELD_DEBT'
  | 'SEASON_DEBT'
  | 'SEASON_AHEAD'
  | 'WORKLOAD'
  | 'AVAILABILITY'
  | 'BENCH_ROTATION';

export interface Reason {
  kind: ReasonKind;
  text: string;
  /** True when this is the coach's own decision rather than the engine's. */
  coachSet?: boolean;
}

export interface WhyAssignment {
  /** One-line summary, always present. */
  headline: string;
  reasons: Reason[];
}

function innings(count: number): string {
  return `${count} ${count === 1 ? 'inning' : 'innings'}`;
}

/**
 * Explain the cell at (playerId, inning).
 *
 * `debt` is optional: with no recorded games there is no season to appeal to,
 * and inventing one would be the black box the redesign is trying to open.
 */
export function whyAssignment(
  view: GameView,
  playerId: string,
  inning: number,
  debt?: FairnessDebt,
): WhyAssignment {
  const player = view.playerById.get(playerId);
  const slot = view.slotOf(playerId, inning);
  const reasons: Reason[] = [];

  if (!player) {
    return { headline: 'That player is not on this game’s roster.', reasons };
  }

  const name = view.names.short(playerId);

  if (slot === UNAVAILABLE) {
    return {
      headline: `${name} isn’t available for inning ${inning}.`,
      reasons: [
        {
          kind: 'AVAILABILITY',
          coachSet: true,
          text: 'You marked them as here for only part of the game, so InningGrid expects nothing from them this inning — and they lose no ground in the season for it.',
        },
      ],
    };
  }

  // ---- On the bench ------------------------------------------------------
  if (slot === null) {
    const rested = view.benchInnings(playerId);
    const played = view.defensiveInnings(playerId);
    reasons.push({
      kind: 'BENCH_ROTATION',
      text: `${name} plays ${innings(played)} in this game and rests ${rested}.`,
    });

    const neighbours = [inning - 1, inning + 1]
      .filter((i) => view.innings.includes(i))
      .map((i) => view.slotOf(playerId, i));
    if (neighbours.some((n) => n !== null && n !== UNAVAILABLE)) {
      reasons.push({
        kind: 'BENCH_ROTATION',
        text: 'They are on the field either side of this inning, so the rest is a single inning rather than a stretch.',
      });
    }

    if (debt && debt.defensiveDebt <= -1) {
      reasons.push({
        kind: 'SEASON_AHEAD',
        text: `They are ${Math.abs(debt.defensiveDebt).toFixed(1)} innings ahead of where the season expects them, so they sit before players who are behind.`,
      });
    }

    return { headline: `${name} is resting inning ${inning}.`, reasons };
  }

  // ---- On the field ------------------------------------------------------
  const position: PositionDefinition = slot;
  const assignment = view.assignmentAt(inning, position.id);

  if (assignment?.locked) {
    reasons.push({
      kind: 'LOCKED',
      coachSet: true,
      text: 'You locked this cell, so Rebalance leaves it exactly as it is.',
    });
  }

  const plannedPitcher = view.game.pitchingPlan[inning];
  if (position.role === 'PITCHER' && plannedPitcher === playerId) {
    reasons.push({
      kind: 'PITCHING_PLAN',
      coachSet: true,
      text: `Your pitching plan has ${name} throwing this inning, so the rest of the lineup was built around it.`,
    });
  }

  // Eligibility, in the coach's own words from the roster.
  const eligibility = eligibilityFor(view.game, player, position);
  if (eligibility === 'PREFERRED') {
    reasons.push({
      kind: 'PREFERRED',
      coachSet: true,
      text: `You marked ${position.displayName} as a preferred spot for ${name}.`,
    });
  } else {
    reasons.push({
      kind: 'ELIGIBILITY',
      text: `${name} is eligible at ${position.displayName}.`,
    });
  }

  // Variety within this game: had they been here already?
  const elsewhere = view.innings.filter((i) => {
    if (i === inning) return false;
    const at = view.slotOf(playerId, i);
    return at !== null && at !== UNAVAILABLE && at.id === position.id;
  });
  if (elsewhere.length === 0) {
    reasons.push({
      kind: 'VARIETY',
      text: `This is their only inning at ${position.code} today.`,
    });
  } else {
    reasons.push({
      kind: 'VARIETY',
      text: `They also play ${position.code} in ${
        elsewhere.length === 1 ? `inning ${elsewhere[0]}` : `innings ${elsewhere.join(', ')}`
      }.`,
    });
  }

  // Season pressure, when there is a season to speak of.
  if (debt) {
    if (position.group === 'INFIELD' && debt.infieldDebt >= 0.5) {
      reasons.push({
        kind: 'INFIELD_DEBT',
        text: `${name} is ${debt.infieldDebt.toFixed(1)} infield innings behind for the season, so infield spots go to them first.`,
      });
    }
    if (debt.defensiveDebt >= 1) {
      reasons.push({
        kind: 'SEASON_DEBT',
        text: `They are owed ${debt.defensiveDebt.toFixed(1)} innings from earlier games, which pulls them onto the field ahead of players who are level.`,
      });
    } else if (debt.defensiveDebt <= -1) {
      reasons.push({
        kind: 'SEASON_AHEAD',
        text: `They are ${Math.abs(debt.defensiveDebt).toFixed(1)} innings ahead for the season, so they take fewer of the remaining spots.`,
      });
    }
  }

  // Workload, where the position carries a cap.
  if (position.role === 'PITCHER' || position.role === 'CATCHER') {
    const same = view.innings.filter((i) => {
      const at = view.slotOf(playerId, i);
      return at !== null && at !== UNAVAILABLE && at.role === position.role;
    }).length;
    const cap =
      position.role === 'PITCHER'
        ? (player.maxPitchingInnings ?? view.game.settingsSnapshot.maxPitchingInningsPerPlayer)
        : (player.maxCatchingInnings ??
          view.game.settingsSnapshot.maxCatcherInningsPerPlayer);
    reasons.push({
      kind: 'WORKLOAD',
      text: cap
        ? `${position.role === 'PITCHER' ? 'Pitches' : 'Catches'} ${innings(same)} today, against a limit of ${cap}.`
        : `${position.role === 'PITCHER' ? 'Pitches' : 'Catches'} ${innings(same)} today.`,
    });
  }

  return {
    headline: `${name} plays ${position.displayName} in inning ${inning}.`,
    reasons,
  };
}

/** For the picker: why a position is not offered. */
export function whyNotEligible(
  view: GameView,
  playerId: string,
  position: PositionDefinition,
): string | null {
  const player = view.playerById.get(playerId);
  if (!player) return 'Not on this roster.';

  const eligibility = eligibilityFor(view.game, player, position);
  if (eligibility === ROLE_BLOCKED) {
    return position.role === 'PITCHER'
      ? 'Not marked as able to pitch. Change that on their page.'
      : 'Not marked as able to catch. Change that on their page.';
  }
  if (eligibility === 'NEVER') {
    return `You marked ${position.displayName} as never for this player.`;
  }
  return null;
}
