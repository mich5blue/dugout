import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * The security rules, executed.
 *
 * These run against the Firestore emulator, so they test the rules themselves
 * rather than a TypeScript restatement of them. This is the only place the
 * permission model is actually proven: everything in the UI is a courtesy, and
 * `permittedPlayerChanges` narrows requests on a client anyone can edit.
 *
 * Requires the emulator: `npm run emulator` in another terminal, or
 * `npm run test:rules` which starts one for the duration of the run.
 */

const HEAD = { sub: 'uid-head', email: 'head@example.com' };
const ASSISTANT = { sub: 'uid-assistant', email: 'assistant@example.com' };
const STRANGER = { sub: 'uid-stranger', email: 'stranger@example.com' };

/** The token claims, without the uid — that is passed separately. */
function token(user: { email: string }) {
  return { email: user.email, email_verified: true };
}

const TEAM_ID = 'team-1';
const PLAYER_ID = 'player-1';

function teamDocument() {
  return {
    id: TEAM_ID,
    name: 'Balsam Waters',
    sport: 'BASEBALL',
    seasonName: 'Spring 2026',
    ownerUid: HEAD.sub,
    memberUids: [HEAD.sub],
    assistantEmails: [],
    roles: { [HEAD.sub]: 'HEAD_COACH' },
  };
}

function playerDocument() {
  return {
    id: PLAYER_ID,
    teamId: TEAM_ID,
    firstName: 'Brody',
    lastName: 'Borek',
    active: true,
    canPitch: false,
    canCatch: false,
    overallTier: 'AVERAGE',
    positionRatings: {},
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'dugout-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8089,
    },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

/** Seeds a team with rules bypassed, the way a fixture should. */
async function seedTeam(overrides: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'teams', TEAM_ID), { ...teamDocument(), ...overrides });
    await setDoc(doc(db, 'teams', TEAM_ID, 'players', PLAYER_ID), playerDocument());
    await setDoc(doc(db, 'teams', TEAM_ID, 'games', 'game-1'), {
      id: 'game-1',
      teamId: TEAM_ID,
      opponent: 'Cardinals',
      date: '2026-05-02',
    });
  });
}

/** A team with the assistant already signed in and claimed. */
async function seedWithAssistant() {
  await seedTeam({
    memberUids: [HEAD.sub, ASSISTANT.sub],
    assistantEmails: [ASSISTANT.email],
    roles: { [HEAD.sub]: 'HEAD_COACH', [ASSISTANT.sub]: 'ASSISTANT' },
  });
}

describe('team documents', () => {
  it('lets a head coach read their own team', async () => {
    await seedTeam();
    const db = env.authenticatedContext(HEAD.sub, token(HEAD)).firestore();
    await assertSucceeds(getDoc(doc(db, 'teams', TEAM_ID)));
  });

  it('refuses a stranger, signed in or not', async () => {
    await seedTeam();
    const stranger = env.authenticatedContext(STRANGER.sub, token(STRANGER)).firestore();
    await assertFails(getDoc(doc(stranger, 'teams', TEAM_ID)));

    const anonymous = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anonymous, 'teams', TEAM_ID)));
  });

  it('refuses a team created in someone else’s name', async () => {
    const db = env.authenticatedContext(STRANGER.sub, token(STRANGER)).firestore();
    await assertFails(
      setDoc(doc(db, 'teams', 'team-2'), {
        ...teamDocument(),
        id: 'team-2',
        ownerUid: HEAD.sub,
        memberUids: [HEAD.sub],
        roles: { [HEAD.sub]: 'HEAD_COACH' },
      }),
    );
  });

  it('refuses a team created with an assistant already attached', async () => {
    const db = env.authenticatedContext(STRANGER.sub, token(STRANGER)).firestore();
    await assertFails(
      setDoc(doc(db, 'teams', 'team-3'), {
        ...teamDocument(),
        id: 'team-3',
        ownerUid: STRANGER.sub,
        memberUids: [STRANGER.sub, HEAD.sub],
        roles: { [STRANGER.sub]: 'HEAD_COACH', [HEAD.sub]: 'ASSISTANT' },
      }),
    );
  });

  it('lets a coach create their own team', async () => {
    const db = env.authenticatedContext(HEAD.sub, token(HEAD)).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'teams', 'team-4'), { ...teamDocument(), id: 'team-4' }),
    );
  });

  it('lets only the owner delete a team', async () => {
    await seedWithAssistant();
    const assistant = env.authenticatedContext(ASSISTANT.sub, token(ASSISTANT)).firestore();
    await assertFails(deleteDoc(doc(assistant, 'teams', TEAM_ID)));

    const head = env.authenticatedContext(HEAD.sub, token(HEAD)).firestore();
    await assertSucceeds(deleteDoc(doc(head, 'teams', TEAM_ID)));
  });

  it('caps assistants at two', async () => {
    await seedTeam();
    const db = env.authenticatedContext(HEAD.sub, token(HEAD)).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'teams', TEAM_ID), { assistantEmails: ['a@x.com', 'b@x.com'] }),
    );
    await assertFails(
      updateDoc(doc(db, 'teams', TEAM_ID), {
        assistantEmails: ['a@x.com', 'b@x.com', 'c@x.com'],
      }),
    );
  });

  it('refuses to let a coach hand the team to someone else', async () => {
    await seedTeam();
    const db = env.authenticatedContext(HEAD.sub, token(HEAD)).firestore();
    await assertFails(updateDoc(doc(db, 'teams', TEAM_ID), { ownerUid: STRANGER.sub }));
  });
});

