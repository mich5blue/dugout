// Bundles scripts/seed_emulator.ts (it imports the app's own demo seed) and runs it.
import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const out = path.join(process.env.TMPDIR ?? '/tmp', 'inninggrid-seed.mjs');
await build({
  entryPoints: ['scripts/seed_emulator.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  alias: { '@': path.resolve('src') },
  logLevel: 'warning',
});
const { seed } = await import(pathToFileURL(out).href);
await seed();
