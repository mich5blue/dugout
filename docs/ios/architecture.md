# InningGrid for iOS — architecture

A native SwiftUI app that shares accounts, teams and season history with the
web app at dugout-lineups.netlify.app. Written before the build, as the record
of why it is shaped the way it is.

## The one constraint everything follows from

> Web and iOS must produce the same lineup from the same inputs, and the iOS
> app must still work in a dugout with no signal.

Those two requirements rule out the obvious designs:

| Option | Same results? | Works offline? | Verdict |
| --- | --- | --- | --- |
| Port the optimizer to Swift | No — two engines drift the first time either changes | Yes | Rejected |
| Server API (Netlify function) running the TS engine | Yes | **No** — Smart Repair is needed exactly where there is no signal | Rejected as the primary path |
| **Run the same TS bundle inside JavaScriptCore** | **Yes — it is the same code** | **Yes** | **Chosen** |

The engine (`src/optimizer`) and every domain service (`src/services`,
`src/domain`, the game-view and game-day libraries) are pure TypeScript. The
only platform call in the whole tree is `crypto.randomUUID`, already behind a
fallback. So `src/core/api.ts` exposes them as JSON-in, JSON-out functions;
esbuild bundles that into one file; the iOS app ships it and runs it in
JavaScriptCore, which is part of iOS.

## Data: raw documents, not Swift models

Every Firestore document is a whole TypeScript object (`Game`, `Player`, …)
under `teams/{teamId}/{players|games|formations|goals|flags|memberships}`.

If Swift decoded those into its own structs and wrote them back, any field it
did not know about would be dropped — and the next field the web adds would be
silently erased by every iOS save. So:

- **The raw JSON document is the source of truth on iOS.** It is cached and
  synced as-is.
- **Swift models are read-only views**, decoded for display.
- **Every mutation goes through the shared core** — `setAssignment`,
  `setAvailability`, `recordActualResults`, `toggleLock` — which takes the raw
  document and returns the raw document, exactly as on the web.

No business rule is written twice.

## Backend: the existing Firebase project, over REST

No new backend, no new schema, no change to the web app's data.

- **Firestore REST API** with the user's Firebase ID token. The existing
  `firestore.rules` enforce team permissions server-side, exactly as for the
  web — a changed identifier gets a 403, not another team's roster.
- **Firebase Auth REST API** for tokens; refresh token in the **Keychain**,
  never `UserDefaults`.

REST rather than the Firebase iOS SDK, for three reasons: the SDK needs a
`GoogleService-Info.plist` from the Firebase console before it will even start;
REST exposes each document's `updateTime`, which is what conflict detection
needs; and an explicit cache-plus-outbox lets the app *say* what is pending,
which the SDK's hidden queue does not.

## Sign-in with an existing web account

Google refuses OAuth inside an app's web view, and native Google Sign-In needs
an iOS OAuth client registered in the Firebase console. Neither is required:

1. The app opens `ASWebAuthenticationSession` — a real Safari sheet, which
   Google allows — at `/native-auth` on the existing site, with a random
   `state`.
2. That page signs in with the **existing web Firebase sign-in** (Google, or an
   email link), then redirects to `inninggrid://auth` carrying the short-lived
   Google ID token, or the email link's one-time code, plus the same `state`.
3. The app checks `state`, then exchanges the credential with Firebase Auth REST
   (`signInWithIdp` / `signInWithEmailLink`).

Same Firebase project, same provider, **same uid** — so the coach's teams are
there the moment they sign in. Only `ASWebAuthenticationSession` receives the
callback, which closes the URL-scheme hijacking hole a plain `openURL` leaves.

## Sync

- **Cache:** every document stored locally with its Firestore `updateTime`.
  Reads come from the cache; a refresh happens on launch, on foreground, and on
  pull.
- **Outbox:** a write records the document and the `updateTime` it was based
  on, then sends with `currentDocument.updateTime` as a precondition.
- **Conflicts:** a failed precondition means another coach — on the web or
  another phone — changed it first. Nothing is overwritten; the coach chooses.
