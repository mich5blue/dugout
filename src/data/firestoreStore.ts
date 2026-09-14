import { migratePlayer, needsMigration } from './migratePlayer';
import {
  ASSISTANT_EDITABLE_PLAYER_FIELDS,
  MAX_ASSISTANT_COACHES,
  permittedPlayerChanges,
  type TeamMembership,
  type TeamRole,
} from '@/domain/access';
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
import { firestore } from '@/lib/firebase';
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { emptyDatabase, type DugoutDatabase, type DugoutStore } from './database';

/**
 * Firestore implementation of the store contract.
 *
 * Shape: `teams/{teamId}` with everything belonging to a team in its
 * subcollections. That nesting is what makes the security rules legible — one
 * team is one subtree, and a coach's access to the subtree is decided by the
 * parent document.
 *
 * The store keeps a full in-memory mirror of the teams this user can see and
 * hands the UI the same synchronous snapshot the browser store did, so no page
 * knows which backend it is running on.
 *
 * Reads are live: every collection is an `onSnapshot` listener, so a lineup
 * changed by the head coach on the bench appears on an assistant's phone
 * without a refresh. Writes go straight to Firestore, which applies them to the
 * local cache first — so an edit made with no signal shows immediately and
 * syncs when the connection returns.
 */

/** Access fields kept on the team document, alongside the domain team. */
interface TeamAccess {
  ownerUid: string;
  /** Everyone who has signed in and claimed a place on this team. */
  memberUids: string[];
  /** Invited assistants, lowercased, before they have ever signed in. */
  assistantEmails: string[];
  /** Role per uid. The rules read this; so does the UI. */
  roles: Record<string, TeamRole>;
}

type TeamDocument = Team & TeamAccess;

const ACCESS_KEYS = ['ownerUid', 'memberUids', 'assistantEmails', 'roles'] as const;

function stripAccess(data: DocumentData): Team {
  const team = { ...data } as Record<string, unknown>;
  for (const key of ACCESS_KEYS) delete team[key];
  return team as unknown as Team;
}

/** The session is per-device UI state, not team data, so it stays local. */
const SESSION_KEY = 'dugout.session.v1';

interface SessionState {
  previewRole: TeamRole;
  activeTeamId?: string;
}

function readSession(): SessionState {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionState) : { previewRole: 'HEAD_COACH' };
  } catch {
    return { previewRole: 'HEAD_COACH' };
  }
}

function writeSession(session: SessionState): void {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Private mode: the session simply resets next time.
  }
}

/** The subcollections that hang off a team, and where each lands in the snapshot. */
const COLLECTIONS = ['players', 'games', 'formations', 'goals', 'flags', 'memberships'] as const;
type CollectionName = (typeof COLLECTIONS)[number];

export class FirestoreStore implements DugoutStore {
  private db = firestore();
  private cache: DugoutDatabase;
  private listeners = new Set<() => void>();
  private unsubscribes = new Map<string, Unsubscribe>();
  /** Per-team, per-collection documents, merged into the snapshot on change. */
  private documents = new Map<string, unknown[]>();
  private teamDocuments = new Map<string, TeamDocument>();

  constructor(
    private uid: string,
    private email: string,
  ) {
    this.cache = { ...emptyDatabase(), session: readSession() };
  }