describe('claiming an invitation', () => {
  it('lets an invited coach find and claim the team', async () => {
    await seedTeam({ assistantEmails: [ASSISTANT.email] });
    const db = env.authenticatedContext(ASSISTANT.sub, token(ASSISTANT)).firestore();

    // Readable before claiming, or they could never find it.
    await assertSucceeds(getDoc(doc(db, 'teams', TEAM_ID)));

    await assertSucceeds(
      updateDoc(doc(db, 'teams', TEAM_ID), {
        memberUids: [HEAD.sub, ASSISTANT.sub],
        [`roles.${ASSISTANT.sub}`]: 'ASSISTANT',
      }),
    );
  });

  it('refuses a claim as head coach', async () => {
    await seedTeam({ assistantEmails: [ASSISTANT.email] });
    const db = env.authenticatedContext(ASSISTANT.sub, token(ASSISTANT)).firestore();
    await assertFails(
      updateDoc(doc(db, 'teams', TEAM_ID), {
        memberUids: [HEAD.sub, ASSISTANT.sub],
        [`roles.${ASSISTANT.sub}`]: 'HEAD_COACH',
      }),
    );
  });

  it('refuses a claim that also changes the team', async () => {
    await seedTeam({ assistantEmails: [ASSISTANT.email] });
    const db = env.authenticatedContext(ASSISTANT.sub, token(ASSISTANT)).firestore();
    await assertFails(
      updateDoc(doc(db, 'teams', TEAM_ID), {
        memberUids: [HEAD.sub, ASSISTANT.sub],
        [`roles.${ASSISTANT.sub}`]: 'ASSISTANT',
        name: 'Renamed by an assistant',
      }),
    );
  });

  it('refuses a claim by someone who was never invited', async () => {
    await seedTeam({ assistantEmails: [ASSISTANT.email] });
    const db = env.authenticatedContext(STRANGER.sub, token(STRANGER)).firestore();
    await assertFails(
      updateDoc(doc(db, 'teams', TEAM_ID), {
        memberUids: [HEAD.sub, STRANGER.sub],
        [`roles.${STRANGER.sub}`]: 'ASSISTANT',
      }),
    );
  });

  it('refuses a claim that removes the head coach', async () => {
    await seedTeam({ assistantEmails: [ASSISTANT.email] });
    const db = env.authenticatedContext(ASSISTANT.sub, token(ASSISTANT)).firestore();
    await assertFails(
      updateDoc(doc(db, 'teams', TEAM_ID), {
        memberUids: [ASSISTANT.sub],
        [`roles.${ASSISTANT.sub}`]: 'ASSISTANT',
      }),
    );
  });
});

