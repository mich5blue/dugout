#!/usr/bin/env node
/*
 * Validates the position-group palette in src/app/globals.css.
 *
 * Position-group colour is a categorical encoding: it carries which group a
 * position belongs to across the inning grid, the field view and the season
 * dashboard. That makes it load-bearing rather than decorative, so it gets
 * checked rather than eyeballed.
 *
 * The colours are read out of globals.css, not duplicated here, so this can
 * never drift from what actually ships.
 *
 * Seven checks per mode:
 *   1-4. Pairwise CIEDE2000 separation between the three groups under normal
 *        vision and under protanopia, deuteranopia and tritanopia.
 *   5.   Group colour as text against the card surface it sits on.
 *   6.   Group colour as text against its own -soft fill (a bright position
 *        code on a tinted cell).
 *   7.   Body ink against every -soft fill. The inning grid sets player names
 *        in --ink on a tinted cell, so this pairing is load-bearing too — and
 *        it is the one that breaks silently when a fill is retuned.
 *   8.   Every group colour against --accent, under all four visions. The
 *        accent means "held" or "pressable"; a group colour that reads like it
 *        makes a chip look like a control. This is not hypothetical — an
 *        amber/teal/indigo set shipped once whose amber sat 6.8 dE from the
 *        lime accent, and the only way anyone noticed was by eye.
 *
 * Bench is included in check 7 (the bench row uses the same treatment) but
 * excluded from the separation checks: it is a neutral standing for the
 * absence of a defensive assignment, and it is always text-labelled.
 *
 * What is deliberately NOT checked: separation between the -soft fills. Pale
 * tints on white cannot be pulled apart — light mode's fills sit about 1 dE
 * apart under protanopia, and deepening them far enough to separate breaks the
 * contrast of the code printed on top. So the fill is never the only cue. Every
 * chip that uses one also carries the saturated group colour as a left rail and
 * a text label, and those are what checks 1-6 hold to a standard. If you are
 * adding a surface that tints a block with -soft, it needs a rail and a label
 * too.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(HERE, '../src/app/globals.css');

/** Perceptual separation floor, in CIEDE2000 units. */
const MIN_DELTA_E = 8;
/** WCAG AA for normal-size text. */
const MIN_CONTRAST = 4.5;
/**
 * Separation floor between a categorical colour and the action colour. Higher
 * than MIN_DELTA_E because the confusion it prevents is a category error — "is
 * this a status or a button?" — not merely telling two categories apart.
 */
const MIN_ACCENT_DELTA_E = 15;

const GROUPS = ['battery', 'infield', 'outfield'];

// ---------------------------------------------------------------- colour math

