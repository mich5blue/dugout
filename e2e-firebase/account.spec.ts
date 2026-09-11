import { expect, test, type Page } from '@playwright/test';

/**
 * The signed-in app, against the Firebase emulators.
 *
 * Every other suite runs on the browser-storage fallback. This one proves the
 * backend actually works: that a coach can sign in, that their team is written
 * to and read from Firestore, that an assistant sees it, and that the rules
 * stop the assistant doing what they must not.
 */

const PROJECT = 'dugout-e2e';
const AUTH = 'http://127.0.0.1:9099';
const FIRESTORE = 'http://127.0.0.1:8089';

const HEAD_COACH = 'head.coach@example.com';
const ASSISTANT = 'assistant.coach@example.com';

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

test.beforeEach(async ({ request }) => {
  // A clean project per test: emulator state is shared and would otherwise
  // carry one test's team into the next.
  await request.delete(
    `${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
  );
  await request.delete(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`);
  /*
    Deliberately no storage-clearing init script. Playwright gives each test a
    fresh context, so storage starts empty anyway — and an init script runs on
    every navigation, which would wipe the pending email address mid-sign-in
    and make the link flow untestable.
  */
});

/**
 * Signs in by email link, the way an invited coach does.
 *
 * The emulator exposes the link it would have emailed, so this is the real
 * flow — `sendSignInLinkToEmail` through to `signInWithEmailLink` — with the
 * inbox replaced.
 */
async function signIn(page: Page, email: string) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Smart lineups, every inning/ })).toBeVisible();

  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();

  const response = await page.request.get(
    `${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`,
  );
  const { oobCodes } = (await response.json()) as {
    oobCodes: { email: string; oobLink: string }[];
  };
  const link = oobCodes.filter((code) => code.email === email).pop();
  expect(link, `no sign-in link was sent to ${email}`).toBeTruthy();

  /*
    The emulator's link points at its own handler, which then redirects to the
    app's continue URL carrying the one-time code — exactly what a real link
    does, so the app's own handling is what gets tested.
  */
  await page.goto(link!.oobLink);

  /*
    Signed in means the sign-in form is gone. Asserting on the heading would
    pass either way: the sign-in screen and the empty dashboard share it.
  */
  await expect(page.getByLabel('Email')).toHaveCount(0, { timeout: 20_000 });
}

async function createTeam(page: Page) {
  await page.getByRole('link', { name: 'Create your team' }).click();
  const next = page.getByRole('button', { name: 'Continue' });

  await page.getByLabel('Team name').fill('Balsam Waters');
  await page.getByRole('radio', { name: 'Baseball' }).click();
  await next.click();

  await page.getByPlaceholder(/Brody Borek/).fill(ROSTER.join('\n'));
  await next.click();

  await page.getByRole('button', { name: /10 players/ }).first().click();
  await next.click();

  const pitch = page.getByRole('group', { name: 'Can pitch' });
  const catchers = page.getByRole('group', { name: 'Can catch' });
  for (const name of ['Brody', 'Race', 'Weston']) {
    await pitch.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  }
  for (const name of ['Calvin', 'Vasil', 'Mehki']) {
    await catchers.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  }
  await next.click();

  await page.getByRole('button', { name: /^Balanced/ }).click();
  await next.click();
  await page.getByRole('button', { name: 'Finish' }).click();

  await expect(page.getByRole('heading', { name: 'Balsam Waters' })).toBeVisible({
    timeout: 30_000,
  });
}

test('a coach signs in, and their team is stored in their account', async ({
  page,
  request,
}) => {
  await signIn(page, HEAD_COACH);
  await createTeam(page);

  /*
    It is really on the server, not just on screen. The emulator's REST API
    honours the security rules, so `Bearer owner` is how a test reads past
    them — and without it the same request is refused, which is the rules
    denying an anonymous HTTP client a list of teams.
  */
  const url = `${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/teams`;
  const denied = await request.get(url);
  expect(denied.status()).toBe(403);

  const stored = await request.get(url, {
    headers: { Authorization: 'Bearer owner' },
  });
  const body = (await stored.json()) as {
    documents?: { fields: Record<string, { stringValue?: string }> }[];
  };
  expect(body.documents).toHaveLength(1);
  expect(body.documents?.[0].fields.name.stringValue).toBe('Balsam Waters');

  const players = await request.get(
    `${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/teams/${
      body.documents?.[0].fields.id.stringValue
    }/players`,
    { headers: { Authorization: 'Bearer owner' } },
  );
  const roster = (await players.json()) as { documents?: unknown[] };
  expect(roster.documents).toHaveLength(ROSTER.length);
});

