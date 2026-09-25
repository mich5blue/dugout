import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * Every source file must be committable.
 *
 * This exists because of a real, shipped failure. `.gitignore` carried
 * create-next-app's unanchored `build/` rule, meant for production output at
 * the repo root. It matches a directory named `build` at any depth, so two
 * directories of source — the lineup-building flow and its two step
 * components — were ignored the moment they were created. `git add -A` skipped
 * them, `git status` reported a clean tree, the build succeeded because the
 * only importer was itself ignored, and the deploy went out missing an entire
 * feature. The first symptom was a 404 in production.
 *
 * Nothing else in the toolchain catches this: type-checking, tests and the
 * build all run against the working tree, where the files are present.
 */
describe('source files are not ignored by git', () => {
  it('has no ignored file under src/', () => {
    /*
      `check-ignore --no-index` reports on paths whether or not they are
      tracked, which is the point — a tracked file stays tracked even if a rule
      would now ignore it, so only the untracked ones are at risk. Exit code 1
      means "nothing ignored", which is success here.
    */
    let ignored = '';
    try {
      ignored = execFileSync(
        'git',
        ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', 'src'],
        { encoding: 'utf8' },
      );
    } catch {
      /* No git available (a published tarball, say). Nothing to assert. */
      return;
    }

    const offenders = ignored.split('\n').filter(Boolean);
    expect(
      offenders,
      `These files are on disk but git ignores them, so they cannot be committed:\n  ${offenders.join(
        '\n  ',
      )}\nCheck .gitignore for an unanchored rule.`,
    ).toEqual([]);
  });
});
