'use client';

import { buildDemoDatabase } from '@/data/seed';
import { emptyDatabase, type DugoutDatabase, type DugoutStore } from '@/data/database';
import { FirestoreStore } from '@/data/firestoreStore';
import { getStore } from '@/data/localStore';
import { isFirebaseConfigured } from '@/lib/firebase';
import { signOutNow, watchAccount, type Account } from '@/lib/auth';
import {
  can as roleCan,
  type Permission,
  type TeamMembership,
  type TeamRole,
} from '@/domain/access';
import type {
  DevelopmentGoal,
  Formation,
  Game,
  Player,
  PriorityFlag,
  Team,
} from '@/domain/types';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';

/**
 * Client-side application state.
 *
 * The UI reads a snapshot of the whole database and calls repository methods to
 * change it. Nothing here contains lineup logic — that all lives in the domain
 * and optimizer layers.
 */

/** Stable empty snapshot so server rendering and the first paint agree. */
const SERVER_SNAPSHOT: DugoutDatabase = emptyDatabase();

/** Which backing store the session is running on. */
export type Backend = 'firebase' | 'local';

interface DugoutContextValue {
  store: DugoutStore;
  /**
   * `firebase` when a project is configured: data lives in the account and is
   * shared with assistant coaches. `local` is the no-backend fallback, used for
   * development, the test suites and the demo team.
   */
  backend: Backend;
  /** Null until sign-in, and always null on the local backend. */
  account: Account | null;
  /** False until the auth state is known, so nothing flashes the wrong screen. */
  authReady: boolean;
  signOut: () => Promise<void>;
  db: DugoutDatabase;
  /** False until the browser store has been read, to avoid hydration mismatch. */
  ready: boolean;
  /** Every team on this device, oldest first. */
  teams: Team[];
  /** The team every page reads from. */
  team: Team | null;
  setActiveTeam: (teamId: string) => void;
  players: Player[];
  activePlayers: Player[];
  games: Game[];
  goals: DevelopmentGoal[];
  flags: PriorityFlag[];
  memberships: TeamMembership[];
  /**
   * The role this session acts as. Until accounts exist the device owner is the
   * head coach, and this only changes when they preview the assistant view.
   */
  role: TeamRole;
  /** Permission check. The server must apply the same table independently. */
  can: (permission: Permission) => boolean;
  setPreviewRole: (role: TeamRole) => void;
  saveMembership: (membership: TeamMembership) => Promise<void>;
  removeMembership: (id: string) => Promise<void>;
  seedDemoTeam: () => Promise<void>;
  resetEverything: () => void;
  saveTeam: (team: Team) => Promise<void>;
  removeTeam: (teamId: string) => Promise<void>;
  savePlayer: (player: Player) => Promise<void>;
  savePlayers: (players: Player[]) => Promise<void>;
  removePlayer: (playerId: string) => Promise<void>;
  saveGame: (game: Game) => Promise<void>;
  removeGame: (gameId: string) => Promise<void>;
  saveFormation: (formation: Formation) => Promise<void>;
  saveGoal: (goal: DevelopmentGoal) => Promise<void>;
  removeGoal: (goalId: string) => Promise<void>;
  saveFlag: (flag: PriorityFlag) => Promise<void>;
  clearFlags: () => Promise<void>;
}

const DugoutContext = createContext<DugoutContextValue | null>(null);

