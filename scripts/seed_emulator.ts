/**
 * Seeds the Firebase emulators with a coach and a team, for the iOS app.
 *
 *   node scripts/seed_emulator.mjs        (emulators must be running)
 *
 * Creates `coach@inninggrid.test` through the Auth emulator's signInWithIdp —
 * the same call the app makes for a real Google sign-in — and writes the demo
 * season as a team that coach owns, shaped exactly as the website's
 * firestoreStore writes it: the team document with ownerUid, memberUids,
 * roles and assistantEmails, and each collection under it.
 *
 * Emulator only. The project id is `demo-inninggrid`, which the Firebase
 * tools refuse to connect to any real project.
 */
import { buildDemoDatabase } from '@/data/seed';

const PROJECT = 'demo-inninggrid';
const AUTH = 'http://127.0.0.1:9099';
const FIRESTORE = `http://127.0.0.1:8089/v1/projects/${PROJECT}/databases/(default)/documents`;

export const COACH = { email: 'coach@inninggrid.test', name: 'Test Coach' };
export const ASSISTANT = { email: 'assistant@inninggrid.test', name: 'Test Assistant' };

async function signIn(who: { email: string; name: string }): Promise<{ uid: string; idToken: string }> {
  const claims = JSON.stringify({ sub: who.email, email: who.email, email_verified: true, name: who.name });
  const response = await fetch(
    `${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=emulator-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postBody: `id_token=${claims}&providerId=google.com`,
        requestUri: 'http://localhost',
        returnSecureToken: true,
      }),
    },
  );
  const json = (await response.json()) as { localId?: string; idToken?: string; error?: unknown };
  if (!json.localId || !json.idToken) throw new Error(`sign-in failed: ${JSON.stringify(json)}`);
  return { uid: json.localId, idToken: json.idToken };
}

type Value = Record<string, unknown>;
function encode(value: unknown): Value {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) {
    return value.length ? { arrayValue: { values: value.map(encode) } } : { arrayValue: {} };
  }
  const fields = Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, encode(v)]),
  );
  return Object.keys(fields).length ? { mapValue: { fields } } : { mapValue: {} };
}

async function put(path: string, data: Record<string, unknown>) {
  const fields = (encode(data) as { mapValue: { fields: Value } }).mapValue.fields;
  const response = await fetch(`${FIRESTORE}/${path}`, {
    method: 'PATCH',
    /* The emulator's admin bypass — rules are skipped for seeding only. The
       app's own reads and writes go through the rules like production. */
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) throw new Error(`write ${path} failed: ${response.status} ${await response.text()}`);
}

export async function seed() {
  /* Start clean so a re-seed is the same seed. */
  await fetch(`http://127.0.0.1:8089/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: 'DELETE',
  });
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });

  const coach = await signIn(COACH);
  const assistant = await signIn(ASSISTANT);
  const db = await buildDemoDatabase();

  for (const team of db.teams) {
    await put(`teams/${team.id}`, {
      ...team,
      ownerUid: coach.uid,
      memberUids: [coach.uid, assistant.uid],
      roles: { [coach.uid]: 'HEAD_COACH', [assistant.uid]: 'ASSISTANT' },
      assistantEmails: [ASSISTANT.email],
    });
    const collections: Record<string, Array<{ id: string; teamId?: string | null }>> = {
      players: db.players,
      games: db.games,
      formations: db.formations.filter((f) => f.teamId === team.id),
      goals: db.goals,
      flags: db.flags,
      memberships: db.memberships,
    };
    for (const [name, documents] of Object.entries(collections)) {
      for (const document of documents.filter((d) => !d.teamId || d.teamId === team.id)) {
        await put(`teams/${team.id}/${name}/${document.id}`, document as unknown as Record<string, unknown>);
      }
    }
    console.log(
      `seeded "${team.name}": ${db.players.length} players, ${db.games.length} games ` +
        `(head coach ${COACH.email}, assistant ${ASSISTANT.email})`,
    );
  }
}