  snapshot(): DugoutDatabase {
    return this.cache;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  /**
   * Rebuilds the snapshot from the per-collection mirrors.
   *
   * A whole rebuild rather than a patch: the volume is a few hundred documents
   * for a coach with two teams, and a single code path for "what does the app
   * see" is worth far more than the cycles it costs.
   */
  private rebuild(): void {
    const teams = [...this.teamDocuments.values()];
    const gather = <T>(name: CollectionName): T[] =>
      teams.flatMap((team) => (this.documents.get(`${team.id}/${name}`) ?? []) as T[]);

    const roles: Record<string, TeamRole> = {};
    for (const team of teams) roles[team.id] = team.roles?.[this.uid] ?? 'ASSISTANT';

    this.cache = {
      version: 1,
      teams: teams.map((team) => stripAccess(team as unknown as DocumentData)),
      players: gather<Player>('players').map(migratePlayer),
      games: gather<Game>('games'),
      formations: gather<Formation>('formations'),
      goals: gather<DevelopmentGoal>('goals'),
      flags: gather<PriorityFlag>('flags'),
      memberships: gather<TeamMembership>('memberships'),
      roles,
      session: this.cache.session,
    };
    this.emit();

    /*
      Surname migration at rest. Reads above are already reduced, so nothing
      renders a surname — but the stored document keeps the old `lastName`
      until it is replaced, and a privacy change that leaves the data in the
      database is not one.

      Best-effort on purpose: only a head coach may write players, the write is
      not worth retrying, and a failure must never break a read. The document
      is replaced the next time that player is edited in any case.
    */
    const stale = gather<Player>('players').filter(needsMigration);
    if (stale.length > 0 && !this.surnameMigrationRun) {
      this.surnameMigrationRun = true;
      const writable = stale.filter((player) => roles[player.teamId] === 'HEAD_COACH');
      if (writable.length > 0) {
        void this.players.saveMany(writable.map(migratePlayer)).catch(() => {
          // An assistant session, an offline device, or a rules refusal.
        });
      }
    }
  }

  /** So the migration is attempted once, not on every snapshot. */
  private surnameMigrationRun = false;

  /**
   * Starts listening.
   *
   * Two queries find a coach's teams: the uid they have already claimed, and
   * the email a head coach invited. The second is what lets an assistant's
   * first sign-in find the team at all.
   */
  async start(): Promise<void> {
    /*
      Claim first, then listen. An invited assistant's uid is not on the team
      until they claim it, and the rules gate the roster on membership — so
      listeners attached before the claim came back permission-denied and the
      assistant saw an empty roster until they reloaded.
    */
    if (this.email) {
      try {
        await this.claimInvitations();
      } catch {
        // Offline, or nothing to claim. Either way, carry on and listen: the
        // teams this account already belongs to do not depend on it.
      }
    }

    this.watchTeams(
      'uid',
      query(collection(this.db, 'teams'), where('memberUids', 'array-contains', this.uid)),
    );

    if (this.email) {
      this.watchTeams(
        'email',
        query(
          collection(this.db, 'teams'),
          where('assistantEmails', 'array-contains', this.email.toLowerCase()),
        ),
      );
    }
  }

  private watchTeams(key: string, teamQuery: ReturnType<typeof query>): void {
    this.unsubscribes.get(`teams:${key}`)?.();
    const unsubscribe = onSnapshot(teamQuery, (snap) => {
      const seen = new Set<string>();
      for (const document of snap.docs) {
        const data = { ...(document.data() as TeamDocument), id: document.id };
        this.teamDocuments.set(document.id, data);
        seen.add(document.id);
        this.watchTeamCollections(document.id);
      }

      /*
        Only drop teams this particular query used to return. The other query
        may still be the reason a team is visible, and dropping it here would
        make an invited assistant's team flicker away on every snapshot.
      */
      for (const [teamId] of this.teamDocuments) {
        const byThisQuery = this.queryMembership.get(key)?.has(teamId) ?? false;
        if (byThisQuery && !seen.has(teamId)) {
          const stillVisible = [...this.queryMembership.entries()].some(
            ([otherKey, ids]) => otherKey !== key && ids.has(teamId),
          );
          if (!stillVisible) this.forgetTeam(teamId);
        }
      }
      this.queryMembership.set(key, seen);
      this.rebuild();
    });
    this.unsubscribes.set(`teams:${key}`, unsubscribe);
  }

  private queryMembership = new Map<string, Set<string>>();

  private forgetTeam(teamId: string): void {
    this.teamDocuments.delete(teamId);
    for (const name of COLLECTIONS) {
      this.unsubscribes.get(`${teamId}/${name}`)?.();
      this.unsubscribes.delete(`${teamId}/${name}`);
      this.documents.delete(`${teamId}/${name}`);
    }
  }

  private watchTeamCollections(teamId: string): void {
    for (const name of COLLECTIONS) {
      const key = `${teamId}/${name}`;
      if (this.unsubscribes.has(key)) continue;
      const unsubscribe = onSnapshot(
        collection(this.db, 'teams', teamId, name),
        (snap) => {
          this.documents.set(
            key,
            snap.docs.map((document) => ({ ...document.data(), id: document.id })),
          );
          this.rebuild();
        },
        () => {
          /*
            The listener is dead — usually because the rules denied the read
            while this account's claim to the team was still in flight. Drop the
            registration so the next rebuild re-attaches it, instead of leaving
            a permanently empty collection on screen.
          */
          this.unsubscribes.delete(key);
          this.documents.set(key, []);
          this.rebuild();
        },
      );
      this.unsubscribes.set(key, unsubscribe);
    }
  }

  /**
   * Attaches this account to teams it was invited to by email.
   *
   * The write adds only this uid and this role, which is exactly what the
   * security rules permit an invited assistant to change.
   */
  private async claimInvitations(): Promise<void> {
    const invited = await getDocs(
      query(
        collection(this.db, 'teams'),
        where('assistantEmails', 'array-contains', this.email.toLowerCase()),
      ),
    );

    for (const document of invited.docs) {
      const data = document.data() as TeamDocument;
      if ((data.memberUids ?? []).includes(this.uid)) continue;
      await updateDoc(document.ref, {
        memberUids: arrayUnion(this.uid),
        [`roles.${this.uid}`]: 'ASSISTANT',
      });

      // Mark the matching membership active so the coaches page stops showing
      // the coach as merely invited.
      const memberships = await getDocs(
        collection(this.db, 'teams', document.id, 'memberships'),
      );
      const mine = memberships.docs.find(
        (member) =>
          (member.data() as TeamMembership).email.trim().toLowerCase() ===
          this.email.toLowerCase(),
      );
      if (mine) {
        await updateDoc(mine.ref, { userId: this.uid, status: 'ACTIVE' });
      }
    }
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribes.values()) unsubscribe();
    this.unsubscribes.clear();
    this.documents.clear();
    this.teamDocuments.clear();
  }