function parseHex(hex) {
  const clean = hex.trim().replace(/^#/, '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
}

/** sRGB transfer function, inverted. */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function linearRgb(hex) {
  return parseHex(hex).map(toLinear);
}

function relativeLuminance(hex) {
  const [r, g, b] = linearRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Linear sRGB to CIE Lab, D65. */
function labOf(linear) {
  const [r, g, b] = linear;
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;

  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000. */
function deltaE00(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));

  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);

  const hp = (b, ap) => {
    if (b === 0 && ap === 0) return 0;
    const h = Math.atan2(b, ap) * deg;
    return h < 0 ? h + 360 : h;
  };
  const hp1 = hp(b1, ap1);
  const hp2 = hp(b2, ap2);

  const dL = L2 - L1;
  const dC = Cp2 - Cp1;

  let dhp;
  if (Cp1 * Cp2 === 0) dhp = 0;
  else if (Math.abs(hp2 - hp1) <= 180) dhp = hp2 - hp1;
  else if (hp2 - hp1 > 180) dhp = hp2 - hp1 - 360;
  else dhp = hp2 - hp1 + 360;
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dhp / 2) * rad);

  const Lbar = (L1 + L2) / 2;
  const Cpbar = (Cp1 + Cp2) / 2;

  let hbar;
  if (Cp1 * Cp2 === 0) hbar = hp1 + hp2;
  else if (Math.abs(hp1 - hp2) <= 180) hbar = (hp1 + hp2) / 2;
  else if (hp1 + hp2 < 360) hbar = (hp1 + hp2 + 360) / 2;
  else hbar = (hp1 + hp2 - 360) / 2;

  const T =
    1 -
    0.17 * Math.cos((hbar - 30) * rad) +
    0.24 * Math.cos(2 * hbar * rad) +
    0.32 * Math.cos((3 * hbar + 6) * rad) -
    0.2 * Math.cos((4 * hbar - 63) * rad);

  const dTheta = 30 * Math.exp(-Math.pow((hbar - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cpbar, 7) / (Math.pow(Cpbar, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbar - 50, 2)) / Math.sqrt(20 + Math.pow(Lbar - 50, 2));
  const Sc = 1 + 0.045 * Cpbar;
  const Sh = 1 + 0.015 * Cpbar * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;

  return Math.sqrt(
    Math.pow(dL / Sl, 2) +
      Math.pow(dC / Sc, 2) +
      Math.pow(dH / Sh, 2) +
      Rt * (dC / Sc) * (dH / Sh),
  );
}

/*
 * Dichromat simulation, Machado et al. 2009, severity 1.0, applied to linear
 * sRGB. Chosen over a hand-rolled LMS projection because these matrices are
 * the published, reproducible ones.
 */
const CVD = {
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function simulate(linear, matrix) {
  return matrix.map((row) =>
    Math.max(0, Math.min(1, row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2])),
  );
}

// ------------------------------------------------------------- css extraction

/**
 * Pulls the dark (`:root`) and light (`prefers-color-scheme: light`) token
 * blocks out of globals.css.
 *
 * Deliberately simple: it finds the light media query first, treats that slice
 * as the light block, and treats the first `:root` before it as the dark one.
 */
function readModes(css) {
  const lightStart = css.indexOf('@media (prefers-color-scheme: light)');
  if (lightStart === -1) throw new Error('No light-mode block found in globals.css');

  const darkSlice = css.slice(0, lightStart);
  const darkRoot = darkSlice.lastIndexOf(':root');
  if (darkRoot === -1) throw new Error('No dark :root block found in globals.css');

  return {
    dark: darkSlice.slice(darkRoot),
    light: css.slice(lightStart, css.indexOf('\n}\n', css.indexOf('}', lightStart + 40))),
  };
}

function tokens(block) {
  const found = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    // First definition wins: later ones are overrides in nested scopes.
    if (!(match[1] in found)) found[match[1]] = match[2];
  }
  return found;
}

// ------------------------------------------------------------------ the checks

