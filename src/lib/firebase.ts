import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentSingleTabManager,
  type Firestore,
} from 'firebase/firestore';

/**
 * Firebase wiring.
 *
 * The config is public by design — a Firebase web config identifies the
 * project, it does not authorize anything. Access is decided by Firestore
 * security rules (`firestore.rules`), which is why those rules, not this file,
 * are where the permission model has to be correct.
 *
 * Every value is optional at build time. With nothing configured the app falls
 * back to browser storage, so `npm run dev`, the test suites and the demo team
 * all work with no project attached.
 */

export interface FirebaseSettings {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

/**
 * Reads the config from the environment.
 *
 * These are `NEXT_PUBLIC_`, so Next.js inlines them at build time: changing
 * them in Netlify requires a redeploy, not just a restart.
 */
export function firebaseSettings(): FirebaseSettings | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

  // All four or none: a half-configured project fails at the first write, which
  // is a much worse place to find out than at startup.
  if (!apiKey || !authDomain || !projectId || !appId) return null;

  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  };
}

export function isFirebaseConfigured(): boolean {
  return firebaseSettings() !== null;
}

let cachedApp: FirebaseApp | null = null;
let cachedDb: Firestore | null = null;
let cachedAuth: Auth | null = null;

/**
 * Whether to talk to the local emulators instead of a real project.
 *
 * Set by the end-to-end suite, which runs the whole signed-in app — the store,
 * the rules and the sign-in flow — against emulators. Without it that path
 * would ship untested, because a real project cannot be part of a test run.
 */
export function usingEmulators(): boolean {
  return process.env.NEXT_PUBLIC_FIREBASE_EMULATOR === '1';
}

function app(): FirebaseApp {
  if (cachedApp) return cachedApp;
  const settings = firebaseSettings();
  if (!settings) throw new Error('Firebase is not configured');
  cachedApp = getApps().length > 0 ? getApp() : initializeApp(settings);
  return cachedApp;
}

export function firebaseAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  cachedAuth = getAuth(app());
  if (usingEmulators()) {
    connectAuthEmulator(cachedAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  return cachedAuth;
}

export function firestore(): Firestore {
  if (cachedDb) return cachedDb;
  cachedDb = initializeFirestore(app(), {
    /*
      Offline persistence is not a nicety here: coaches use this standing on a
      field with one bar of signal, so reads come from cache and writes queue
      until the connection returns. Single tab, because two tabs editing the
      same lineup is not a case worth the coordination cost.

      Against the emulator the cache is in memory instead: persisting it would
      carry one test's team into the next run.
    */
    localCache: usingEmulators()
      ? memoryLocalCache()
      : persistentLocalCache({ tabManager: persistentSingleTabManager({}) }),
    /*
      The domain types use optional fields throughout, and Firestore rejects
      `undefined` unless told to skip it. Skipping matches how the browser store
      behaved via JSON, so absent and undefined stay interchangeable.
    */
    ignoreUndefinedProperties: true,
  });
  if (usingEmulators()) connectFirestoreEmulator(cachedDb, '127.0.0.1', 8089);
  return cachedDb;
}
