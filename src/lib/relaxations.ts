import { cloneFormation, systemFormationsForSport } from '@/domain/formations';
import type { Formation, Game, Team } from '@/domain/types';
import type { RelaxationSuggestion } from '@/optimizer';

/**
 * Apply one of the optimizer's "this would make it work" suggestions to a game.
 *
 * Shared by the website's builder and the native app, so the one-tap fix does
 * the same thing on both. Every change lands on this game only — its settings
 * snapshot, its overrides or its formation snapshot — never the team default,
 * because what works today says nothing about next week.
 *
 * Returns null when the suggestion has no action this can carry out.
 */
export function applyRelaxation(
  game: Game,
  team: Team,
  formations: Formation[],
  suggestion: Pick<RelaxationSuggestion, 'action'>,
): Game | null {
  const action = suggestion.action;
  if (!action) return null;
  const settings = { ...game.settingsSnapshot };

  switch (action.type) {
    case 'REDUCE_MIN_DEFENSIVE_INNINGS':
      settings.minDefensiveInnings = action.to;
      break;
    case 'RELAX_INFIELD_REQUIREMENT':
      settings.infieldOpportunity = { mode: 'TARGET', innings: action.to };
      break;
    case 'ALLOW_CONSECUTIVE_BENCH':
      settings.noConsecutiveBench = false;
      break;
    case 'RAISE_PITCHING_CAP':
      settings.maxPitchingInningsPerPlayer = action.to;
      break;
    case 'RAISE_CATCHING_CAP':
      settings.maxCatcherInningsPerPlayer = action.to;
      break;
    case 'ALLOW_POSITION':
      return {
        ...game,
        eligibilityOverrides: [
          ...game.eligibilityOverrides,
          { playerId: action.playerId, positionId: action.positionId },
        ],
      };
    case 'USE_SMALLER_FORMATION': {
      /* The largest formation that fits, from the team's own set plus the
         system presets for its sport. */
      const fit = [
        ...systemFormationsForSport(team.sport),
        ...formations.filter((entry) => entry.teamId === team.id && entry.sport === team.sport),
      ]
        .filter((entry) => entry.positions.length <= action.positions)
        .sort((a, b) => b.positions.length - a.positions.length)[0];
      return fit ? { ...game, formationSnapshot: cloneFormation(fit) } : null;
    }
    default:
      return null;
  }
  return { ...game, settingsSnapshot: settings };
}
