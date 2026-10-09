/**
 * Writes the iOS app's Firebase config from the web's environment.
 *
 *   node scripts/ios_config.mjs
 *
 * Reads NEXT_PUBLIC_FIREBASE_* from .env.local (or .env.local.bak) — the same
 * values the website already ships in its public JavaScript, so nothing here
 * is a secret. The output is git-ignored anyway, matching how the web keeps
 * its env file out of the repo.
 *
 * Debug builds use the Firebase emulators whatever this file says, so nothing
 * run during development can write to a real team. See AppConfig.swift.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = 'apps/ios/InningGrid/Resources/Config.json';
const source = ['.env.local', '.env.local.bak'].find((file) => existsSync(file));

const env = {};
if (source) {
  for (const line of readFileSync(source, 'utf8').split('\n')) {
    const match = /^\s*(NEXT_PUBLIC_FIREBASE_[A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

const production = env.NEXT_PUBLIC_FIREBASE_API_KEY && env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  ? {
      apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
      projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    }
  : null;

writeFileSync(
  OUT,
  JSON.stringify(
    {
      /* Where /native-auth lives — the sign-in bridge for existing web accounts. */
      webOrigin: 'https://dugout-lineups.netlify.app',
      production,
      emulator: { projectId: 'demo-inninggrid', apiKey: 'emulator-key', host: '127.0.0.1' },
    },
    null,
    2,
  ) + '\n',
);
console.log(`wrote ${OUT} (${production ? `production project ${production.projectId}` : 'emulator only'}, from ${source ?? 'no env file'})`);