- **Status is always visible:** synced, pending upload, offline, or conflict.
  The app never calls an unsynced edit saved.
- **Refused writes:** if the Firestore rules refuse an edit (an assistant
  changing something only a head coach may), the edit is rolled back to the
  server's version, the coach is told once, and the rest of the queue keeps
  uploading. Retrying a refused write can never succeed, so it must not block.

## Verification without touching real data

Automated and manual verification run against the **Firebase emulators**
(Auth + Firestore) with `firestore.rules` loaded, seeded with the demo team.
Production data is read-only to anything automated.

## Shared rules, not copied rules

Anything that decides *what a change means* lives in TypeScript and is called
from both platforms. When the iOS work found such logic inside a web
component, it was moved out to a shared module and the web component was
pointed at it:

| Module | What it decides |
| --- | --- |
| `src/lib/attendance.ts` | Here / Part / Out, and "same as last game" |
| `src/domain/ruleControls.ts` | which rules How-to-coach shows, their options, how a pick becomes settings |
| `src/lib/relaxations.ts` | the engine's one-tap fixes (the game page had a second copy) |
| `src/lib/lineupEdits.ts` | move / rest a player, reorder and rotate the batting order |
| `src/lib/playerEdits.ts` | eligibility cycling; every player edit through the role filter |
| `src/services/liveGame.ts` | finish, keep the pitcher in, someone has to come out |

Swift holds only presentation and transport. The Swift `Codable` models are
read-only views; a save always sends the document the core returned.

## Tests

- `npm test` — the TypeScript suite, including the shared modules above.
- `npm run check:parity` — the shipped bundle on V8 and on macOS's
  JavaScriptCore must build byte-identical lineups. Writes the V8 output to
  `apps/ios/parity/expected.json`.
- `npm run ios:test` — the Swift tests, on a simulator: iOS's own
  JavaScriptCore must match that file; Firestore value encoding; and sync
  (offline edits kept and uploaded later, another coach's newer edit becomes
  a conflict rather than an overwrite, a refused edit is rolled back without
  blocking the queue).

## Running it

```
npm run emulators            # Auth 9099 + Firestore 8089, rules loaded
npm run seed:emulator        # demo team for coach@ and assistant@inninggrid.test
npm run ios:config           # writes the (gitignored) Config.json
open apps/ios/InningGrid.xcodeproj
```

Debug builds talk to the emulators and show "Sign in as test head coach /
assistant" buttons. To point a Debug build at the real project on your own
phone, set `INNINGGRID_ENV=production` in the scheme. Release builds always
use production.

DEBUG-only launch arguments drive the app headlessly for screenshots and UI
tests: `-uiTestSignIn <email>`, `-uiTestTab season`, `-uiTestRoute
game:<id>` (also `build:`, `live:`, `player:`), `-uiTestStep 0-3`,
`-uiTestGenerate YES`, `-uiTestSection batting`, `-uiTestCell <player>:<inning>`.

## Project layout

```
src/core/api.ts                 the shared JSON-in/JSON-out surface
scripts/build_core.mjs          esbuild → apps/ios/.../inninggrid-core.js
apps/ios/InningGrid.xcodeproj   synchronized folders: a new file needs no
apps/ios/InningGrid/            project-file edit
  App/          entry, tabs and navigation, Workspace (store + engine)
  Core/         JavaScriptCore bridge to the shared engine
  Cloud/        Auth, Firestore REST, Keychain, cache, outbox
  Model/        read-only Codable views over raw documents
  UI/           theme, components, the field diagram
  Screens/      Home, Schedule, Roster, Player, Builder, Lineup, Game Day,
                Season, More, Sign-in
apps/ios/InningGridTests/       engine parity, codec, sync
apps/ios/parity/                the cross-engine harness and its golden output
src/app/native-auth/            the sign-in bridge pages
```

The Capacitor iOS shell is retired in favour of this app. The Capacitor
Android shell stays until an Android app is scoped.
