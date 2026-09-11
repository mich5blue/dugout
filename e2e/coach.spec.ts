import { expect, test } from '@playwright/test';

/**
 * Browser end-to-end coverage of the coach's actual path through the product.
 * Everything is stored in the browser, so each test starts from a clean slate.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test('a new coach can create a team and add a roster', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /Smart lineups for youth baseball/i }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Create your team' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your team' })).toBeVisible();

  await page.getByLabel('Team name').fill('Balsam Waters');
  await page.getByRole('radio', { name: 'Baseball' }).click();

  // Ten-player, four-outfielder formation.
  await page.getByRole('button', { name: /10 Players/ }).first().click();

  await page
    .getByPlaceholder('Brody Borek')
    .fill(
      [
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
      ].join('\n'),
    );
  await expect(page.getByText('11 players detected.')).toBeVisible();

  await page.getByRole('button', { name: 'Create team' }).click();

  await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible();
  await expect(page.getByText('11 active · 11 total')).toBeVisible();
  await expect(page.getByText('Brody Borek')).toBeVisible();
  await expect(page.getByText('#8').first()).toBeVisible();
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
  await expect(page.getByRole('columnheader', { name: '6', exact: true })).toBeVisible();

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
  await expect(page.getByText('Inning 1')).toBeVisible();
  await expect(page.getByText('Next inning changes')).toBeVisible();

  await page.getByRole('button', { name: 'Next inning →' }).click();
  await expect(page.getByText('Inning 2')).toBeVisible();
});
