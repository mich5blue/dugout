import { expect, test } from '@playwright/test';

/**
 * Browser end-to-end coverage of the coach's actual path through the product.
 * Everything is stored in the browser, so each test starts from a clean slate.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

const ROSTER = [
  'Brody Borek #8',
  'Race Smith #12',
  'Weston Jones #4',
  'Calvin Miller #7',
  'Emerson Reed #2',
  'Solomon Fisk',
  'Finnegan Doyle',
  'Vasil Petrov',
  'Mehki Barnes',
  'Ashur Haddad',
  'Walter Nash',
];

test('the guided setup walks a new coach through a working team', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /Smart lineups for youth baseball/i }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Create your team' }).click();

  // Step 1 — team. Continue is blocked until the team has a name.
  await expect(page.getByText('Step 1 of 6')).toBeVisible();
  const continueButton = page.getByRole('button', { name: 'Continue' });
  await expect(continueButton).toBeDisabled();
  await page.getByLabel('Team name').fill('Balsam Waters');
  await page.getByRole('radio', { name: 'Baseball' }).click();
  await expect(continueButton).toBeEnabled();
  await continueButton.click();

  // Step 2 — roster.
  await expect(page.getByText('Step 2 of 6')).toBeVisible();
  await expect(continueButton).toBeDisabled();
  await page.getByPlaceholder(/Brody Borek/).fill(ROSTER.join('\n'));
  await expect(page.getByText('11 players', { exact: true })).toBeVisible();
  await continueButton.click();

  // Step 3 — defense. Tells the coach the consequence of the formation.
  await expect(page.getByText('Step 3 of 6')).toBeVisible();
  await page.getByRole('button', { name: /10 players/ }).first().click();
  await expect(page.getByText(/1 player sits each inning/)).toBeVisible();
  await continueButton.click();

  // Step 4 — battery. Blocked until there is a pitcher and a catcher.
  await expect(page.getByText('Step 4 of 6')).toBeVisible();
  await expect(continueButton).toBeDisabled();
  await expect(page.getByText('Pick at least one of each')).toBeVisible();

  const pitchGroup = page.getByRole('group', { name: 'Can pitch' });
  const catchGroup = page.getByRole('group', { name: 'Can catch' });
  for (const name of ['Brody', 'Race', 'Weston']) {
    await pitchGroup.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  }
  for (const name of ['Calvin', 'Vasil', 'Mehki']) {
    await catchGroup.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  }

  await expect(page.getByText(/plenty to rotate/)).toBeVisible();
  await expect(continueButton).toBeEnabled();
  await continueButton.click();

  // Step 5 — coaching style.
  await expect(page.getByText('Step 5 of 6')).toBeVisible();
  await page.getByRole('button', { name: /^Balanced/ }).click();
  await continueButton.click();

  // Step 6 — review, then create.
  await expect(page.getByText('Step 6 of 6')).toBeVisible();
  await expect(page.getByRole('heading', { name: "You're ready" })).toBeVisible();
  await expect(page.getByText(/11 players · 3 can pitch · 3 can catch/)).toBeVisible();
  await expect(page.getByText(/6 innings · 10 on defense/)).toBeVisible();

  await page.getByRole('button', { name: 'Finish' }).click();

  // The team exists and the roster came through.
  await expect(page.getByRole('heading', { name: 'Balsam Waters' })).toBeVisible();
  await page.getByRole('link', { name: 'Roster' }).first().click();
  await expect(page.getByText('11 active · 11 total')).toBeVisible();
  await expect(page.getByText('Brody Borek')).toBeVisible();
});

test('setup can go back without losing the battery choices', async ({ page }) => {
  await page.goto('/setup');

  await page.getByLabel('Team name').fill('Test Team');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByPlaceholder(/Brody Borek/).fill(ROSTER.join('\n'));
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Mark a pitcher, step back to the roster, add a player at the top, and
  // confirm the pitcher is still marked.
  await expect(page.getByText('Step 4 of 6')).toBeVisible();
  await page
    .getByRole('group', { name: 'Can pitch' })
    .getByRole('button', { name: /^Race/ })
    .click();
  await expect(
    page.getByRole('group', { name: 'Can pitch' }).getByText('1 selected'),
  ).toBeVisible();

  await page.getByRole('button', { name: '← Back' }).click();
  await page.getByRole('button', { name: '← Back' }).click();
  await page.getByPlaceholder(/Brody Borek/).fill(['Newkid Jones', ...ROSTER].join('\n'));
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Step 4 of 6')).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Can pitch' }).getByText('1 selected'),
  ).toBeVisible();
});

test('setup refuses a formation the roster cannot fill', async ({ page }) => {
  await page.goto('/setup');

  await page.getByLabel('Team name').fill('Small Squad');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByPlaceholder(/Brody Borek/).fill(ROSTER.slice(0, 9).join('\n'));
  await page.getByRole('button', { name: 'Continue' }).click();

  // Nine players cannot fill a ten-player formation.
  await page.getByRole('button', { name: /10 players/ }).first().click();
  await expect(
    page.getByText('You have 9 players but this formation needs 10.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();

  // The offered one-tap fix unblocks it.
  await page.getByRole('button', { name: 'Use 9 players' }).click();
  await expect(page.getByText(/nobody sits/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
});

test('the demo team generates, edits and prints a lineup', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore the demo team' }).click();

  // Dashboard.
  await expect(page.getByRole('heading', { name: 'Balsam Waters' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('11 players · 6-inning games')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Next game' })).toBeVisible();

  // Build the lineup.
  await page.getByRole('link', { name: /Build lineup|Open lineup/ }).click();
  await expect(page.getByRole('heading', { name: /vs Cardinals/ })).toBeVisible();

  await page.getByRole('button', { name: 'Generate lineup' }).first().click();

  // The grid renders whatever the formation contains: ten positions, six innings.
  await expect(page.getByRole('heading', { name: 'Defensive rotation' })).toBeVisible({
    timeout: 30_000,
  });
  for (const code of ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LC', 'RC', 'RF']) {
    await expect(page.getByRole('rowheader', { name: code, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('columnheader', { name: 'Inn 6', exact: true })).toBeVisible();

  // Quality summary and explanations appear.
  await expect(page.getByRole('heading', { name: 'Lineup quality' })).toBeVisible();
  await expect(page.getByText('Playing Time')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Why this lineup?' })).toBeVisible();

  // Batting order is filled in.
  await expect(page.getByRole('heading', { name: 'Batting order' })).toBeVisible();
  await expect(page.getByText('11 batters')).toBeVisible();

  // By-player view shows an innings total per player.
  await page.getByRole('radio', { name: 'By player' }).click();
  await expect(page.getByRole('columnheader', { name: 'Innings' })).toBeVisible();

  // Diamond view renders the four outfielders.
  await page.getByRole('radio', { name: 'Diamond' }).click();
  await expect(page.getByText('Bench', { exact: true }).first()).toBeVisible();

  // Print view.
  await page.getByRole('radio', { name: 'By inning' }).click();
  await page.getByRole('link', { name: 'Print' }).click();
  await expect(page.getByRole('heading', { name: /Balsam Waters.*vs/ })).toBeVisible();
  await expect(page.getByText('Defensive rotation')).toBeVisible();
  await expect(page.getByText('Batting order')).toBeVisible();
});

test('a manual swap can be locked and survives a rebalance', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore the demo team' }).click();
  await expect(page.getByRole('heading', { name: 'Balsam Waters' })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('link', { name: /Build lineup|Open lineup/ }).click();
  await page.getByRole('button', { name: 'Generate lineup' }).first().click();
  await expect(page.getByRole('heading', { name: 'Defensive rotation' })).toBeVisible({
    timeout: 30_000,
  });

  // Open the shortstop cell for inning 1 and pick a different player.
  const shortstopRow = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'SS', exact: true }) });
  const firstCell = shortstopRow.getByRole('button').first();
  const before = (await firstCell.textContent())?.trim();

  await firstCell.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/Inning 1 · Shortstop/)).toBeVisible();

  // Choose the first candidate who is not already there.
  const options = page.getByRole('dialog').getByRole('button');
  const count = await options.count();
  for (let index = 0; index < count; index++) {
    const option = options.nth(index);
    const text = (await option.textContent()) ?? '';
    if (text.includes('Current') || text.includes('Close') || text.includes('Done')) continue;
    if (text.includes('Move to bench')) continue;
    await option.click();
    break;
  }

  await expect(page.getByRole('dialog')).toBeHidden();
  const after = (await firstCell.textContent())?.trim();
  expect(after).not.toBe(before);

  // Lock it, then rebalance, and confirm the locked cell is untouched.
  await shortstopRow.getByRole('button', { name: 'Lock assignment' }).first().click();
  await page.getByRole('button', { name: 'Rebalance' }).first().click();
  await expect(page.getByRole('heading', { name: 'Defensive rotation' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(firstCell).toHaveText(after ?? '');
});

test('recording a short game keeps the unplayed inning out of the season', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore the demo team' }).click();
  await expect(page.getByRole('heading', { name: 'Balsam Waters' })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('link', { name: /Build lineup|Open lineup/ }).click();
  await page.getByRole('button', { name: 'Generate lineup' }).first().click();
  await expect(page.getByRole('heading', { name: 'Defensive rotation' })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('link', { name: 'Record results' }).click();
  await expect(page.getByRole('heading', { name: 'Record results' })).toBeVisible();

  // The game was called after five innings.
  await page.getByRole('radio', { name: '5', exact: true }).click();
  await expect(page.getByText(/1 inning won't count/)).toBeVisible();

  await page.getByRole('button', { name: /Record 5 innings played/ }).click();

  // Season page opens with the game recorded as 5 of 6 innings.
  await expect(page.getByRole('heading', { name: 'Season' })).toBeVisible();
  await expect(page.getByText('5 of 6 innings').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Defensive playing time' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Position breakdown' })).toBeVisible();
});

test('game-day view walks innings and lists the changes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore the demo team' }).click();
  await expect(page.getByRole('heading', { name: 'Balsam Waters' })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('link', { name: /Build lineup|Open lineup/ }).click();
  await page.getByRole('button', { name: 'Generate lineup' }).first().click();
  await expect(page.getByRole('heading', { name: 'Defensive rotation' })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('radio', { name: 'Game day' }).click();
  await expect(page.getByText('Inning 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Next inning changes')).toBeVisible();

  await page.getByRole('button', { name: 'Next inning →' }).click();
  await expect(page.getByText('Inning 2', { exact: true })).toBeVisible();
});

test('the diamond shows the field and supports tap and drag editing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore the demo team' }).click();
  await expect(page.getByRole('heading', { name: 'Balsam Waters' })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('link', { name: /Build lineup|Open lineup/ }).click();
  await page.getByRole('button', { name: 'Generate lineup' }).first().click();
  await expect(page.getByRole('heading', { name: 'Defensive rotation' })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('radio', { name: 'Diamond' }).click();

  // All ten positions of the four-outfielder formation render on the field.
  for (const name of [
    'Pitcher',
    'Catcher',
    'First Base',
    'Second Base',
    'Third Base',
    'Shortstop',
    'Left Field',
    'Left Center',
    'Right Center',
    'Right Field',
  ]) {
    await expect(page.getByTitle(name, { exact: true })).toBeVisible();
  }

  const shortstopCard = page.getByTitle('Shortstop');
  const leftFieldCard = page.getByTitle('Left Field');
  await expect(shortstopCard).toBeVisible();
  await expect(leftFieldCard).toBeVisible();
  await expect(page.getByText('Tap a player to swap them, or drag one card onto another.')).toBeVisible();

  const ssBefore = (await shortstopCard.textContent()) ?? '';
  const lfBefore = (await leftFieldCard.textContent()) ?? '';

  // Drag shortstop onto left field: the two swap.
  await shortstopCard.dragTo(leftFieldCard);
  await expect(leftFieldCard).not.toHaveText(lfBefore);

  const ssAfter = (await shortstopCard.textContent()) ?? '';
  const lfAfter = (await leftFieldCard.textContent()) ?? '';
  expect(ssAfter).not.toBe(ssBefore);
  expect(lfAfter).not.toBe(lfBefore);

  // Tapping a card opens the swap picker (the path that works on a phone).
  await shortstopCard.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/Inning 1 · Shortstop/)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // The bench is a drop target for taking someone off the field.
  await expect(page.getByText('Bench', { exact: false }).first()).toBeVisible();
});

test('compare approaches shows three lineups and applies the chosen one', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore the demo team' }).click();
  await expect(page.getByRole('heading', { name: 'Balsam Waters' })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('link', { name: /Build lineup|Open lineup/ }).click();
  await page.getByRole('button', { name: 'Generate lineup' }).first().click();
  await expect(page.getByRole('heading', { name: 'Defensive rotation' })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('link', { name: 'Compare approaches' }).click();
  await expect(page.getByRole('heading', { name: 'Compare approaches' })).toBeVisible();

  // All three approaches render with their metrics.
  for (const name of ['Equal Playing Time', 'Balanced', 'Competitive']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible({
      timeout: 30_000,
    });
  }
  await expect(page.getByText('The trade-off')).toBeVisible();
  await expect(page.getByText('Playing Time').first()).toBeVisible();
  await expect(page.getByText('Defensive Strength').first()).toBeVisible();

  // The table view exists so nothing is gated behind reading the meters.
  await page.getByRole('radio', { name: 'Table' }).click();
  await expect(page.getByRole('heading', { name: 'Side by side' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Competitive' })).toBeVisible();
  await expect(page.getByRole('rowheader', { name: 'Innings played' })).toBeVisible();

  // Applying an approach returns to the lineup and switches the philosophy.
  await page.getByRole('radio', { name: 'Cards' }).click();
  const competitiveCard = page.getByRole('region', { name: 'Competitive' });
  await competitiveCard.getByRole('button', { name: 'Use this lineup' }).click();

  await expect(page.getByRole('heading', { name: /vs Cardinals/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Defensive rotation' })).toBeVisible();

  // Re-opening the comparison shows Competitive as the game's current approach,
  // which confirms the settings were saved alongside the lineup.
  await page.getByRole('link', { name: 'Compare approaches' }).click();
  await expect(
    page.getByRole('region', { name: 'Competitive' }).getByText('Current'),
  ).toBeVisible({ timeout: 30_000 });
});

test('a roster can be imported from a photo and corrected before saving', async ({ page }) => {
  // The API is mocked: the extraction itself is covered by unit tests, and the
  // browser test is about the review-and-edit gate in front of it.
  await page.route('**/api/roster-import', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        result: {
          source: 'handwritten lineup card',
          warning: 'The last row was hard to read.',
          duplicatesRemoved: [],
          players: [
            { firstName: 'Brody', lastName: 'Borek', jerseyNumber: '8', confident: true },
            { firstName: 'Race', lastName: 'Smith', jerseyNumber: '12', confident: true },
            { firstName: 'Vvalter', lastName: 'Nash', confident: false },
          ],
        },
      }),
    });
  });

  await page.goto('/setup');
  await page.getByLabel('Team name').fill('Photo Team');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('button', { name: 'Import from a photo' }).click();
  await expect(page.getByRole('heading', { name: 'Import roster from a photo' })).toBeVisible();

  // Uploading is what triggers the read.
  await page.setInputFiles('input[type=file]', {
    name: 'lineup.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });

  // Review step: the unsure row is flagged rather than silently trusted.
  await expect(page.getByRole('heading', { name: 'Check what we read' })).toBeVisible();
  await expect(page.getByText('1 to double-check')).toBeVisible();
  await expect(page.getByText('The last row was hard to read.')).toBeVisible();
  await expect(page.getByText('Hard to read — worth checking the spelling.')).toBeVisible();

  // The coach fixes the misread name before anything is saved.
  const misread = page.getByRole('textbox', { name: 'First name' }).nth(2);
  await expect(misread).toHaveValue('Vvalter');
  await misread.fill('Walter');

  await page.getByRole('button', { name: 'Add 3 players' }).click();

  // The names land in the roster step, ready to continue.
  const rosterBox = page.getByPlaceholder(/Brody Borek/);
  await expect(rosterBox).toHaveValue(/Walter Nash/);
  await expect(rosterBox).toHaveValue(/Brody Borek #8/);
  await expect(page.getByText('3 players', { exact: true })).toBeVisible();
});

test('photo import explains itself when the server has no API key', async ({ page }) => {
  await page.route('**/api/roster-import', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        unavailable: true,
        error: 'Photo import is not configured on this server. Set ANTHROPIC_API_KEY to enable it — you can still paste or type your roster.',
      }),
    });
  });

  await page.goto('/setup');
  await page.getByLabel('Team name').fill('No Key Team');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Import from a photo' }).click();

  await page.setInputFiles('input[type=file]', {
    name: 'lineup.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });

  // It degrades to an explanation plus the path that always works.
  await expect(page.getByText('Not set up yet')).toBeVisible();
  await expect(page.getByText(/ANTHROPIC_API_KEY/)).toBeVisible();
});
