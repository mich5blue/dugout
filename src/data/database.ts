import type { TeamMembership, TeamRole } from '@/domain/access';
import type {
  DevelopmentGoal,
  Formation,
  Game,
  Player,
  PriorityFlag,
  Team,
} from '@/domain/types';
import type { Repositories } from './repositories';

/**
 * The shape of everything InningGrid stores, and the contract every backing store
 * implements.
 *
 * The whole UI reads one synchronous snapshot of this document and calls
 * repository methods to change it. That indirection is what lets the same
 * screens run against browser storage or against Firestore without knowing
 * which one they are talking to.
 */

export interface DugoutDatabase {
  version: 1;
  teams: Team[];
  players: Player[];
  formations: Formation[];
  games: Game[];
  goals: DevelopmentGoal[];
  flags: PriorityFlag[];
  memberships: TeamMembership[];
  /**
   * The signed-in coach's role per team id. Empty when there are no accounts —
   * on a single device with no backend, the owner is the head coach.
   */
  roles: Record<string, TeamRole>;
  /**
   * Until accounts exist, this device is the head coach. `previewRole` lets a
   * head coach see the app as an assistant sees it — a preview of the
   * restrictions, never a security boundary.
   *
   * `activeTeamId` is which team the app is currently showing. A coach often
   * runs two teams — a rec team and a travel team, or two age groups — and
   * every page reads from the active one.
   */
  session: { previewRole: TeamRole; activeTeamId?: string };
}

export function emptyDatabase(): DugoutDatabase {
  return {
    version: 1,
    teams: [],
    players: [],
    formations: [],
    games: [],
    goals: [],
    flags: [],
    memberships: [],
    roles: {},
    session: { previewRole: 'HEAD_COACH' },
  };
}

/**
 * A store the app can run on.
 *
 * `snapshot` must be synchronous and referentially stable between changes, so
 * React's `useSyncExternalStore` can read it without tearing.
 */
export interface DugoutStore extends Repositories {
  snapshot(): DugoutDatabase;
  subscribe(listener: () => void): () => void;
  replaceAll(db: DugoutDatabase): void;
  setPreviewRole(role: TeamRole): void;
  setActiveTeam(teamId: string): void;
}