describe('an assistant coach', () => {
  it('can read the whole team', async () => {
    await seedWithAssistant();
    const db = env.authenticatedContext(ASSISTANT.sub, token(ASSISTANT)).firestore();
    await assertSucceeds(getDoc(doc(db, 'teams', TEAM_ID, 'players', PLAYER_ID)));
    await assertSucceeds(getDocs(collection(db, 'teams', TEAM_ID, 'games')));
  });

  it('can set where a player may play and whether they are core', async () => {
    await seedWithAssistant();
    const db = env.authenticatedContext(ASSISTANT.sub, token(ASSISTANT)).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'teams', TEAM_ID, 'players', PLAYER_ID), {
        positionRatings: { P: { eligibility: 'NEVER' } },
        overallTier: 'CORE',
        canPitch: true,
        canCatch: true,
      }),
    );
  });

  it('cannot rename a player', async () => {
    await seedWithAssistant();
    const db = env.authenticatedContext(ASSISTANT.sub, token(ASSISTANT)).firestore();
    await assertFails(
      updateDoc(doc(db, 'teams', TEAM_ID, 'players', PLAYER_ID), { firstName: 'Nope' }),
    );
  });

  it('cannot smuggle a rename alongside an allowed change', async () => {
    await seedWithAssistant();
    const db = env.authenticatedContext(ASSISTANT.sub, token(ASSISTANT)).firestore();
    await assertFails(
      updateDoc(doc(db, 'teams', TEAM_ID, 'players', PLAYER_ID), {
        overallTier: 'CORE',
        active: false,
      }),
    );
  });

  /*
    The rule is value-based, not operation-based: `affectedKeys()` reports what
    actually differs, so a whole-document write is judged by what it changes.
    That is the behaviour worth pinning down, because it is not what you would
    guess from the rule's shape.
  */
  it('may write a whole player document when only allowed values differ', async () => {
    await seedWithAssistant();
    const db = env.authenticatedContext(ASSISTANT.sub, token(ASSISTANT)).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'teams', TEAM_ID, 'players', PLAYER_ID), {
        ...playerDocument(),
        overallTier: 'CORE',
      }),
    );
  });

  it('cannot write a whole player document that changes anything else', async () => {
    await seedWithAssistant();
    const db = env.authenticatedContext(ASSISTANT.sub, token(ASSISTANT)).firestore();
    await assertFails(
      setDoc(doc(db, 'teams', TEAM_ID, 'players', PLAYER_ID), {
        ...playerDocument(),
        overallTier: 'CORE',
        firstName: 'Nope',
      }),
    );
  });

  it('cannot drop a field by omitting it from a whole-document write', async () => {
    await seedWithAssistant();
    const db = env.authenticatedContext(ASSISTANT.sub, token(ASSISTANT)).firestore();
    const { firstName: _dropped, ...withoutName } = playerDocument();
    await assertFails(
      setDoc(doc(db, 'teams', TEAM_ID, 'players', PLAYER_ID), withoutName),
    );
  });

  it('cannot add or remove players', async () => {
    await seedWithAssistant();
    const db = env.authenticatedContext(ASSISTANT.sub, token(ASSISTANT)).firestore();
    await assertFails(
      setDoc(doc(db, 'teams', TEAM_ID, 'players', 'player-2'), {
        ...playerDocument(),
        id: 'player-2',
      }),
    );
    await assertFails(deleteDoc(doc(db, 'teams', TEAM_ID, 'players', PLAYER_ID)));
  });

  it('cannot change a lineup', async () => {
    await seedWithAssistant();
    const db = env.authenticatedContext(ASSISTANT.sub, token(ASSISTANT)).firestore();
    await assertFails(
      updateDoc(doc(db, 'teams', TEAM_ID, 'games', 'game-1'), { opponent: 'Changed' }),
    );
  });

  it('cannot invite another assistant', async () => {
    await seedWithAssistant();
    const db = env.authenticatedContext(ASSISTANT.sub, token(ASSISTANT)).firestore();
    await assertFails(
      updateDoc(doc(db, 'teams', TEAM_ID), { assistantEmails: [ASSISTANT.email, 'x@y.com'] }),
    );
  });

  it('cannot promote themselves after joining', async () => {
    await seedWithAssistant();
    const db = env.authenticatedContext(ASSISTANT.sub, token(ASSISTANT)).firestore();
    await assertFails(
      updateDoc(doc(db, 'teams', TEAM_ID), {
        [`roles.${ASSISTANT.sub}`]: 'HEAD_COACH',
      }),
    );
  });
});

