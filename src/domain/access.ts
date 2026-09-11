/**
 * Roles and permissions.
 *
 * One source of truth for who may do what. The UI reads it to decide what to
 * show, and the server must read the same table to decide what to allow —
 * hiding a button is a courtesy, not a control. Anything enforced only here is
 * bypassable by anyone willing to open a console.
 */

export type TeamRole = 'HEAD_COACH' | 'ASSISTANT';

/**
 * A head coach may add two assistants. Enforced in the domain and again
 * server-side, because the client can be edited.
 */
export const MAX_ASSISTANT_COACHES = 2;

export type Permission =
  // Team and membership
  | 'team:edit'
  | 'team:delete'
  | 'members:manage'
  // Roster identity: who is on the team at all
  | 'roster:add'
  | 'roster:remove'
  | 'player:editIdentity'
  // What an assistant coach is trusted with
  | 'player:editEligibility'
  | 'player:editAbility'
  // Games
  | 'game:create'
  | 'game:delete'
  | 'game:generate'
  | 'game:edit'
  | 'game:record'
  // Read-only surfaces
  | 'team:view'
  | 'season:view';

/**
 * An assistant coach can do the two jobs a head coach actually delegates:
 * say where a player can and cannot play, and mark who is a core player.
 * Everything else is read-only for them — they can see every lineup, the
 * season dashboard and the roster, but cannot change the team, the roster's
 * membership, or a game.
 */
const ASSISTANT_PERMISSIONS: readonly Permission[] = [
  'team:view',
  'season:view',
  'player:editEligibility',
  'player:editAbility',
];

const HEAD_COACH_PERMISSIONS: readonly Permission[] = [
  'team:view',
  'team:edit',
  'team:delete',
  'members:manage',
  'roster:add',
  'roster:remove',
  'player:editIdentity',
  'player:editEligibility',
  'player:editAbility',
  'game:create',
  'game:delete',
  'game:generate',
  'game:edit',
  'game:record',
  'season:view',
];

export const ROLE_PERMISSIONS: Record<TeamRole, readonly Permission[]> = {
  HEAD_COACH: HEAD_COACH_PERMISSIONS,
  ASSISTANT: ASSISTANT_PERMISSIONS,
};

export function can(role: TeamRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export const ROLE_LABEL: Record<TeamRole, string> = {
  HEAD_COACH: 'Head coach',
  ASSISTANT: 'Assistant coach',
};

export const ROLE_DESCRIPTION: Record<TeamRole, string> = {
  HEAD_COACH: 'Full access to the team, roster, games and settings.',
  ASSISTANT:
    'Can set where players can and cannot play, and mark core players. Everything else is read-only.',
};

// ---------------------------------------------------------------------------
// Accounts and membership
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export type MembershipStatus = 'INVITED' | 'ACTIVE';

export interface TeamMembership {
  id: string;
  teamId: string;
  /** Null until an invited coach accepts and an account exists. */
  userId: string | null;
  /** The address the invitation was sent to; kept for display and matching. */
  email: string;
  name: string;
  role: TeamRole;
  status: MembershipStatus;
  createdAt: string;
}

export function assistantCount(memberships: TeamMembership[]): number {
  return memberships.filter((member) => member.role === 'ASSISTANT').length;
}

export type InviteRejection =
  | { ok: true }
  | { ok: false; reason: 'NOT_ALLOWED' | 'AT_CAPACITY' | 'DUPLICATE' | 'INVALID_EMAIL'; message: string };

/**
 * Whether `actor` may invite `email` as an assistant right now.
 *
 * Returns the coach-facing reason rather than a boolean so the caller never has
 * to reconstruct why, and so the server and the UI give identical answers.
 */
export function canInviteAssistant(
  actorRole: TeamRole,
  memberships: TeamMembership[],
  email: string,
): InviteRejection {
  if (!can(actorRole, 'members:manage')) {
    return {
      ok: false,
      reason: 'NOT_ALLOWED',
      message: 'Only the head coach can invite assistant coaches.',
    };
  }

  const normalized = email.trim().toLowerCase();
  // Deliberately permissive: real addresses vary more than most patterns allow,
  // and the invitation itself is the real check.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized)) {
    return {
      ok: false,
      reason: 'INVALID_EMAIL',
      message: 'That does not look like an email address.',
    };
  }

  if (memberships.some((member) => member.email.trim().toLowerCase() === normalized)) {
    return {
      ok: false,
      reason: 'DUPLICATE',
      message: 'That coach is already on this team.',
    };
  }

  if (assistantCount(memberships) >= MAX_ASSISTANT_COACHES) {
    return {
      ok: false,
      reason: 'AT_CAPACITY',
      message: `A team can have ${MAX_ASSISTANT_COACHES} assistant coaches. Remove one first.`,
    };
  }

  return { ok: true };
}

/** Fields of a player an assistant coach is allowed to change. */
export const ASSISTANT_EDITABLE_PLAYER_FIELDS = [
  'positionRatings',
  'overallTier',
  'canPitch',
  'canCatch',
] as const;

export type AssistantEditablePlayerField =
  (typeof ASSISTANT_EDITABLE_PLAYER_FIELDS)[number];

/**
 * Narrows a player update to what the role may actually change.
 *
 * Used by both the UI and the server so an assistant's edit cannot quietly
 * carry a renamed player or a flipped active flag alongside the eligibility
 * change it claims to be.
 */
export function permittedPlayerChanges<T extends Record<string, unknown>>(
  role: TeamRole,
  changes: T,
): Partial<T> {
  if (can(role, 'player:editIdentity')) return changes;

  const allowed = new Set<string>(ASSISTANT_EDITABLE_PLAYER_FIELDS);
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (allowed.has(key)) result[key as keyof T] = value as T[keyof T];
  }
  return result;
}