  /** The role this account holds on a team, for the rules-mirroring guards. */
  private roleFor(teamId: string): TeamRole {
    return this.teamDocuments.get(teamId)?.roles?.[this.uid] ?? 'ASSISTANT';
  }

  private path(teamId: string, name: CollectionName, id: string) {
    return doc(this.db, 'teams', teamId, name, id);
  }

  private list<T extends { id: string }>(name: CollectionName, teamId: string): T[] {
    return (this.documents.get(`${teamId}/${name}`) ?? []) as T[];
  }

  // -------------------------------------------------------------------------
  // Repositories
  // -------------------------------------------------------------------------

  teams = {
    list: async (): Promise<Team[]> => this.cache.teams,
    get: async (id: string): Promise<Team | null> =>
      this.cache.teams.find((team) => team.id === id) ?? null,
    save: async (team: Team): Promise<Team> => {
      const existing = this.teamDocuments.get(team.id);
      if (existing) {
        await setDoc(doc(this.db, 'teams', team.id), team, { merge: true });
      } else {
        /*
          A new team names its creator as owner and sole member. The rules check
          exactly this, so a client cannot create a team it does not own.
        */
        const document: TeamDocument = {
          ...team,
          ownerUid: this.uid,
          memberUids: [this.uid],
          assistantEmails: [],
          roles: { [this.uid]: 'HEAD_COACH' },
        };
        await setDoc(doc(this.db, 'teams', team.id), document);
      }
      return team;
    },
    remove: async (id: string): Promise<void> => {
      /*
        Firestore does not cascade. Delete the subcollections first so a failure
        part-way leaves orphaned documents rather than an unreachable team
        holding a roster nobody can see or remove.
      */
      for (const name of COLLECTIONS) {
        const snap = await getDocs(collection(this.db, 'teams', id, name));
        await Promise.all(snap.docs.map((document) => deleteDoc(document.ref)));
      }
      await deleteDoc(doc(this.db, 'teams', id));
      if (this.cache.session.activeTeamId === id) {
        const next = this.cache.teams.find((team) => team.id !== id);
        this.setActiveTeam(next?.id ?? '');
      }
    },
  };