export function DugoutProvider({ children }: { children: React.ReactNode }) {
  const backend: Backend = isFirebaseConfigured() ? 'firebase' : 'local';

  const [account, setAccount] = useState<Account | null>(null);
  const [authReady, setAuthReady] = useState(backend === 'local');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (backend === 'local') return;
    return watchAccount((next) => {
      setAccount(next);
      setAuthReady(true);
    });
  }, [backend]);

  /*
    The store depends on who is signed in, because a Firestore store only knows
    how to read the teams belonging to one account. Signing out therefore
    replaces the store rather than clearing it — there is no shared mutable
    state to leak into the next session.
  */
  const [firestoreStore, setFirestoreStore] = useState<FirestoreStore | null>(null);

  useEffect(() => {
    if (backend === 'local' || !account) {
      setFirestoreStore(null);
      return;
    }
    const next = new FirestoreStore(account.uid, account.email);
    void next.start();
    setFirestoreStore(next);
    return () => next.stop();
  }, [account, backend]);

  const localStore = useMemo(() => getStore(), []);
  const store: DugoutStore = firestoreStore ?? localStore;

  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(listener),
    [store],
  );
  const getSnapshot = useCallback(() => store.snapshot(), [store]);
  const getServerSnapshot = useCallback(() => SERVER_SNAPSHOT, []);

  const db = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    setReady(true);
  }, []);

  const teams = useMemo(
    () => [...db.teams].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [db.teams],
  );

  /*
    Fall back to the first team rather than to null: a saved active id can point
    at a team that was deleted on another tab, and a coach should land on a
    working team instead of the empty first-run screen.
  */
  const team =
    teams.find((candidate) => candidate.id === db.session?.activeTeamId) ?? teams[0] ?? null;

  const players = useMemo(
    () =>
      team
        ? db.players
            .filter((player) => player.teamId === team.id)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        : [],
    [db.players, team],
  );

  const games = useMemo(
    () =>
      team
        ? db.games
            .filter((game) => game.teamId === team.id)
            .sort((a, b) => b.date.localeCompare(a.date))
        : [],
    [db.games, team],
  );

  const goals = useMemo(
    () => (team ? db.goals.filter((goal) => goal.teamId === team.id) : []),
    [db.goals, team],
  );

  const flags = useMemo(
    () => (team ? db.flags.filter((flag) => flag.teamId === team.id) : []),
    [db.flags, team],
  );

  const memberships = useMemo(
    () =>
      team
        ? (db.memberships ?? [])
            .filter((member) => member.teamId === team.id)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        : [],
    [db.memberships, team],
  );

  /*
    The real role comes from the team document, so an assistant cannot promote
    themselves by editing local state. Without a backend there are no accounts
    and the device owner is the head coach.
    `previewRole` only ever narrows: a head coach may look at the app as an
    assistant sees it, never the reverse.
  */
  const actualRole: TeamRole = team ? (db.roles?.[team.id] ?? 'HEAD_COACH') : 'HEAD_COACH';
  const role: TeamRole =
    actualRole === 'HEAD_COACH' && db.session?.previewRole === 'ASSISTANT'
      ? 'ASSISTANT'
      : actualRole;

  const value = useMemo<DugoutContextValue>(
    () => ({
      store,
      backend,
      account,
      authReady,
      signOut: async () => {
        if (backend === 'firebase') await signOutNow();
      },
      db,
      ready,
      teams,
      team,
      setActiveTeam: (teamId) => store.setActiveTeam(teamId),
      players,
      activePlayers: players.filter((player) => player.active),
      games,
      goals,
      flags,
      memberships,
      role,
      can: (permission) => roleCan(role, permission),
      setPreviewRole: (next) => store.setPreviewRole(next),
      saveMembership: async (membership) => void (await store.memberships.save(membership)),
      removeMembership: async (id) => store.memberships.remove(id),
      seedDemoTeam: async () => {
        const demo = await buildDemoDatabase();
        store.replaceAll(demo);
      },
      resetEverything: () => {
        /*
          On the local backend the database is one document, so emptying it is
          the reset. Against Firestore there is nothing to overwrite — the reset
          is deleting the teams, which is also what revokes the assistants.
        */
        if (backend === 'firebase') {
          void Promise.all(teams.map((entry) => store.teams.remove(entry.id)));
          return;
        }
        store.replaceAll(emptyDatabase());
      },
      saveTeam: async (next) => void (await store.teams.save(next)),
      removeTeam: async (teamId) => store.teams.remove(teamId),
      savePlayer: async (next) => void (await store.players.save(next)),
      savePlayers: async (next) => void (await store.players.saveMany(next)),
      removePlayer: async (playerId) => store.players.remove(playerId),
      saveGame: async (next) => void (await store.games.save(next)),
      removeGame: async (gameId) => store.games.remove(gameId),
      saveFormation: async (next) => void (await store.formations.save(next)),
      saveGoal: async (next) => void (await store.goals.save(next)),
      removeGoal: async (goalId) => store.goals.remove(goalId),
      saveFlag: async (next) => void (await store.flags.save(next)),
      clearFlags: async () => {
        if (team) await store.flags.clearForTeam(team.id);
      },
    }),
    [
      account,
      authReady,
      backend,
      db,
      flags,
      games,
      goals,
      memberships,
      players,
      ready,
      role,
      store,
      team,
      teams,
    ],
  );

  return <DugoutContext.Provider value={value}>{children}</DugoutContext.Provider>;
}

export function useDugout(): DugoutContextValue {
  const context = useContext(DugoutContext);
  if (!context) throw new Error('useDugout must be used inside DugoutProvider');
  return context;
}

/** Convenience: the formations available to the current team. */
export function useFormations(): Formation[] {
  const { db, team } = useDugout();
  return useMemo(() => {
    if (!team) return [];
    return db.formations.filter(
      (formation) => formation.teamId === team.id && formation.sport === team.sport,
    );
  }, [db.formations, team]);
}
