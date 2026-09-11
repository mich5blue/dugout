import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /*
      The rules tests need the Firestore emulator, so they are not part of the
      default run — `npm test` has to work on a plane. `npm run test:rules`
      starts an emulator and runs them.
    */
    exclude: ['**/node_modules/**', 'src/**/*.emulator.test.ts'],
  },
});
