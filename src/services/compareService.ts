import type { Game, Philosophy, Player, TeamSettings } from '@/domain/types';
import { PHILOSOPHY_DESCRIPTION, PHILOSOPHY_LABEL, applyPhilosophy } from '@/domain/weights';
import type { OptimizationResult } from '@/optimizer';
import { generateLineup, type GenerateOptions } from './lineupService';

/**
 * Three-lineup comparison (spec section 46).
 *
 * Generates the same game three ways so the coach can see the trade-off
 * instead of having to imagine it. Every approach uses the identical seed,
 * roster, availability, locks and pitching plan, so any difference between
 * them is attributable to the coaching philosophy and nothing else.
 *
 * The coach's own hard rules carry across all three. A required minimum of
 * four innings stays required under Competitive — the approaches differ in
 * what they optimize for, never in what the coach said was non-negotiable.
 */

export const COMPARED_APPROACHES: Philosophy[] = [
  'EQUAL_PLAYING_TIME',
  'BALANCED',
  'COMPETITIVE',
];

export interface ApproachOutcome {
  philosophy: Philosophy;
  label: string;
  description: string;
  settings: TeamSettings;
  result: OptimizationResult;
  /** The game with this approach's lineup applied, ready to save. */
  game: Game;
  /** Fewest and most defensive innings any player receives. */
  minInnings: number;
  maxInnings: number;
  /** Players who never leave the field, and players who sit the most. */
  mostBenched: Array<{ playerId: string; innings: number }>;
}

export interface ComparisonMetric {
  key: string;
  label: string;
  /** 0..1 per approach, keyed by philosophy. */
  values: Partial<Record<Philosophy, number>>;
}

export interface Comparison {
  approaches: ApproachOutcome[];
  /** The metrics every approach reported, aligned for side-by-side reading. */
  metrics: ComparisonMetric[];
}

/** Metrics worth comparing, in the order a coach cares about them. */
const COMPARED_METRICS = [
  'playingTime',
  'positionVariety',
  'infieldOpportunity',
  'defensiveStrength',
] as const;

export async function compareApproaches(
  options: Omit<GenerateOptions, 'seed'> & { seed?: number },
): Promise<Comparison> {
  const seed = options.seed ?? options.game.optimizerSeed;
  const baseSettings = options.game.settingsSnapshot;

  const approaches: ApproachOutcome[] = [];

  for (const philosophy of COMPARED_APPROACHES) {
    const settings = applyPhilosophy(baseSettings, philosophy);

    const { result, game } = await generateLineup({
      ...options,
      seed,
      game: { ...options.game, settingsSnapshot: settings },
    });

    const innings = new Map<string, number>();
    for (const gamePlayer of options.game.gamePlayers) {
      if (gamePlayer.available) innings.set(gamePlayer.playerId, 0);
    }
    for (const assignment of result.defensive) {
      innings.set(assignment.playerId, (innings.get(assignment.playerId) ?? 0) + 1);
    }

    const counts = [...innings.values()];
    const benchCounts = [...innings.entries()]
      .map(([playerId, played]) => ({ playerId, innings: played }))
      .sort((a, b) => a.innings - b.innings);

    approaches.push({
      philosophy,
      label: PHILOSOPHY_LABEL[philosophy],
      description: PHILOSOPHY_DESCRIPTION[philosophy],
      settings,
      result,
      game,
      minInnings: counts.length > 0 ? Math.min(...counts) : 0,
      maxInnings: counts.length > 0 ? Math.max(...counts) : 0,
      mostBenched: benchCounts.slice(0, 2),
    });
  }

  const metrics: ComparisonMetric[] = COMPARED_METRICS.flatMap((key) => {
    const values: Partial<Record<Philosophy, number>> = {};
    let label: string = key;

    for (const approach of approaches) {
      const metric = approach.result.quality.metrics.find((entry) => entry.key === key);
      if (!metric) continue;
      values[approach.philosophy] = metric.value;
      label = metric.label;
    }

    if (Object.keys(values).length === 0) return [];
    return [{ key, label, values }];
  });

  return { approaches, metrics };
}

/**
 * Which approach differs most from the others, described in one sentence a
 * coach can act on.
 */
export function describeTradeoff(
  comparison: Comparison,
  players: Player[],
): string | null {
  const fair = comparison.approaches.find((a) => a.philosophy === 'EQUAL_PLAYING_TIME');
  const competitive = comparison.approaches.find((a) => a.philosophy === 'COMPETITIVE');
  if (!fair || !competitive) return null;

  const strengthOf = (approach: ApproachOutcome) =>
    approach.result.quality.metrics.find((m) => m.key === 'defensiveStrength')?.value ?? 0;

  const strengthGain = strengthOf(competitive) - strengthOf(fair);
  const inningsCost =
    fair.maxInnings - fair.minInnings === competitive.maxInnings - competitive.minInnings
      ? 0
      : competitive.maxInnings - competitive.minInnings - (fair.maxInnings - fair.minInnings);

  if (strengthGain <= 0.02 && inningsCost <= 0) {
    return 'Your roster is deep enough that playing everyone evenly costs you almost nothing defensively.';
  }

  const shorted = competitive.mostBenched[0];
  const player = players.find((entry) => entry.id === shorted?.playerId);
  const name = player ? `${player.firstName} ${player.lastName}`.trim() : null;

  const strengthText = `${Math.round(strengthGain * 100)}% more defensive strength`;
  if (inningsCost > 0 && name) {
    return `Competitive buys ${strengthText}, and costs ${name} ${inningsCost} ${
      inningsCost === 1 ? 'inning' : 'innings'
    } of playing time.`;
  }
  return `Competitive buys ${strengthText} at the same spread of playing time.`;
}
