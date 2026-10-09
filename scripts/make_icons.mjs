/**
 * Every app icon and splash screen, from the one brand mark.
 *
 *   node scripts/make_icons.mjs
 *
 * Writes the web icons (public/icons), the iOS asset catalogue and the Android
 * resource folders. A brand change is one edit to `MARK` and one re-run, which
 * matters because there are forty-odd files here and they drift the moment any
 * of them is edited by hand.
 *
 * `@capacitor/assets` does the same job, but it downloads native binaries at
 * install time and the build environment cannot reach where they live. sharp
 * is already a dependency.
 */
import sharp from 'sharp';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const NAVY = '#0d2340';
const GROUND = '#07090b';

/** The compact mark's strokes, in a 48-unit box, without any background. */
const MARK = `
  <path d="M9 8.5h30v19.5L24 41.5 9 28Z" fill="none" stroke="#ffffff" stroke-width="4" stroke-linejoin="round"/>
  <rect x="14.2" y="17.4" width="3" height="9.2" rx="1" fill="#ffffff" opacity="0.55"/>
  <rect x="18.8" y="16.4" width="10.4" height="11.2" rx="2.2" fill="#22c55e"/>
  <rect x="30.8" y="17.4" width="3" height="9.2" rx="1" fill="#ffffff" opacity="0.55"/>`;

/**
 * The mark scaled about its centre, on navy or on nothing.
 *
 * Full-bleed square on purpose: iOS and Android both mask the corners
 * themselves, and a source with its own rounded corners shows dark wedges in
 * the corners of the home-screen icon.
 */
function svg(scale, background = NAVY, radius = 0) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
    ${background ? `<rect width="48" height="48" rx="${radius}" fill="${background}"/>` : ''}
    <g transform="translate(24 24.5) scale(${scale}) translate(-24 -24.5)">${MARK}</g>
  </svg>`);
}

async function png(source, size, file) {
  await mkdir(path.dirname(file), { recursive: true });
  await sharp(source, { density: 1200 }).resize(size, size).png().toFile(file);
}

/** The mark centred on the dark ground at any size — the splash screen. */
async function splash(width, height, file) {
  const markSize = Math.round(Math.min(width, height) * 0.18);
  /* Rounded here, unlike the icons: nothing masks a splash, so a square tile
     sits on the dark ground with hard corners and looks unfinished. */
  const mark = await sharp(svg(1, NAVY, 10), { density: 1200 })
    .resize(markSize, markSize)
    .png()
    .toBuffer();
  await mkdir(path.dirname(file), { recursive: true });
  await sharp({ create: { width, height, channels: 4, background: GROUND } })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toFile(file);
}

// ---- web ------------------------------------------------------------------
await png(svg(1), 192, 'public/icons/icon-192.png');
await png(svg(1), 512, 'public/icons/icon-512.png');
await png(svg(1), 180, 'public/icons/apple-touch-icon.png');
/* Maskable icons are cropped to a circle of radius 40%; the full-size mark's
   corners overhang it by about two pixels at 512. */
await png(svg(0.78), 512, 'public/icons/icon-maskable-512.png');
await png(svg(1), 1024, 'public/icons/icon-1024.png');

// ---- iOS ------------------------------------------------------------------
const IOS = 'ios/App/App/Assets.xcassets';
if (existsSync(IOS)) {
  /* Xcode 14+ builds every icon size from one 1024 source. */
  await png(svg(1), 1024, `${IOS}/AppIcon.appiconset/AppIcon-512@2x.png`);
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    await splash(2732, 2732, `${IOS}/Splash.imageset/${name}`);
  }
}

// ---- Android --------------------------------------------------------------
const RES = 'android/app/src/main/res';
if (existsSync(RES)) {
  const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

  for (const [name, factor] of Object.entries(DENSITY)) {
    const dir = `${RES}/mipmap-${name}`;
    /* Legacy launchers (pre-8.0) use these flat icons as they are. */
    await png(svg(1), Math.round(48 * factor), `${dir}/ic_launcher.png`);
    const round = Math.round(48 * factor);
    const circle = Buffer.from(
      `<svg width="${round}" height="${round}"><circle cx="${round / 2}" cy="${round / 2}" r="${round / 2}"/></svg>`,
    );
    await sharp(svg(0.86), { density: 1200 })
      .resize(round, round)
      .composite([{ input: circle, blend: 'dest-in' }])
      .png()
      .toFile(`${dir}/ic_launcher_round.png`);

    /*
      Adaptive icons: a 108dp foreground over a solid colour, of which only the
      central 66dp is guaranteed visible after the launcher's mask. The mark is
      scaled to sit inside that — at full size the launcher would crop the
      bottom point of the plate off.
    */
    await png(svg(0.56, null), Math.round(108 * factor), `${dir}/ic_launcher_foreground.png`);
  }

  await writeFile(
    `${RES}/values/ic_launcher_background.xml`,
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Navy from the brand mark: the adaptive icon's background layer. -->
    <color name="ic_launcher_background">${NAVY}</color>
</resources>
`,
  );

  /* Splash images, regenerated at whatever size each folder already uses, so
     the portrait/landscape variants stay the shapes Android expects. */
  for (const entry of await readdir(RES)) {
    if (!entry.startsWith('drawable')) continue;
    const file = `${RES}/${entry}/splash.png`;
    if (!existsSync(file)) continue;
    const { width, height } = await sharp(file).metadata();
    await splash(width, height, file);
  }
}

console.log('icons and splash screens written for web, iOS and Android');