  players = {
    listByTeam: async (teamId: string): Promise<Player[]> =>
      this.list<Player>('players', teamId).sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      ),
    get: async (id: string): Promise<Player | null> =>
      this.cache.players.find((player) => player.id === id) ?? null,
    save: async (player: Player): Promise<Player> => {
      /*
        An assistant may change four fields on a player, and the pages hand over
        a whole player object. Narrowing to a field update matters for a reason
        the rules alone do not cover: the assistant's copy may be seconds stale,
        and a full write would quietly revert a rename the head coach just made
        — which the rules would then reject as an unpermitted change, turning a
        legitimate edit into a permission error.
      */
      if (this.roleFor(player.teamId) === 'ASSISTANT') {
        const changes = permittedPlayerChanges(
          'ASSISTANT',
          Object.fromEntries(
            ASSISTANT_EDITABLE_PLAYER_FIELDS.map((field) => [field, player[field]]),
          ),
        );
        await updateDoc(this.path(player.teamId, 'players', player.id), changes);
        return player;
      }
      await setDoc(this.path(player.teamId, 'players', player.id), player);
      return player;
    },
    saveMany: async (players: Player[]): Promise<Player[]> => {
      await Promise.all(players.map((player) => this.players.save(player)));
      return players;
    },
    remove: async (id: string): Promise<void> => {
      const player = this.cache.players.find((entry) => entry.id === id);
      if (!player) return;
      await deleteDoc(this.path(player.teamId, 'players', id));
      await Promise.all(
        this.cache.goals
          .filter((goal) => goal.playerId === id)
          .map((goal) => deleteDoc(this.path(goal.teamId, 'goals', goal.id))),
      );
      await Promise.all(
        this.cache.flags
          .filter((flag) => flag.playerId === id)
          .map((flag) => deleteDoc(this.path(flag.teamId, 'flags', flag.id))),
      );
    },
  };

  formations = {
    listForTeam: async (teamId: string, sport: Sport): Promise<Formation[]> => {
      const custom = this.list<Formation>('formations', teamId).filter(
        (formation) => formation.sport === sport,
      );
      const presets = SYSTEM_FORMATIONS.filter((formation) => formation.sport === sport);
      return [...presets, ...custom];
    },
    get: async (id: string): Promise<Formation | null> =>
      this.cache.formations.find((formation) => formation.id === id) ??
      SYSTEM_FORMATIONS.find((formation) => formation.id === id) ??
      null,
    save: async (formation: Formation): Promise<Formation> => {
      // System presets carry no team and are code, not data.
      if (!formation.teamId) return formation;
      await setDoc(this.path(formation.teamId, 'formations', formation.id), formation);
      return formation;
    },
    remove: async (id: string): Promise<void> => {
      const formation = this.cache.formations.find((entry) => entry.id === id);
      if (formation?.teamId) await deleteDoc(this.path(formation.teamId, 'formations', id));
    },
  };

  games = {
    listByTeam: async (teamId: string): Promise<Game[]> =>
      this.list<Game>('games', teamId).sort((a, b) => b.date.localeCompare(a.date)),
    get: async (id: string): Promise<Game | null> =>
      this.cache.games.find((game) => game.id === id) ?? null,
    save: async (game: Game): Promise<Game> => {
      await setDoc(this.path(game.teamId, 'games', game.id), game);
      return game;
    },
    remove: async (id: string): Promise<void> => {
      const game = this.cache.games.find((entry) => entry.id === id);
      if (game) await deleteDoc(this.path(game.teamId, 'games', id));
    },
  };

  goals = {
    listByTeam: async (teamId: string): Promise<DevelopmentGoal[]> =>
      this.list<DevelopmentGoal>('goals', teamId),
    save: async (goal: DevelopmentGoal): Promise<DevelopmentGoal> => {
      await setDoc(this.path(goal.teamId, 'goals', goal.id), goal);
      return goal;
    },
    remove: async (id: string): Promise<void> => {
      const goal = this.cache.goals.find((entry) => entry.id === id);
      if (goal) await deleteDoc(this.path(goal.teamId, 'goals', id));
    },
  };

  memberships = {
    listByTeam: async (teamId: string): Promise<TeamMembership[]> =>
      this.list<TeamMembership>('memberships', teamId).sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      ),
    save: async (membership: TeamMembership): Promise<TeamMembership> => {
      await setDoc(
        this.path(membership.teamId, 'memberships', membership.id),
        membership,
      );
      /*
        The invited address also goes on the team document, because that is what
        the security rules can read: a coach who has never signed in has no uid
        to grant anything to.
      */
      if (membership.role === 'ASSISTANT') {
        const team = this.teamDocuments.get(membership.teamId);
        const emails = new Set(team?.assistantEmails ?? []);
        emails.add(membership.email.trim().toLowerCase());
        if (emails.size <= MAX_ASSISTANT_COACHES) {
          await updateDoc(doc(this.db, 'teams', membership.teamId), {
            assistantEmails: [...emails],
          });
        }
      }
      return membership;
    },
    remove: async (id: string): Promise<void> => {
      const membership = this.cache.memberships.find((entry) => entry.id === id);
      if (!membership) return;
      await deleteDoc(this.path(membership.teamId, 'memberships', id));

      // Revoke access as well as the listing, or removal is cosmetic.
      const team = this.teamDocuments.get(membership.teamId);
      if (!team) return;
      const email = membership.email.trim().toLowerCase();
      await updateDoc(doc(this.db, 'teams', membership.teamId), {
        assistantEmails: (team.assistantEmails ?? []).filter((entry) => entry !== email),
        memberUids: (team.memberUids ?? []).filter(
          (uid) => uid !== (membership.userId ?? ''),
        ),
        roles: Object.fromEntries(
          Object.entries(team.roles ?? {}).filter(
            ([uid]) => uid !== (membership.userId ?? ''),
          ),
        ),
      });
    },
  };

  flags = {
    listByTeam: async (teamId: string): Promise<PriorityFlag[]> =>
      this.list<PriorityFlag>('flags', teamId),
    save: async (flag: PriorityFlag): Promise<PriorityFlag> => {
      await setDoc(this.path(flag.teamId, 'flags', flag.id), flag);
      return flag;
    },
    remove: async (id: string): Promise<void> => {
      const flag = this.cache.flags.find((entry) => entry.id === id);
      if (flag) await deleteDoc(this.path(flag.teamId, 'flags', id));
    },
    clearForTeam: async (teamId: string): Promise<void> => {
      await Promise.all(
        this.list<PriorityFlag>('flags', teamId).map((flag) =>
          deleteDoc(this.path(teamId, 'flags', flag.id)),
        ),
      );
    },
  };

  // -------------------------------------------------------------------------
  // Session and bulk operations
  // -------------------------------------------------------------------------

  private updateSession(changes: Partial<SessionState>): void {
    const session = { ...this.cache.session, ...changes };
    writeSession(session);
    this.cache = { ...this.cache, session };
    this.emit();
  }

  setPreviewRole(role: TeamRole): void {
    this.updateSession({ previewRole: role });
  }

  setActiveTeam(teamId: string): void {
    this.updateSession({ activeTeamId: teamId });
  }

  /**
   * Uploads a whole database. Used once, to move a coach's browser-stored team
   * into their account; there is no reason to call it in normal operation.
   */
  replaceAll(db: DugoutDatabase): void {
    void this.upload(db);
  }

  async upload(db: DugoutDatabase): Promise<void> {
    for (const team of db.teams) {
      await this.teams.save(team);
      await Promise.all([
        ...db.players
          .filter((player) => player.teamId === team.id)
          .map((player) => setDoc(this.path(team.id, 'players', player.id), player)),
        ...db.games
          .filter((game) => game.teamId === team.id)
          .map((game) => setDoc(this.path(team.id, 'games', game.id), game)),
        ...db.formations
          .filter((formation) => formation.teamId === team.id)
          .map((formation) =>
            setDoc(this.path(team.id, 'formations', formation.id), formation),
          ),
        ...db.goals
          .filter((goal) => goal.teamId === team.id)
          .map((goal) => setDoc(this.path(team.id, 'goals', goal.id), goal)),
        ...db.memberships
          .filter((member) => member.teamId === team.id)
          .map((member) => this.memberships.save(member)),
      ]);
    }
  }
}