function checkMode(name, vars) {
  const failures = [];
  const notes = [];

  for (const group of [...GROUPS, 'bench']) {
    if (!vars[group]) failures.push(`${name}: missing --${group}`);
    if (!vars[`${group}-soft`]) failures.push(`${name}: missing --${group}-soft`);
  }
  if (!vars.surface) failures.push(`${name}: missing --surface`);
  if (failures.length > 0) return { failures, notes };

  // Checks 1-4: pairwise separation under normal vision and three dichromacies.
  for (const [vision, matrix] of Object.entries(CVD)) {
    let worst = { delta: Infinity, pair: '' };

    for (let i = 0; i < GROUPS.length; i += 1) {
      for (let j = i + 1; j < GROUPS.length; j += 1) {
        const a = labOf(simulate(linearRgb(vars[GROUPS[i]]), matrix));
        const b = labOf(simulate(linearRgb(vars[GROUPS[j]]), matrix));
        const delta = deltaE00(a, b);
        if (delta < worst.delta) {
          worst = { delta, pair: `${GROUPS[i]}/${GROUPS[j]}` };
        }
      }
    }

    const ok = worst.delta >= MIN_DELTA_E;
    notes.push(
      `  ${ok ? 'pass' : 'FAIL'}  ${vision.padEnd(13)} worst pair ${worst.pair.padEnd(18)} dE ${worst.delta.toFixed(1)} (min ${MIN_DELTA_E})`,
    );
    if (!ok) {
      failures.push(
        `${name}/${vision}: ${worst.pair} separated by only dE ${worst.delta.toFixed(1)}, need ${MIN_DELTA_E}`,
      );
    }
  }

  // Check 5: group colour as text on the card surface.
  for (const group of GROUPS) {
    const ratio = contrastRatio(vars[group], vars.surface);
    const ok = ratio >= MIN_CONTRAST;
    notes.push(
      `  ${ok ? 'pass' : 'FAIL'}  ${group.padEnd(13)} on surface${' '.repeat(18)}${ratio.toFixed(2)}:1 (min ${MIN_CONTRAST})`,
    );
    if (!ok) {
      failures.push(
        `${name}: --${group} on --surface is ${ratio.toFixed(2)}:1, need ${MIN_CONTRAST}`,
      );
    }
  }

  // Check 6: group colour as text on its own tinted fill.
  for (const group of GROUPS) {
    const ratio = contrastRatio(vars[group], vars[`${group}-soft`]);
    const ok = ratio >= MIN_CONTRAST;
    notes.push(
      `  ${ok ? 'pass' : 'FAIL'}  ${group.padEnd(13)} on ${group}-soft${' '.repeat(Math.max(1, 13 - group.length))}${ratio.toFixed(2)}:1 (min ${MIN_CONTRAST})`,
    );
    if (!ok) {
      failures.push(
        `${name}: --${group} on --${group}-soft is ${ratio.toFixed(2)}:1, need ${MIN_CONTRAST}`,
      );
    }
  }

  // Check 8: group colours must not be mistakable for the action colour.
  if (!vars.accent) {
    failures.push(`${name}: missing --accent`);
  } else {
    for (const group of GROUPS) {
      let worst = { delta: Infinity, vision: '' };
      for (const [vision, matrix] of Object.entries(CVD)) {
        const a = labOf(simulate(linearRgb(vars[group]), matrix));
        const b = labOf(simulate(linearRgb(vars.accent), matrix));
        const delta = deltaE00(a, b);
        if (delta < worst.delta) worst = { delta, vision };
      }
      const ok = worst.delta >= MIN_ACCENT_DELTA_E;
      notes.push(
        `  ${ok ? 'pass' : 'FAIL'}  ${group.padEnd(13)} vs accent${' '.repeat(18)}dE ${worst.delta.toFixed(1)} (min ${MIN_ACCENT_DELTA_E}, ${worst.vision})`,
      );
      if (!ok) {
        failures.push(
          `${name}: --${group} is only dE ${worst.delta.toFixed(1)} from --accent under ${worst.vision}, need ${MIN_ACCENT_DELTA_E}`,
        );
      }
    }
  }

  // Check 7: body ink on every tinted fill — the grid's player names.
  if (!vars.ink) {
    failures.push(`${name}: missing --ink`);
    return { failures, notes };
  }
  for (const group of [...GROUPS, 'bench']) {
    const ratio = contrastRatio(vars.ink, vars[`${group}-soft`]);
    const ok = ratio >= MIN_CONTRAST;
    notes.push(
      `  ${ok ? 'pass' : 'FAIL'}  ink${' '.repeat(11)}on ${group}-soft${' '.repeat(Math.max(1, 13 - group.length))}${ratio.toFixed(2)}:1 (min ${MIN_CONTRAST})`,
    );
    if (!ok) {
      failures.push(
        `${name}: --ink on --${group}-soft is ${ratio.toFixed(2)}:1, need ${MIN_CONTRAST}`,
      );
    }
  }

  return { failures, notes };
}

// ------------------------------------------------------------------------ main

const css = readFileSync(CSS_PATH, 'utf8');
const modes = readModes(css);

let allFailures = [];

for (const [name, block] of Object.entries(modes)) {
  const vars = tokens(block);
  const { failures, notes } = checkMode(name, vars);
  const trio = GROUPS.map((g) => vars[g] ?? '?').join(', ');

  console.log(`\n${name} mode  (${trio})`);
  for (const note of notes) console.log(note);
  allFailures = allFailures.concat(failures);
}

if (allFailures.length > 0) {
  console.error(`\n${allFailures.length} palette check(s) failed:\n`);
  for (const failure of allFailures) console.error(`  - ${failure}`);
  console.error('');
  process.exit(1);
}

console.log('\nAll palette checks passed.\n');