describe('a stranger', () => {
  it('cannot read a roster', async () => {
    await seedTeam();
    const db = env.authenticatedContext(STRANGER.sub, token(STRANGER)).firestore();
    await assertFails(getDoc(doc(db, 'teams', TEAM_ID, 'players', PLAYER_ID)));
    await assertFails(getDocs(collection(db, 'teams', TEAM_ID, 'players')));
  });

  it('cannot write anywhere in a team', async () => {
    await seedTeam();
    const db = env.authenticatedContext(STRANGER.sub, token(STRANGER)).firestore();
    await assertFails(
      updateDoc(doc(db, 'teams', TEAM_ID, 'players', PLAYER_ID), { overallTier: 'CORE' }),
    );
    await assertFails(setDoc(doc(db, 'teams', TEAM_ID, 'games', 'game-2'), { id: 'game-2' }));
  });

  it('cannot reach collections outside the model', async () => {
    const db = env.authenticatedContext(STRANGER.sub, token(STRANGER)).firestore();
    await assertFails(setDoc(doc(db, 'whatever', 'x'), { a: 1 }));
    await assertFails(getDoc(doc(db, 'users', HEAD.sub)));
  });
});

describe('the head coach', () => {
  it('can do everything within their own team', async () => {
    await seedWithAssistant();
    const db = env.authenticatedContext(HEAD.sub, token(HEAD)).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'teams', TEAM_ID, 'players', PLAYER_ID), { firstName: 'Renamed' }),
    );
    await assertSucceeds(
      setDoc(doc(db, 'teams', TEAM_ID, 'games', 'game-2'), { id: 'game-2', teamId: TEAM_ID }),
    );
    await assertSucceeds(deleteDoc(doc(db, 'teams', TEAM_ID, 'players', PLAYER_ID)));
  });

  it('cannot touch another coach’s team', async () => {
    await seedTeam();
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'teams', 'other-team'), {
        ...teamDocument(),
        id: 'other-team',
        ownerUid: STRANGER.sub,
        memberUids: [STRANGER.sub],
        roles: { [STRANGER.sub]: 'HEAD_COACH' },
      });
    });
    const db = env.authenticatedContext(HEAD.sub, token(HEAD)).firestore();
    await assertFails(getDoc(doc(db, 'teams', 'other-team')));
    await assertFails(updateDoc(doc(db, 'teams', 'other-team'), { name: 'Mine now' }));
  });
});

describe('membership rows', () => {
  it('lets an invited coach mark their own row claimed, and nothing else', async () => {
    await seedTeam({ assistantEmails: [ASSISTANT.email] });
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'teams', TEAM_ID, 'memberships', 'm1'), {
        id: 'm1',
        teamId: TEAM_ID,
        userId: null,
        email: ASSISTANT.email,
        name: 'Assistant',
        role: 'ASSISTANT',
        status: 'INVITED',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    });

    const db = env.authenticatedContext(ASSISTANT.sub, token(ASSISTANT)).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'teams', TEAM_ID, 'memberships', 'm1'), {
        userId: ASSISTANT.sub,
        status: 'ACTIVE',
      }),
    );
    await assertFails(
      updateDoc(doc(db, 'teams', TEAM_ID, 'memberships', 'm1'), { role: 'HEAD_COACH' }),
    );
  });

  it('refuses a coach claiming a row addressed to someone else', async () => {
    await seedTeam({ assistantEmails: [ASSISTANT.email, STRANGER.email] });
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'teams', TEAM_ID, 'memberships', 'm1'), {
        id: 'm1',
        teamId: TEAM_ID,
        userId: null,
        email: ASSISTANT.email,
        name: 'Assistant',
        role: 'ASSISTANT',
        status: 'INVITED',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    });
    const db = env.authenticatedContext(STRANGER.sub, token(STRANGER)).firestore();
    await assertFails(
      updateDoc(doc(db, 'teams', TEAM_ID, 'memberships', 'm1'), {
        userId: STRANGER.sub,
        status: 'ACTIVE',
      }),
    );
  });
});