test('the team follows the coach to a different browser', async ({ page, browser }) => {
  await signIn(page, HEAD_COACH);
  await createTeam(page);

  /*
    A genuinely separate browser context — not another tab, which would share
    storage and prove nothing. This is the thing browser storage could never do.
  */
  const elsewhere = await browser.newContext();
  const phone = await elsewhere.newPage();
  await signIn(phone, HEAD_COACH);
  await expect(phone.getByRole('heading', { name: 'Balsam Waters' })).toBeVisible({
    timeout: 20_000,
  });
  await phone.getByRole('link', { name: 'Roster' }).first().click();
  await expect(phone.getByText('Brody Borek')).toBeVisible();
  await elsewhere.close();
});

test('signing out leaves nothing of the team behind', async ({ page }) => {
  await signIn(page, HEAD_COACH);
  await createTeam(page);

  await page.getByRole('button', { name: /Balsam Waters/ }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();

  await expect(page.getByRole('heading', { name: /Smart lineups, every inning/ })).toBeVisible();
  await expect(page.getByText('Balsam Waters')).toHaveCount(0);
});

test('an invited assistant sees the team and can only change what they should', async ({
  page,
}) => {
  await signIn(page, HEAD_COACH);
  await createTeam(page);

  // Invite the assistant.
  await page.getByRole('link', { name: 'Coaches' }).first().click();
  await page.getByLabel(/name/i).first().fill('Alex Assistant');
  await page.getByLabel(/email/i).first().fill(ASSISTANT);
  await page.getByRole('button', { name: /Invite|Add/ }).first().click();
  await expect(page.getByText(ASSISTANT)).toBeVisible();

  // A generated lineup, so there is something for the assistant to read.
  await page.getByRole('link', { name: 'Dashboard' }).first().click();
  await page.getByRole('link', { name: /Build lineup|Open lineup|New game/ }).first().click();

  // Now sign in as the assistant in a clean session.
  const assistantPage = await page.context().newPage();
  await page.getByRole('button', { name: /Balsam Waters/ }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(assistantPage, ASSISTANT);

  // The team shows up without anyone typing it in again.
  await expect(assistantPage.getByRole('heading', { name: 'Balsam Waters' })).toBeVisible({
    timeout: 20_000,
  });

  // And the app tells them what they are.
  await expect(assistantPage.getByText(/assistant coach/i).first()).toBeVisible();

  // They can mark a core player, and it reaches the server.
  await assistantPage.getByRole('link', { name: 'Roster' }).first().click();
  await assistantPage.getByText('Brody Borek').first().click();
  await assistantPage
    .getByRole('radiogroup', { name: 'Defensive ability' })
    .getByRole('radio', { name: 'Core' })
    .click();

  // They cannot rename anyone, and the field says so rather than swallowing
  // keystrokes.
  await expect(assistantPage.getByLabel('First name')).toBeDisabled();
  await expect(assistantPage.getByLabel('Last name')).toBeDisabled();

  /*
    Read it back past the rules. This is the part the rules tests cannot cover:
    that the store narrows an assistant's whole-player save to the permitted
    fields, so the write lands instead of being refused.
  */
  const teams = await assistantPage.request.get(
    `${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/teams`,
    { headers: { Authorization: 'Bearer owner' } },
  );
  const teamId = (
    (await teams.json()) as { documents: { fields: { id: { stringValue: string } } }[] }
  ).documents[0].fields.id.stringValue;

  await expect(async () => {
    const players = await assistantPage.request.get(
      `${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/teams/${teamId}/players`,
      { headers: { Authorization: 'Bearer owner' } },
    );
    const rows = (
      (await players.json()) as {
        documents: {
          fields: {
            firstName: { stringValue: string };
            lastName: { stringValue: string };
            overallTier: { stringValue: string };
          };
        }[];
      }
    ).documents;
    const brody = rows.find((row) => row.fields.firstName.stringValue === 'Brody');
    expect(brody?.fields.overallTier.stringValue).toBe('CORE');
    // Still named Brody Borek, which is the whole point of the narrowing.
    expect(brody?.fields.lastName.stringValue).toBe('Borek');
  }).toPass({ timeout: 10_000 });

  await assistantPage.close();
});
