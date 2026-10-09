/**
 * Proves the web and the iOS app build the same lineup.
 *
 *   node scripts/check_parity.mjs
 *
 * Runs the shipped core bundle through apps/ios/parity/harness.js on V8 (the
 * engine behind Chrome, Edge and this Node) and on JavaScriptCore (the engine
 * inside every iPhone, via the jsc binary macOS ships), and fails unless the
 * two print identical output — every defensive cell, every batting slot, the
 * score, the rule checks, the explanations and the season debts.
 *
 * Why it can pass at all: the engine uses only + - * / and comparisons, which
 * IEEE 754 defines exactly. No Math.exp, no Math.log — the functions engines
 * are allowed to round differently. Keep it that way; this test is the alarm.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const BUNDLE = 'apps/ios/InningGrid/Resources/inninggrid-core.js';
const HARNESS = 'apps/ios/parity/harness.js';
const EXPECTED = 'apps/ios/parity/expected.json';
const JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc';

function onV8() {
  return new Promise((resolve, reject) => {
    const lines = [];
    const context = vm.createContext({ console: { log: (s) => lines.push(String(s)) } });
    /* A fresh context with no crypto, so createId takes the same Math.random
       path it takes in the jsc shell. */
    vm.runInContext(readFileSync(BUNDLE, 'utf8'), context);
    vm.runInContext(readFileSync(HARNESS, 'utf8'), context);
    const started = Date.now();
    const wait = () => {
      if (lines.length) return resolve(lines.join('\n'));
      if (Date.now() - started > 60_000) return reject(new Error('V8 run timed out'));
      setTimeout(wait, 20);
    };
    wait();
  });
}

function onJavaScriptCore() {
  return execFileSync(JSC, [BUNDLE, HARNESS], { encoding: 'utf8', timeout: 120_000 }).trim();
}

const v8 = await onV8();
const jsc = onJavaScriptCore();

for (const [engine, output] of [['V8', v8], ['JavaScriptCore', jsc]]) {
  if (output.startsWith('ERROR')) {
    console.error(`${engine} failed:\n${output}`);
    process.exit(1);
  }
}

const a = JSON.parse(v8);
const b = JSON.parse(jsc);
if (v8 === jsc) {
  /* The Swift test target runs the same harness inside iOS's own
     JavaScriptCore — the framework on the phone, not this jsc shell — and
     compares against this file. */
  writeFileSync(EXPECTED, `${v8}\n`);
  console.log(
    `PARITY OK — V8 and JavaScriptCore agree on ${a.game1.defensive.length + a.game2.defensive.length} ` +
      `defensive cells, ${a.game1.batting.length + a.game2.batting.length} batting slots, ` +
      `scores ${a.game1.score}/${a.game2.score}, and ${a.debts.length} season debts.`,
  );
} else {
  for (const key of Object.keys(a)) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) console.error(`  differs: ${key}`);
  }
  console.error('PARITY FAILED — the engines built different lineups from the same inputs.');
  process.exit(1);
}
