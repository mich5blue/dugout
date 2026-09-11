import type { TeamMembership, TeamRole } from '@/domain/access';
import { SYSTEM_FORMATIONS } from '@/domain/formations';
import type {
  DevelopmentGoal,
  Formation,
  Game,
  Player,
  PriorityFlag,
  Sport,
  Team,
} from '@/domain/types';
import type { Repositories } from './repositories';

/**
 * Browser-local implementation of the repository contracts.
 *
 * The whole database is one JSON document, which is fine for a single coach's
 * team and keeps the MVP dependency-free. Nothing outside this file knows that
 * storage is local: swapping in a real database means providing another
 * Repositories implementation.
 */

const STORAGE_KEY = 'dugout.db.v1';

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
   * Until accounts exist, this device is the head coach. `previewRole` lets a
   * head coach see the app as an assistant sees it — a preview of the
   * restrictions, never a security boundary.
   */
  session: { previewRole: TeamRole };
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
    session: { previewRole: 'HEAD_COACH' },
  };
}

interface Backend {
  read(): DugoutDatabase;
  write(db: DugoutDatabase): void;
  subscribe(listener: () => void): () => void;
}

function createMemoryBackend(initial: DugoutDatabase = emptyDatabase()): Backend {
  let db = initial;
  const listeners = new Set<() => void>();
  return {
    read: () => db,
    write: (next) => {
      db = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function createLocalStorageBackend(): Backend {
  const listeners = new Set<() => void>();
  let cache: DugoutDatabase | null = null;

  const read = (): DugoutDatabase => {
    if (cache) return cache;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      // Older saved databases predate memberships and session, so fill them in
      // rather than letting every read hit undefined.
      cache = raw
        ? { ...emptyDatabase(), ...(JSON.parse(raw) as DugoutDatabase) }
        : emptyDatabase();
    } catch {
      // Corrupt or unavailable storage should never hard-fail the app.
      cache = emptyDatabase();
    }
    return cache;
  };

  return {
    read,
    write: (next) => {
      cache = next;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Out of quota or private mode: keep working from the in-memory cache.
      }
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export class LocalStore implements Repositories {
  private backend: Backend;

  constructor(backend?: Backend) {
    this.backend =
      backend ??
      (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
        ? createLocalStorageBackend()
        : createMemoryBackend());
  }

  snapshot(): DugoutDatabase {
    return this.backend.read();
  }

  replaceAll(db: DugoutDatabase): void {
    this.backend.write(db);
  }

  subscribe(listener: () => void): () => void {
    return this.backend.subscribe(listener);
  }

  private update(mutate: (db: DugoutDatabase) => void): void {
    const current = this.backend.read();
    const next: DugoutDatabase = {
      ...current,
      teams: [...current.teams],
      players: [...current.players],
      formations: [...current.formations],
      games: [...current.games],
      goals: [...current.goals],
      flags: [...current.flags],
      memberships: [...(current.memberships ?? [])],
      session: current.session ?? { previewRole: 'HEAD_COACH' },
    };
    mutate(next);
    this.backend.write(next);
  }

  private static upsert<T extends { id: string }>(list: T[], item: T): void {
    const index = list.findIndex((entry) => entry.id === item.id);
    if (index >= 0) list[index] = item;
    else list.push(item);
  }

  teams = {
    list: async (): Promise<Team[]> => this.snapshot().teams,
    get: async (id: string): Promise<Team | null> =>
      this.snapshot().teams.find((team) => team.id === id) ?? null,
    save: async (team: Team): Promise<Team> => {
      this.update((db) => LocalStore.upsert(db.teams, team));
      return team;
    },
    remove: async (id: string): Promise<void> => {
      this.update((db) => {
        db.teams = db.teams.filter((team) => team.id !== id);
        db.players = db.players.filter((player) => player.teamId !== id);
        db.games = db.games.filter((game) => game.teamId !== id);
        db.formations = db.formations.filter((formation) => formation.teamId !== id);
        db.goals = db.goals.filter((goal) => goal.teamId !== id);
        db.flags = db.flags.filter((flag) => flag.teamId !== id);
        db.memberships = db.memberships.filter((member) => member.teamId !== id);
      });
    },
  };

  players = {
    listByTeam: async (teamId: string): Promise<Player[]> =>
      this.snapshot()
        .players.filter((player) => player.teamId === teamId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    get: async (id: string): Promise<Player | null> =>
      this.snapshot().players.find((player) => player.id === id) ?? null,
    save: async (player: Player): Promise<Player> => {
      this.update((db) => LocalStore.upsert(db.players, player));
      return player;
    },
    saveMany: async (players: Player[]): Promise<Player[]> => {
      this.update((db) => {
        for (const player of players) LocalStore.upsert(db.players, player);
      });
      return players;
    },
    remove: async (id: string): Promise<void> => {
      this.update((db) => {
        db.players = db.players.filter((player) => player.id !== id);
        db.goals = db.goals.filter((goal) => goal.playerId !== id);
        db.flags = db.flags.filter((flag) => flag.playerId !== id);
      });
    },
  };

  formations = {
    listForTeam: async (teamId: string, sport: Sport): Promise<Formation[]> => {
      const custom = this.snapshot().formations.filter(
        (formation) => formation.teamId === teamId && formation.sport === sport,
      );
      const presets = SYSTEM_FORMATIONS.filter((formation) => formation.sport === sport);
      return [...presets, ...custom];
    },
    get: async (id: string): Promise<Formation | null> => {
      const custom = this.snapshot().formations.find((formation) => formation.id === id);
      if (custom) return custom;
      return SYSTEM_FORMATIONS.find((formation) => formation.id === id) ?? null;
    },
    save: async (formation: Formation): Promise<Formation> => {
      this.update((db) => LocalStore.upsert(db.formations, formation));
      return formation;
    },
    remove: async (id: string): Promise<void> => {
      this.update((db) => {
        db.formations = db.formations.filter((formation) => formation.id !== id);
      });
    },
  };

  games = {
    listByTeam: async (teamId: string): Promise<Game[]> =>
      this.snapshot()
        .games.filter((game) => game.teamId === teamId)
        .sort((a, b) => b.date.localeCompare(a.date)),
    get: async (id: string): Promise<Game | null> =>
      this.snapshot().games.find((game) => game.id === id) ?? null,
    save: async (game: Game): Promise<Game> => {
      this.update((db) => LocalStore.upsert(db.games, game));
      return game;
    },
    remove: async (id: string): Promise<void> => {
      this.update((db) => {
        db.games = db.games.filter((game) => game.id !== id);
      });
    },
  };

  goals = {
    listByTeam: async (teamId: string): Promise<DevelopmentGoal[]> =>
      this.snapshot().goals.filter((goal) => goal.teamId === teamId),
    save: async (goal: DevelopmentGoal): Promise<DevelopmentGoal> => {
      this.update((db) => LocalStore.upsert(db.goals, goal));
      return goal;
    },
    remove: async (id: string): Promise<void> => {
      this.update((db) => {
        db.goals = db.goals.filter((goal) => goal.id !== id);
      });
    },
  };

  memberships = {
    listByTeam: async (teamId: string): Promise<TeamMembership[]> =>
      this.snapshot()
        .memberships.filter((member) => member.teamId === teamId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    save: async (membership: TeamMembership): Promise<TeamMembership> => {
      this.update((db) => LocalStore.upsert(db.memberships, membership));
      return membership;
    },
    remove: async (id: string): Promise<void> => {
      this.update((db) => {
        db.memberships = db.memberships.filter((member) => member.id !== id);
      });
    },
  };

  /** Preview a different role without accounts. Not a security boundary. */
  setPreviewRole(role: TeamRole): void {
    this.update((db) => {
      db.session = { previewRole: role };
    });
  }

  flags = {
    listByTeam: async (teamId: string): Promise<PriorityFlag[]> =>
      this.snapshot().flags.filter((flag) => flag.teamId === teamId),
    save: async (flag: PriorityFlag): Promise<PriorityFlag> => {
      this.update((db) => LocalStore.upsert(db.flags, flag));
      return flag;
    },
    remove: async (id: string): Promise<void> => {
      this.update((db) => {
        db.flags = db.flags.filter((flag) => flag.id !== id);
      });
    },
    clearForTeam: async (teamId: string): Promise<void> => {
      this.update((db) => {
        db.flags = db.flags.filter((flag) => flag.teamId !== teamId);
      });
    },
  };
}

/** In-memory store for tests and server rendering. */
export function createMemoryStore(initial?: DugoutDatabase): LocalStore {
  return new LocalStore(createMemoryBackend(initial ?? emptyDatabase()));
}

let browserStore: LocalStore | null = null;

/** Shared store for the browser session. */
export function getStore(): LocalStore {
  if (!browserStore) browserStore = new LocalStore();
  return browserStore;
}
