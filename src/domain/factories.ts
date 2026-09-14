import { cloneFormation, DEFAULT_FORMATION_BY_SPORT } from './formations';
import type {
  AbilityTier,
  Formation,
  Game,
  GamePlayer,
  Player,
  Sport,
  Team,
  TeamSettings,
} from './types';
import { defaultTeamSettings } from './weights';

export function createId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${random}`;
}

export interface CreateTeamOptions {
  name: string;
  sport: Sport;
  division?: string;
  seasonName?: string;
  defaultInnings?: number;
  defaultFormationId?: string;
  settings?: Partial<TeamSettings>;
}

export function createTeam(options: CreateTeamOptions): Team {
  return {
    id: createId('team'),
    name: options.name.trim(),
    sport: options.sport,
    seasonName: options.seasonName?.trim() || `${new Date().getFullYear()} Season`,
    division: options.division?.trim() || '',
    defaultInnings: options.defaultInnings ?? 6,
    defaultFormationId: options.defaultFormationId ?? DEFAULT_FORMATION_BY_SPORT[options.sport],
    settings: { ...defaultTeamSettings(), ...options.settings },
    createdAt: new Date().toISOString(),
  };
}

export interface CreatePlayerOptions {
  teamId: string;
  firstName: string;
  lastInitial?: string;
  jerseyNumber?: string;
  overallTier?: AbilityTier;
  offensiveTier?: AbilityTier;
  canPitch?: boolean;
  canCatch?: boolean;
  createdAt?: string;
}

export function createPlayer(options: CreatePlayerOptions): Player {
  return {
    id: createId('plr'),
    teamId: options.teamId,
    firstName: options.firstName.trim(),
    lastInitial: toLastInitial(options.lastInitial),
    jerseyNumber: options.jerseyNumber?.trim() || undefined,
    active: true,
    overallTier: options.overallTier ?? 'REGULAR',
    offensiveTier: options.offensiveTier ?? 'REGULAR',
    // Defaults are ALLOWED everywhere, so a coach only configures exceptions.
    positionRatings: {},
    canPitch: options.canPitch ?? false,
    canCatch: options.canCatch ?? false,
    preferredPitcher: false,
    preferredCatcher: false,
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
}

/**
 * Quick Add: one player per line. Accepts "First Last", "First Last #12",
 * "12 First Last" and "First Last, 12".
 */
export function parseQuickAddRoster(
  text: string,
  teamId: string,
): Array<CreatePlayerOptions & { teamId: string }> {
  const results: Array<CreatePlayerOptions & { teamId: string }> = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let jerseyNumber: string | undefined;
    let remainder = line;

    // Trailing "#12" or ", 12" or " 12"
    const trailing = remainder.match(/[\s,]+#?(\d{1,3})$/);
    if (trailing) {
      jerseyNumber = trailing[1];
      remainder = remainder.slice(0, trailing.index).trim();
    } else {
      // Leading "12 First Last"
      const leading = remainder.match(/^#?(\d{1,3})[\s,]+/);
      if (leading) {
        jerseyNumber = leading[1];
        remainder = remainder.slice(leading[0].length).trim();
      }
    }

    remainder = remainder.replace(/[,]+$/, '').trim();
    if (!remainder) continue;

    const parts = remainder.split(/\s+/);
    const firstName = parts[0];
    /* A pasted line usually carries a full surname. Only its initial is kept —
       see the note on Player.lastInitial. */
    const lastInitial = toLastInitial(parts.slice(1).join(' '));

    results.push({ teamId, firstName, lastInitial, jerseyNumber });
  }

  return results;
}

export interface CreateGameOptions {
  teamId: string;
  opponent: string;
  date: string;
  plannedInnings: number;
  formation: Formation;
  settings: TeamSettings;
  players: Player[];
  seed?: number;
}

export function createGame(options: CreateGameOptions): Game {
  const gamePlayers: GamePlayer[] = options.players
    .filter((player) => player.active)
    .map((player) => ({ playerId: player.id, available: true }));

  return {
    id: createId('game'),
    teamId: options.teamId,
    opponent: options.opponent.trim(),
    date: options.date,
    plannedInnings: options.plannedInnings,
    actualInnings: null,
    // Snapshot so history never changes when team settings later change.
    formationSnapshot: cloneFormation(options.formation),
    status: 'PLANNED',
    settingsSnapshot: { ...options.settings },
    optimizerVersion: '',
    optimizerSeed: options.seed ?? 1,
    gamePlayers,
    pitchingPlan: {},
    defensiveAssignments: [],
    battingAssignments: [],
    eligibilityOverrides: [],
    createdAt: new Date().toISOString(),
  };
}

/**
 * Narrows whatever was typed or pasted to a single last initial.
 *
 * One character, not a few. A pasted "Brody Borek" reduced to "Bo" is both
 * odd to read and more identifying than it needs to be, and two letters of a
 * surname is the beginning of a surname — which is the one thing this field
 * must not hold. See the note on Player.lastInitial.
 *
 * A leading "." or a typed "B." both land on "B".
 */
export function toLastInitial(value: string | undefined): string | undefined {
  const letter = (value ?? '').trim().replace(/^[^\p{L}\p{N}]+/u, '').charAt(0);
  return letter === '' ? undefined : letter.toUpperCase();
}

/**
 * Name for a single player, with no knowledge of the rest of the roster.
 *
 * Use `playerNames(roster)` from lib/playerNames wherever two players could
 * share a first name — it disambiguates with the jersey number. These two are
 * for the cases where there is genuinely only one player in view.
 */
export function playerName(
  player: Pick<Player, 'firstName' | 'lastInitial'>,
): string {
  const initial = (player.lastInitial ?? '').trim();
  return `${player.firstName} ${initial === '' ? '' : `${initial}.`}`.trim();
}

export function playerShortName(
  player: Pick<Player, 'firstName' | 'lastInitial'>,
): string {
  return player.firstName.trim() || (player.lastInitial ?? '');
}
