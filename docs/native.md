# The iOS and Android apps

InningGrid ships three ways from one codebase: the website, an installable web
app (Add to Home Screen), and native iOS and Android apps built with Capacitor.
They are the same web app — there is no second UI to keep in step.

## How it works

The native apps load the deployed site (`server.url` in `capacitor.config.ts`)
inside a native shell, rather than a bundled copy.

**Why not bundle it.** The App Router's links fetch a server payload per route.
A static export can only produce those for routes known at build time, and game
ids do not exist until a coach creates them — a bundled build boots, then falls
over on the first tap into a game.

**What that buys.** Every web deploy reaches the apps immediately, without App
Store review. Fixes still ship in minutes.

**What it costs, and how it is covered.**

- A cold start needs a connection. After that, Firestore's persistent cache
  carries the dugout — reads come from the device, writes queue until signal
  returns. With no connection at launch, the shell shows `native/www/offline.html`
  instead of a white screen.
- Apple reviews thin web wrappers under guideline 4.2 (minimum functionality).
  The native pieces here — haptics on Game Day, the status bar, the hardware
  back button, offline handling, and native sign-in below — are what make it an
  app rather than a bookmark. Expect to explain that in review notes.

## Before the first build

### 1. Confirm the bundle identifier — it cannot change later

`appId` in `capacitor.config.ts` is `com.inninggrid.app`. Once an app exists in
App Store Connect under that identifier, it is permanent. If you want a
different one (your own domain, reversed), change it now in
`capacitor.config.ts`, then in Xcode (target → Signing & Capabilities) and in
`android/app/build.gradle` (`applicationId`).

### 2. Native Google sign-in — not wired yet

**Signing in does not work inside the native apps today.** Google refuses OAuth
in an embedded web view (`403 disallowed_useragent`), and an email link opens
in Safari and signs Safari in, not the app. The sign-in screen says so in the
app and offers the demo team instead of a broken button.

The fix is native Google Sign-In via `@capacitor-firebase/authentication`,
which needs two files only you can download:

1. Firebase console → Project settings → **Add app → iOS**, bundle id
   `com.inninggrid.app`. Download `GoogleService-Info.plist`.
2. **Add app → Android**, package `com.inninggrid.app`, with the SHA-1 of your
   signing key (`keytool -list -v -keystore <your.keystore>`). Download
   `google-services.json`.
3. Hand both files over and the plugin, the URL scheme and the sign-in code get
   wired in one pass.

Not installed ahead of the files on purpose: the plugin configures Firebase at
launch, and without `GoogleService-Info.plist` the iOS app would build and then
crash on open.

### 3. Firebase authorized domains

The web app must still have `dugout-lineups.netlify.app` in Firebase → Auth →
Settings → Authorized domains, or Google sign-in fails on the website too.

## Building

```bash
npm run native:sync   # copy config and plugins into ios/ and android/
npm run ios           # sync, then open Xcode
npm run android       # sync, then open Android Studio
```

The generated `capacitor.config.json` inside each native project is
git-ignored — it is rebuilt by `cap sync`. **Run a sync after cloning** or
Xcode will build an app with no config.

### Against a local dev server

```bash
npm run dev          # in one terminal
npm run native:dev   # points the native projects at http://localhost:3001
```

Then build from Xcode or Android Studio. **Run `npm run native:sync` before
archiving** — `native:dev` leaves the projects pointed at your laptop, and an
archive built that way ships an app that opens to the offline page for every
user.

## Shipping

### iOS (TestFlight, then the App Store)

1. `npm run ios`.
2. Xcode → App target → Signing & Capabilities → choose your Team.
3. Set Version and Build in the General tab.
4. Product → Destination → Any iOS Device → Product → Archive.
5. Organizer → Distribute App → App Store Connect → Upload.
6. In App Store Connect, add it to TestFlight first.

### Android (Play Console)

1. `npm run android`. Let Gradle sync on first open.
2. Build → Generate Signed App Bundle → create a keystore. **Back the keystore
   up** — losing it means you can never update the app.
3. Upload the `.aab` to an internal testing track in Play Console first.

## Icons and splash screens

Every icon and splash for web, iOS and Android comes from one mark in
`scripts/make_icons.mjs`:

```bash
npm run icons
```

Re-run after any brand change. Do not edit the generated PNGs by hand — there
are forty-odd of them and they drift.

## Known environment quirk

On a machine behind a TLS-inspecting corporate proxy, the iOS Simulator cannot
load the production site at all ("This Connection Is Not Private" in Safari,
the offline page in the app), because the simulator does not trust the proxy's
certificate. Use `npm run native:dev` there, or test on a real device.
