# Dugout

**Smart lineups for youth baseball & softball.**

Dugout builds optimized batting orders and inning-by-inning defensive rotations for
youth baseball and softball teams. Pick who's playing, choose how you want to coach,
and generate a full game in about a second.

Its distinguishing feature is that it optimizes the **season**, not just the game.
Dugout records what actually happened — including games called early and players who
left at the third inning — and compensates in later games.

```
Select who's playing  →  Choose how you want to coach  →  Generate Lineup
```

---

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

On first load, choose **Explore the demo team** to get Balsam Waters: 11 players, a
ten-player defence with four outfielders, and four completed games with realistic
imbalance for the season-aware optimizer to work against.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | Unit, scenario and integration tests (Vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npx playwright install chromium && npx playwright test` | Browser end-to-end tests |

Data is stored in the browser. There are no accounts yet, and the only thing that ever
leaves the device is a roster photo you explicitly choose to import (see below).

### Roster import from a photo

Set `ANTHROPIC_API_KEY` to enable it:

```bash
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env.local
```

Without a key the feature explains itself and the paste path still works — nothing
breaks.

---

## Architecture

```
src/
  domain/        Types, formations, philosophy weights, factories. No I/O.
  optimizer/     The solver. Pure functions over a SolverContext.
  services/      Season statistics, fairness debt, lineup orchestration.
  data/          Repository interfaces + browser-local implementation, demo seed.
  app/           Next.js App Router pages (all client components).
  components/    UI primitives and game views.
  lib/           Formatting and read-only view projections.
```

Business logic lives in `domain/`, `optimizer/` and `services/`. React components
render state and call services; none of them contain lineup logic.

### Formations are data, never assumptions

Nothing assumes nine defensive players. A game stores a **formation snapshot**, and
both the optimizer and the UI iterate over whatever positions it contains — nine,
ten, or a custom set with a Rover. No code references `CF` or a position count.

Every position belongs to a `PositionGroup` (`BATTERY`, `INFIELD`, `OUTFIELD`), which
is what makes season statistics survive a mid-season formation change: `LC` and `CF`
are different positions but both roll up to `OUTFIELD`. Per-position season totals are
keyed by position **code**; group totals are the guaranteed common denominator.

Pitcher and catcher handling is driven by a `role` declared on the position, not by
matching the code `"P"`. That keeps the optimizer sport-neutral.

### Fairness debt

For every player, Dugout compares expected against actual. "Expected" is that player's
fair share of the opportunities they were **actually present for**: within each game,
each available player's expectation is proportional to the innings they were available.

That definition matters. A player who misses a whole game accrues no debt for it, and a
game called after five innings creates expectations for five innings only. Positive debt
means "owed more of this", and it pulls future lineups without forcing rigid per-game
equality.

---

## Roster import from a photo

A coach can import a roster from a screenshot of a scorekeeping app, a photo of a
printed team list, or a picture of a handwritten lineup card. The image goes to
the Claude API to be read; extraction is structured rather than free text, via
`client.messages.parse()` against a Zod schema.

Three deliberate constraints:

- **The model reads, it does not infer.** It is told never to invent a player,
  never to guess a jersey number, and never to derive positions or
  pitching/catching ability from the image. Eligibility is the coach's call, and
  a wrong guess there silently breaks lineups.
- **Nothing is saved unreviewed.** Reading handwriting is never certain, so every
  extracted row lands in an editable review step, and rows the model flagged as
  unsure are called out so the coach knows where to look instead of re-checking
  all of them.
- **Normalization is separate from the API call.** `lib/rosterImport.ts` holds the
  schema, prompt and all cleanup (title-casing, implausible jersey numbers,
  duplicate collapsing), so the rules that stand between a misread photo and a
  corrupted roster are unit-tested without spending a request.

Privacy: this is the only server-side endpoint in the product. The image is
forwarded to be read and is not written to disk, cached, or logged — and neither
are the names that come back. Because this handles pictures of children's names,
nothing in that route should ever start logging request bodies. Coaches who would
rather nothing left the device are told so in the dialog, and can paste instead.

## Compare approaches

One tap generates the same game three ways — Equal Playing Time, Balanced,
Competitive — from the identical roster, availability, locks, pitching plan and
seed, so every difference is attributable to the coaching philosophy and
nothing else. The coach's own hard rules carry across all three: a required
minimum of four innings stays required under Competitive. Each option reports
its metrics, the range of innings played, and who plays least, plus one
sentence naming the trade-off ("Competitive buys 21% more defensive strength at
the same spread of playing time"). A table view is always available.

The comparison meters use a single hue rather than severity colours. They
compare magnitude between options the coach is choosing among, and a red bar
would read as a defect when low defensive strength is exactly the trade Equal
Playing Time makes on purpose.

## The optimizer

This is a constraint optimization problem, and it is modelled as one — not as random
shuffling with special cases. The application only talks to the `LineupOptimizer`
interface, so the solver behind it can be replaced without touching any caller.

**Construct → improve.** Each inning is filled by an exact minimum-cost bipartite
assignment (Jonker–Volgenant/Hungarian, `optimizer/hungarian.ts`) using costs derived
from the coach's weights and the running state. The full game is then improved by local
search against the full-game objective in `optimizer/objective.ts`, over four
neighbourhoods:

1. Swap two positions within an inning.
2. Swap an on-field player with a benched player.
3. Swap two assignments across different innings.
4. Substitute a benched player for an on-field player and re-solve the whole inning.

Move 4 matters more than it looks: a player with limited eligibility often cannot cover
any position held by the player who should come out, so getting them on the field needs
a three-way rotation that moves 1–3 cannot reach.

**Every weight lives in `domain/weights.ts`.** Philosophy presets (Equal Playing Time →
Competitive) set them; the plain-language dials adjust them. No unexplained numeric
constants are scattered through the code — solver-internal tuning sits in a single
`TUNING` block in `optimizer/objective.ts`.

**Hard constraints are never violated.** Formation filled every inning, one position per
player, availability windows, `NEVER` restrictions, locks and the pitching plan, battery
caps. Required minimums are enforced when mathematically possible, and when they are
not, `optimizer/feasibility.ts` says why before generating and ranks the smallest
changes that would fix it. Dugout never reports "unable to generate" without an
explanation.

**Solver output is never trusted.** `optimizer/validate.ts` re-checks every invariant
after optimization; a result that fails is reported as not-ok rather than shown to a
coach as valid.

### Why not CP-SAT / OR-Tools

The spec prefers a real constraint solver, and the interface is built so one can be
dropped in. The season-aware objective is dominated by quadratic
deviation-from-target terms that a MIP/CP model would have to linearise, and shipping
OR-Tools means adding a Python service to the deployment. The current solver is
deterministic, runs in ~30–50 ms per game in-process — well inside the sub-second
target — and is swappable. Revisit if the objective grows constraints that local search
handles poorly.

### Determinism

Generation is reproducible given the same inputs, history and seed. Search depth is
bounded by **evaluation count, not elapsed time** — a wall-clock budget makes results
depend on how busy the machine is, which would return different lineups for identical
inputs. Nothing in the optimizer calls `Math.random()`; a seeded PRNG does all
tie-breaking, and a tiny seed-derived tie-break term lets **Generate Another** return a
genuinely different lineup of equal quality.

### Position continuity

The counterpart to position variety: **Position continuity** holds a player at
one spot for two or three innings at a time before rotating them — for learning
a position, and for doubleheaders where constant movement is punishing.

Continuity and variety are contradictory instructions, so turning continuity on
deliberately outranks the terms that fight it (within-game variety, position-group
balance, the repeated-position penalty) and lifts the consecutive-innings cap
that the variety dial would otherwise impose — at variety HIGH that cap is 2,
which would silently defeat a three-inning block. Season-level fairness is
untouched: continuity changes where a player stands, not how much they play, and
required minimums and the pitching plan still hold.

What it can reach depends on the roster. With ten players for ten positions
nobody sits and everyone gets exact blocks. With eleven, one player sits each
inning and the pitcher changes between blocks, so the substitution chain has to
break somebody's block — the optimizer lands nearly everyone on clean pairs and
never makes one player absorb more than one extra rotation. The quality summary
reports the count ("Players hold a position for 2 innings at a time (10 of 11)")
rather than claiming success or failure.

### Metrics measure what is achievable

Quality metrics are scored against the best a lineup could actually reach, never
against a theoretical ideal the rules make impossible:

- **Defensive strength** is measured against the strongest and weakest defence
  reachable, found by solving each inning as an assignment problem. The earlier
  version compared against "the best player at every position at once" — which
  no lineup can reach, since a player occupies one position — so a mathematically
  optimal lineup scored 47%, and all three compared approaches looked equally
  mediocre.
- **Playing time** is measured against the evenness whole innings allow. Eleven
  players across ten positions is a fair share of 5.45 innings each, so the best
  possible result is some players at five and some at six; scoring that against
  a perfect 5.45 rated the optimum "Fair, 67%".
- The dashboard reports the innings Dugout **owes** a player rather than the
  spread of raw totals. A player who missed a game has fewer innings without
  having been treated unfairly — which is the whole reason fairness is expected
  versus actual.

### Position-group colours are validated, not chosen by eye

Position groups carry identity across the grids, the diamond and the season
dashboard, so they are a categorical palette and are checked with the
colour validator. The original green/blue pair was ΔE 8.0 in *normal* vision,
meaning infield and outfield were near-indistinguishable in the inning grid — a
distinction this product is built around. The current amber/teal/indigo set
passes every check in both light and dark mode, with worst-case CVD ΔE 13.6
against a target of 8. Bench is deliberately excluded from the categorical set:
it is the absence of a defensive assignment, so it stays neutral and always
carries a text label.

### Three bugs worth knowing about

Found by simulating full seasons rather than single games, and each now has a
regression test:

1. **Critical-position strength was deciding who plays, not just where.** Summing
   `criticality × ability` over assignments rewards simply having stronger players on
   the field, so developing players were benched regardless of what they were owed. It
   is now measured within each inning, centred on the average ability of the players
   actually playing — it can influence *which position* a player takes, never *whether*
   they play.

2. **Position-group balance penalised restricted players for every inning they
   played.** Expecting every player's innings to split by the formation's group ratio
   means a player who cannot pitch, catch or play first base is judged against a split
   they can never achieve. Each player's expected split now comes from the positions
   they are eligible for. This was the significant one: maximum season drift fell from
   1.55 innings to 0.55 — the mathematical optimum for an 11-player roster with 10
   positions, where a fair share is 5.45 innings per game.

3. **Determinism depended on wall-clock time**, as described above.

---

## Testing

`npm test` covers scenarios A–O from the specification plus the invariant suite:

- **Scenarios** — roster/formation combinations, position restrictions, two eligible
  first basemen, three eligible catchers, locked pitching plans, late arrivals, early
  departures, and impossible configurations.
- **Invariants** (`src/test/fixtures.ts`) — checked independently of the optimizer's own
  validator, so a bug there cannot hide a bad lineup.
- **Season-aware behaviour** — material debt is always repaid; over-used positions are
  eased off; unplayed innings never reach season statistics; group statistics stay
  correct across a formation change.
- **Season simulation** — ten- and fifteen-game seasons confirming drift stays bounded
  rather than accumulating on the same players, that a run of short games is recovered
  from, and that the philosophy dial measurably changes the outcome.
- **Full workflow** — the UX north star: a player drops out 45 minutes before first
  pitch, the coach rebalances, the game is called after five innings, and the next game
  accounts for it.

`e2e/coach.spec.ts` drives the real browser through the guided setup and both of
its validation gates, generation, a locked manual swap surviving a rebalance,
drag-and-tap editing on the diamond, the three-way comparison and applying one
of its options, recording a short game, and the print and game-day views.

---

## Product decisions made while building

- **No authentication in the MVP**, but nothing is architected around `localStorage`.
  Repository interfaces (`data/repositories.ts`) are the only storage contract; the
  browser store is one implementation of them.
- **Advanced numeric caps** the coach sets explicitly (max outfield innings, max
  consecutive innings at a position) are strong soft objectives rather than hard
  constraints, and violations are surfaced as named warnings. Hard failure is reserved
  for what the spec lists as inviolable, so a coach never gets a blank screen because
  of an advanced setting they half-remember enabling.
- **Per-game rule overrides** are stored as a settings snapshot on the game, so
  historical lineups never change when team settings change later.
- **Eligibility overrides are per-game.** Playing someone at a position marked `Never`
  asks first and applies to that game only; roster settings are never silently rewritten.
- **Ability tiers are coach-only** and never appear in print or shared views.
- **Selection states never rely on colour alone.** A chosen option carries a filled
  check mark and a heavier ring as well as a tint — the tint alone was nearly
  invisible in dark mode.

## Not built, deliberately

Scorekeeping, live scoring, streaming, parent messaging, team chat, photos, video,
tournament brackets, full player statistics, payments. Dugout does lineup optimization.

Phase 2 candidates: accounts and cloud sync, assistant coaches, shared read-only lineup
links, pitch-count tracking, CSV/image roster import, live mid-game rebalance.
