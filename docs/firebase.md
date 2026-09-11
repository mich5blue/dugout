# Backend setup (Firebase)

Dugout stores teams in Firestore and signs coaches in with Firebase Auth. Both
are on Firebase's free Spark plan, which needs no card on file.

Until a project is configured the app falls back to browser storage, so
development and both test suites work with nothing attached.

## Why Firebase, and why it stays free

| | |
|---|---|
| Firestore (Spark) | 1 GiB stored, 50k reads and 20k writes per day |
| Auth | unlimited for Google and email-link sign-in |
| Cloud Functions | **not used** — they require the paid Blaze plan |

A team of twelve with a full season of games is a few hundred documents, well
under a megabyte. The read budget is the one worth watching: the app opens a
live listener per collection per team, so a coach's session costs on the order
of a hundred reads. Fifty thousand a day is not a constraint at this scale.

Everything runs from the browser against Firestore directly. There is no server
to host and no function to invoke, which is what keeps the cost at zero and why
the security rules carry the whole permission model.

## One-time setup

Steps 1–4 are in the Firebase console; step 5 is a command.

1. **Create a project** at <https://console.firebase.google.com>. Analytics is
   not needed.
2. **Add a web app** (the `</>` icon). Copy the `firebaseConfig` values it
   shows — `apiKey`, `authDomain`, `projectId`, `appId`.
3. **Create the Firestore database**: Build → Firestore Database → Create
   database → *production mode*. The region only matters for latency; pick the
   one nearest your league.
4. **Enable sign-in**: Build → Authentication → Get started, then enable
   **Google** and **Email/Password** with *Email link (passwordless sign-in)*
   switched on. Under Settings → Authorized domains, add your Netlify domain.
5. **Deploy the rules** (`firestore.rules` in this repo):

   ```sh
   npx firebase login
   npx firebase deploy --only firestore:rules --project <your-project-id>
   ```

   Deploying the rules is not optional. A database created in production mode
   denies everything until they are deployed, and one created in test mode
   allows *everyone* to read every roster.

Then set the config on Netlify and redeploy:

```sh
netlify env:set NEXT_PUBLIC_FIREBASE_API_KEY "..."
netlify env:set NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN "<project-id>.firebaseapp.com"
netlify env:set NEXT_PUBLIC_FIREBASE_PROJECT_ID "<project-id>"
netlify env:set NEXT_PUBLIC_FIREBASE_APP_ID "..."
```

For local development, put the same four values in `.env.local` (see
`.env.example`).

## Data shape

```
teams/{teamId}                     the team, plus who may reach it
  players/{playerId}
  games/{gameId}
  formations/{formationId}         custom formations only; presets are code
  goals/{goalId}
  flags/{flagId}
  memberships/{membershipId}       the coach list, including pending invites
```

One team is one subtree. That is what makes the rules legible: access to
everything about a team is decided by the team document above it.

The team document carries four access fields alongside the team itself:

| Field | Purpose |
|---|---|
| `ownerUid` | the head coach who created it; the only account that may delete it |
| `memberUids` | every coach who has signed in and claimed a place |
| `assistantEmails` | invited assistants who have not signed in yet |
| `roles` | `uid → HEAD_COACH \| ASSISTANT`, read by the rules and the UI |

`assistantEmails` exists because an invited coach has no uid until their first
sign-in, and the rules need something to match them on.

## Who can do what

`firestore.rules` is the enforcement. `src/domain/access.ts` decides what the UI
offers — hiding a button is a courtesy, not a control.

- A **head coach** may do anything within their own team's subtree, and nothing
  outside it.
- An **assistant coach** may read all of it and change exactly four fields on a
  player: `positionRatings`, `overallTier`, `canPitch`, `canCatch`. Not a name,
  not the active flag, not a lineup.
- Anyone else is refused, signed in or not.

The assistant's allow-list is written twice — in the rules and in
`ASSISTANT_EDITABLE_PLAYER_FIELDS` — and `src/data/firestoreRules.test.ts`
fails if the two drift.

The rule is **value-based, not operation-based**: `affectedKeys()` reports what
a write actually changes, so an assistant sending a whole player document is
allowed if nothing outside those four fields differs, and refused the moment
something else does. That is worth knowing before reading the rules, because it
is not what their shape suggests.

## Testing the rules

31 tests run the rules against the Firestore emulator:

```sh
npm run test:rules      # starts an emulator, runs the suite, shuts it down
```

They need Java (the Firestore emulator is a JVM process), which is why they are
excluded from `npm test` — the default suite has to run on a plane. `npm run
test:all` runs both.

What they cover: a stranger cannot read a roster; an assistant cannot rename a
player, smuggle a rename alongside a permitted change, drop a field by omitting
it, invite another assistant, or promote themselves; an invited coach can find
and claim the team but only as an assistant, and only by adding their own uid;
only the owner can delete; the two-assistant cap holds; and nothing outside the
model is reachable.

## Moving existing data up

A coach who used Dugout before this shipped has a team in browser storage. On
first sign-in the dashboard offers to move it, once, explicitly — see
`src/components/MoveLocalData.tsx`. Silently uploading someone's roster is not a
decision to make for them.

## Offline

Firestore's local cache is enabled with `persistentLocalCache`, single-tab.
This is not a nicety: coaches use this standing on a field with one bar of
signal. Reads come from cache and writes queue until the connection returns.

Single-tab rather than multi-tab because two tabs editing the same lineup is not
a case worth the coordination cost.

## What is deliberately not here

- **Cloud Functions**, because they require the Blaze plan. Everything the app
  needs happens in the client under the rules.
- **Invitation emails.** Sending mail needs a server or a paid extension. The
  head coach adds an assistant's address and sends them the site link; the
  assistant signs in with that address and the team appears. The invitation is
  the address on the team document, not a message.
- **A users collection.** Nothing needs a profile document, and the rules deny
  it, so there is no place for a stray display name or email to accumulate.
