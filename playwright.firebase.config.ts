import { defineConfig, devices } from '@playwright/test';

const PORT = 3211;

/**
 * End-to-end coverage of the signed-in app, against the Firebase emulators.
 *
 * This is the only place the backend path runs: sign-in, the Firestore store,
 * the security rules and the assistant's restrictions, exercised through the
 * real UI. A real project cannot be part of a test run, so without this the
 * whole backend would ship on inspection alone.
 *
 * `npm run test:e2e:firebase` starts the emulators, builds with an emulator
 * config, and runs this.
 */
export default defineConfig({
  testDir: './e2e-firebase',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
