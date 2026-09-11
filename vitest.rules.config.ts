import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * The security-rules suite, which needs the Firestore emulator.
 *
 * It gets its own config because the default one excludes these files so that
 * `npm test` stays runnable with no emulator — and vitest applies `exclude`
 * even to test files named explicitly on the command line.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.emulator.test.ts'],
    // The emulator is a shared, stateful resource: each file clears it between
    // tests, so two files running at once would clear each other's fixtures.
    fileParallelism: false,
  },
});
