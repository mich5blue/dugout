# Sharing a lineup

Coaches distribute lineups to parents, assistants and scorekeepers. InningGrid does
this without a backend: the whole lineup is encoded into the link.

## How it works

`src/lib/shareLink.ts` builds a `SharePayload` — team, opponent, date, innings,
position codes, player names, assignments, batting order, bench — and compresses
it with `CompressionStream('deflate-raw')`, then base64url-encodes the result.
`/s/[token]` decodes it in the browser and renders a read-only page.

A typical 11-player, six-inning, ten-position lineup produces a **468-character
URL**, which survives SMS, GroupMe and email without truncation. The encoder
prefixes `c` for compressed and `u` for the uncompressed fallback, so a browser
without `CompressionStream` still produces a working (longer) link.

## What the link carries, and what it never carries

Carried: team name, opponent, date, inning count, position codes and groups,
player display names, assignments per inning, batting order, bench per inning.

Never carried: ability tiers, core/developing status, position allow and deny
lists, fairness debt, pitching eligibility, coach notes, development goals,
player IDs, or anything about other games. `src/lib/shareLink.test.ts` asserts
this against the encoded token, so a future field added to `Player` cannot leak
into a share link without the test failing.

## The trade-off, stated honestly

A link is a bearer token. Anyone holding it can read the lineup, and there is no
expiry and no revocation — revoking would require server state, which is what
this design avoids. The share dialog says this in plain language rather than
implying the link is private.

Two mitigations are in place:

- `/s` is `noindex, nofollow` (`src/app/s/layout.tsx`) and disallowed in
  `robots.txt` (`src/app/robots.ts`), so a link forwarded into a public place
  does not become searchable.
- The payload is deliberately minimal, so the worst case is a first and last
  name beside a position — the same information printed on a lineup card taped
  to a dugout fence.

Because the data is in the URL path rather than a query string, it can still
appear in CDN access logs. That is acceptable for names and positions; it is the
reason ability tiers are excluded rather than merely hidden.

## If sharing ever needs revocation

Store the payload server-side keyed by a random id and serve `/s/:id` from it —
the page component needs no change, only the decode step. See `docs/accounts.md`
for the Postgres schema this would attach to.
