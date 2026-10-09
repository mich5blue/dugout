import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android app.
 *
 * iOS is a native SwiftUI app now (apps/ios, docs/ios/architecture.md) and no
 * longer uses this shell. Android still wraps the website until a native
 * Android app is scoped.
 *
 * They load the deployed web app rather than a bundled copy of it, for one
 * reason that outweighs the rest: the App Router's links fetch a server payload
 * for each route (`/games/<id>`), and a static export cannot produce payloads
 * for game ids that do not exist until a coach creates them. A bundled build
 * would boot, then fall over on the first tap into a game.
 *
 * What remote loading costs, and how it is covered:
 *
 *  - Cold start needs a connection. After that, Firestore's persistent cache
 *    carries the dugout — reads come from the device, writes queue. With no
 *    connection at all on launch, `errorPath` shows a page that says so
 *    instead of a white screen.
 *  - Every web deploy reaches the apps immediately, with no App Store review.
 *    That is the point, not a side effect: fixes still ship in minutes.
 *
 * `appId` is the bundle identifier and CANNOT change once the app is in App
 * Store Connect. Confirm it before the first upload.
 */
const SERVER_URL = process.env.CAP_SERVER_URL ?? 'https://dugout-lineups.netlify.app';

/*
  Plain http is only ever a local dev server — `CAP_SERVER_URL=http://
  localhost:3001 npx cap sync`, to run the native shell against `npm run dev`
  without a deploy. Production is always https, and cleartext stays off for it.
*/
const CLEARTEXT = SERVER_URL.startsWith('http://');

const config: CapacitorConfig = {
  appId: 'com.inninggrid.app',
  appName: 'InningGrid',
  webDir: 'native/www',
  server: {
    url: SERVER_URL,
    cleartext: CLEARTEXT,
    /* A local file, so it renders with no network — which is exactly when it
       is needed. */
    errorPath: 'offline.html',
    /*
      Firebase Auth hops through its own domain on the way back from sign-in.
      Without these the web view treats that hop as leaving the app and opens
      Safari, which breaks the round trip.
    */
    allowNavigation: [
      new URL(SERVER_URL).host,
      'dugout-lineups.netlify.app',
      '*.firebaseapp.com',
      '*.googleapis.com',
      /* accounts.google.com is deliberately absent: Google refuses OAuth in a
         web view, so letting the app navigate there only shows its error page.
         Native sign-in (docs/native.md) never needs it. */
    ],
  },
  ios: {
    /* The web app pads itself by the safe-area insets, so the native shell
       must not add its own on top — that would double the gap under the
       notch. */
    contentInset: 'never',
    backgroundColor: '#07090b',
    /* No long-press link previews. A coach holding a finger on a schedule
       row should get the row, not a floating preview of a web page. */
    allowsLinkPreview: false,
  },
  android: {
    backgroundColor: '#07090b',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: '#07090b',
      showSpinner: false,
    },
    StatusBar: {
      /* Light text on the dark ground, drawn over the web view so the app
         runs edge to edge under the clock. */
      style: 'DARK',
      overlaysWebView: true,
    },
  },
};

export default config;
