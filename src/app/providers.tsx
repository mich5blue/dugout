'use client';

import { buildDemoDatabase } from '@/data/seed';
import {
  emptyDatabase,
  getStore,
  type DugoutDatabase,
  type LocalStore,
} from '@/data/localStore';
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

interface DugoutContextValue {
  store: LocalStore;
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
  const store = useMemo(() => getStore(), []);
  const [ready, setReady] = useState(false);

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

  const role: TeamRole = db.session?.previewRole ?? 'HEAD_COACH';

  const value = useMemo<DugoutContextValue>(
    () => ({
      store,
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
      resetEverything: () => store.replaceAll(emptyDatabase()),
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
    [db, flags, games, goals, memberships, players, ready, role, store, team, teams],
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
