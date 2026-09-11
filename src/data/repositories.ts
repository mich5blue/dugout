import type { TeamMembership } from '@/domain/access';
import type {
  DevelopmentGoal,
  Formation,
  Game,
  Player,
  PriorityFlag,
  Team,
} from '@/domain/types';

/**
 * Storage contracts. Domain services depend only on these interfaces, so the
 * MVP's browser-local store can be replaced with a Postgres-backed
 * implementation without touching any domain or UI logic.
 */

export interface TeamRepository {
  list(): Promise<Team[]>;
  get(id: string): Promise<Team | null>;
  save(team: Team): Promise<Team>;
  remove(id: string): Promise<void>;
}

export interface PlayerRepository {
  listByTeam(teamId: string): Promise<Player[]>;
  get(id: string): Promise<Player | null>;
  save(player: Player): Promise<Player>;
  saveMany(players: Player[]): Promise<Player[]>;
  remove(id: string): Promise<void>;
}

export interface FormationRepository {
  /** System presets for the sport plus any custom formations for the team. */
  listForTeam(teamId: string, sport: Team['sport']): Promise<Formation[]>;
  get(id: string): Promise<Formation | null>;
  save(formation: Formation): Promise<Formation>;
  remove(id: string): Promise<void>;
}

export interface GameRepository {
  listByTeam(teamId: string): Promise<Game[]>;
  get(id: string): Promise<Game | null>;
  save(game: Game): Promise<Game>;
  remove(id: string): Promise<void>;
}

export interface DevelopmentGoalRepository {
  listByTeam(teamId: string): Promise<DevelopmentGoal[]>;
  save(goal: DevelopmentGoal): Promise<DevelopmentGoal>;
  remove(id: string): Promise<void>;
}

export interface PriorityFlagRepository {
  listByTeam(teamId: string): Promise<PriorityFlag[]>;
  save(flag: PriorityFlag): Promise<PriorityFlag>;
  remove(id: string): Promise<void>;
  clearForTeam(teamId: string): Promise<void>;
}

export interface MembershipRepository {
  listByTeam(teamId: string): Promise<TeamMembership[]>;
  save(membership: TeamMembership): Promise<TeamMembership>;
  remove(id: string): Promise<void>;
}

export interface Repositories {
  teams: TeamRepository;
  players: PlayerRepository;
  formations: FormationRepository;
  games: GameRepository;
  goals: DevelopmentGoalRepository;
  flags: PriorityFlagRepository;
  memberships: MembershipRepository;
}
