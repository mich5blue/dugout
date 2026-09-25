# Feature inventory — before the redesign

Written 25 Sept 2026, from the code, as the protection artifact for the UX
redesign. **Nothing in the "Behaviour to preserve" column may stop working
because the new UI does not visibly expose it.** If a redesign drops one, that
is a decision to record here with a reason, not an omission to discover later.

Read this with `README.md`, which explains *why* several of these behave the way
they do. This file is *what exists*.

---

## 1. Routes

| Route | What it is | Redesign disposition |
| --- | --- | --- |
| `/` | Dashboard. Zero-state marketing hero when no team; otherwise next game, awaiting-results prompts, season card, roster/game counts | **Rebuild** as Home around next action |
| `/setup` | 6-step team creation wizard + "what you'll need" intro | **Keep**, fold into first-run |
| `/games` | Schedule: upcoming, awaiting results, past | **Keep**, light restyle |
| `/games/new` | Create a game (opponent, date, innings) | **Absorb** into the new game flow |
| `/games/[gameId]` | The big one: setup panels, generate, 4 views, batting order, locks, pitching plan, attendance bar, quality/conflicts | **Split** into flow + hero lineup |
| `/games/[gameId]/compare` | Three philosophies side by side | **Keep**, restyle to summaries |
| `/games/[gameId]/record` | Edit-results grid, actual innings | **Keep** |
| `/games/[gameId]/print` | 3 print modes: full, compact, dugout | **Keep** |
| `/roster` | Roster list, quick add, photo import | **Keep** → "Team" |
| `/roster/[playerId]` | Player detail: tiers, battery, eligibility, caps, goals | **Keep** |
| `/season` | Analytics: dial, bars, cumulative lines, heat grid, position grid, player cards | **Keep**, plain-English pass |
| `/coaches` | Invite/manage assistants | **Keep**, move under Team |
| `/settings` | Team settings, formations, philosophy, rules, reset | **Keep** → Settings |
| `/guide` | 15-section how-to with live component previews | **Keep** |
| `/feedback` | Bug/confusion/idea form → Firestore | **Keep** |
| `/s/[token]` | Public read-only shared lineup, no account | **Keep** |
| `/api/roster-import` | Claude vision OCR for roster photos | **Keep** |

## 2. Data model (`src/domain/types.ts`)

- `Sport` = BASEBALL | SOFTBALL
- `PositionGroup` = BATTERY | INFIELD | OUTFIELD | BENCH; `BENCH_POSITION_ID`
- `PositionRole` = PITCHER | CATCHER — declared by the formation, never inferred
  from a code, so the optimizer stays sport-neutral
- `PositionDefinition` — id, code, displayName, group, role?, sortOrder,
  criticalWeight (0.25/0.5/1.0), diagramX/Y
- `Formation` — id, teamId (null for system presets), sport, name,
  isSystemPreset, positions[]. **Six system presets** (baseball 9, baseball
  10 LC/RC, baseball 10 LCF/RCF, softball 9, softball 10, softball 10 rover)
- `Eligibility` = NEVER | AVOID | ALLOWED | PREFERRED
- `AbilityTier` = DEVELOPING | REGULAR | CORE (`ABILITY_VALUE` 1/2/3)
- `Player` — firstName, **lastInitial? (one char, never a surname)**,
  jerseyNumber?, active, overallTier, offensiveTier, positionRatings (keyed by
  positionId, each with eligibility + optional per-position abilityTier),
  canPitch, canCatch, preferredPitcher, preferredCatcher,
  maxPitchingInnings?, maxCatchingInnings?
- `GamePlayer` — playerId, available, **arrivalInning?**, **departureInning?**,
  maxPitchingInnings?
- `DefensiveAssignment` — id, gameId, inning, positionId, playerId, locked,
  **assignmentType: PLANNED | ACTUAL**
- `BattingAssignment` — playerId, battingSlot, locked
- `Game` — opponent, date, plannedInnings, **actualInnings (null until
  recorded)**, **formationSnapshot** (immutable copy), status
  (PLANNED|IN_PROGRESS|COMPLETED), **settingsSnapshot**, optimizerVersion,
  optimizerSeed, gamePlayers[], pitchingPlan (inning→playerId),
  defensiveAssignments[], battingAssignments[], eligibilityOverrides[]
- `Team` — name, sport, seasonName, division, defaultInnings,
  defaultFormationId, settings
- `DevelopmentGoal`, `PriorityFlag`, `TeamMembership`

**Consequence to respect:** `DefensiveAssignment` is keyed on
`(inning, positionId)` with one player, so **mid-inning substitution is not
representable**. Adding it is a display/record change, never a fairness change.

## 3. Every configurable rule (`RuleSettings` + `TeamSettings`)

Playing time: `minDefensiveInnings` (default **3**), `minDefensiveInningsMode`
(TARGET|REQUIRED), `playingTimeBalance` (EQUAL|MOSTLY_EQUAL|COMPETITIVE, default
MOSTLY_EQUAL).

Bench: `equalizeBench` (true), `noConsecutiveBench` (true), `maxBenchInnings?`.

Variety: `variety` (LOW|MEDIUM|HIGH, default MEDIUM), `minUniquePositions`
(default **2**), `maxInningsSamePosition?`, `maxConsecutiveSamePosition?`,
`positionContinuityInnings?`.

Positions: `infieldOpportunity` ({mode: OFF} | {mode: TARGET|REQUIRED, innings},
default TARGET/1), `maxOutfieldInnings?`, `minOutfieldInnings?`,
`maxConsecutiveOutfieldInnings?`, `criticalStrength`
(OFF|LOW|MEDIUM|HIGH, default **MEDIUM**), `infieldSpread`
(OFF|LOW|MEDIUM|HIGH, default **MEDIUM**).

Battery: `maxCatcherInningsPerPlayer?`, `maxConsecutiveCatcherInnings` (default
**3**), `maxPitchingInningsPerPlayer` (default **2**),
`restrictPitcherCatcherTransition` (false).

Batting: `battingPhilosophy` (ROTATE_FAIRLY|BALANCED|COMPETITIVE|MANUAL, default
ROTATE_FAIRLY), `battingFormat` (CONTINUOUS|STARTERS_SUBS).

Top level: `philosophy` (EQUAL_PLAYING_TIME|DEVELOPMENT|BALANCED|COMPETITIVE|
CUSTOM), `weightOverrides?` (partial `Weights`).

**15 `WeightKey`s**: playingTimeEquality, seasonFairness, positionVariety,
positionContinuity, positionGroupBalance, infieldOpportunity,
playerPreferences, developmentGoals, criticalPositionStrength,
infieldAbilitySpread, battingOrderFairness, consecutiveBenchPenalty,
repeatedPositionPenalty, excessiveOutfieldPenalty, avoidPositionPenalty.

Per-game overrides are stored as a **settings snapshot on the game**, so
historical lineups never change when team settings change later. Advanced
numeric caps are **strong soft objectives**, not hard constraints — violations
surface as named warnings rather than a blank screen.

## 4. The optimizer (`src/optimizer/`) — do not rewrite

| File | Role |
| --- | --- |
| `index.ts` | `LineupOptimizer.generate(input)` — the only interface the app talks to |
| `context.ts` | Builds `SolverContext`: players×positions eligibility, availability windows, equal shares, debt, pitching-plan pins |
| `construct.ts` | Greedy/Hungarian initial solution |
| `hungarian.ts` | Min-cost assignment per inning |
| `localsearch.ts` | Deterministic local search over the true objective |
| `objective.ts` | The cost function + `effectiveRules(ctx)` |
| `solution.ts` | `Solution` grid + `computeStats` |
| `quality.ts` | **Coach-facing** `LineupQuality`: metrics, `checks[]`, score — scored against what is *achievable*, not a theoretical ideal |
| `validate.ts` | Post-solve invariants (UNFILLED_POSITION, DUPLICATE_PLAYER, UNAVAILABLE_PLAYER, FORBIDDEN_POSITION, …). Failure → `ok: false` |
| `feasibility.ts` | Pre-solve infeasibility detection → `Conflict[]` + `RelaxationSuggestion[]` |
| `explain.ts` | **`explainLineup()`** — up to 7 plain-language reasons, ranked by how surprising the decision is |
| `batting.ts` | Batting order under the 4 philosophies |
| `rng.ts` | Seeded RNG — determinism |

`OptimizationInput` already accepts: `lockedAssignments`, `lockedBattingSlots`,
`pitchingPlan`, `eligibilityOverrides`, **`frozenInnings` + `frozenAssignments`**
(mid-game rebalance), `seed`, `fairnessDebt`, `seasonUsage`,
`developmentGoals`, `priorityFlags`.

`OptimizationResult` already returns: `defensive`, `bench`, `batting`,
`quality` (metrics + **checks** + score), **`explanations`**, **`conflicts`**,
**`relaxations`** (with structured one-tap `action`s), seed, version, elapsedMs,
iterations.

**The redesign's Fairness Notes, Rule Checks and Fix-automatically actions are
all already backed by the engine.** What is genuinely missing is *per-cell*
"why this assignment?" — `explain.ts` is lineup-level.

## 5. Fairness (`services/fairness.ts`, `services/seasonStatistics.ts`)

- `getFairnessDebt(games, players)` → per-player `defensiveDebt`, `infieldDebt`, …
- `getTeamSeasonFairness` → averageDefensiveInnings, averageBenchInnings,
  averageInfieldInnings, averageOutfieldInnings, `balanceScore` (0..1),
  `alerts[]` (each with `playerId` + `priorityKind` for one-tap Prioritize)
- Alert thresholds: defensiveInnings 3, infieldInnings 3, benchInnings 2,
  positionConcentration 0.4, bottomThirdGames 3
- `getPlayerSeasonUsage`, `getPositionDistribution`,
  `getPositionGroupDistribution`, `getBenchDistribution`,
  `getBattingSlotDistribution`, `getPlayerGameLog`
- `effectiveAssignments(game)` — **ACTUAL wins over PLANNED per *inning*, not
  per cell.** Per-cell fallback made corrections impossible to record
- `countedInnings(game)` = `actualInnings ?? plannedInnings`; only
  `status === 'COMPLETED'` games count
- **Expectation is attendance-weighted**: a player's fair share is proportional
  to the innings they were *available for*. Missing a game accrues no debt
- **The inning is the atom. Partial innings never affect fairness.**
- Bench innings are **derived**, never stored

## 6. Lineup service (`services/lineupService.ts`)

`generateLineup`, `applyResultToGame` (keeps ACTUAL rows across regeneration),
`plannedGrid`, `assignmentsForInning`, `benchedPlayerIds`,
**`setAssignment(game, inning, positionId, playerId, type)`** (swaps rather than
duplicating), `toggleLock`, `setInningLocked`, `setPlayerScheduleLocked`,
`setBattingSlotLocked`, `setBattingOrder`, `regenerateBattingOrder`,
`recordActualResults`, `updateActualAssignment`,
**`materializeActualInning`** (copies the plan into the record before editing
it, so one ACTUAL cell does not erase the inning), `setAvailability`,
`rotateBattingOrder`.

## 7. Game-day (`lib/gameDayChanges.ts`, components)

- `extraInningFor(view, inning)` → `{summary, warning, blocked}` — the full
  consequence of a pitcher going another inning, **shown before committing**
- `extraInningPlan(view)`, `pitchingCap`, `plannedPitchingInnings`,
  `primaryPitcherPosition`
- `SomeoneOutSheet` — who, then when (right now / after this inning); records
  departure, freezes played innings, rebalances
- `AttendanceBar` — availability + Rebalance in the same place
- `LiveView` — one inning, arm's-length type, inline `was` column, read-only by
  design (a mis-tap mid-game costs the lineup)
- `FieldView` — diamond, drag/tap to assign, inning scrubber
- Frozen innings: `Keep innings 1–N` select feeding `frozenInnings`

## 8. Views, print, share

Four views on one game: **By inning** (planning grid, locks, pins),
**By player** (transposed, group rails), **Field** (diamond), **Live** (dugout).
Print: **full**, **compact** (clipboard), **dugout wall sheet** (big type, REST
on grey). `print-color-adjust: exact`. Share: `lib/shareLink.ts` → `/s/[token]`,
read-only, no account, abbreviated names.

## 9. Permissions, persistence, offline

- `TeamRole` = HEAD_COACH | ASSISTANT; `Permission` union; `can(role, perm)`
- Assistants may edit exactly `positionRatings`, `overallTier`, `canPitch`,
  `canCatch` — enforced in `firestore.rules`, with a test that fails if the
  rules and `ASSISTANT_EDITABLE_PLAYER_FIELDS` drift apart
- `MAX_ASSISTANT_COACHES = 2`; invite by email, claim on first sign-in
- Repositories (`data/repositories.ts`) are the only storage contract;
  `localStore` and `firestoreStore` implement it
- Firestore: **persistent local cache, single tab** — coaches are on a field
  with one bar. `ignoreUndefinedProperties: true`
- `migratePlayer` reduces legacy `lastName` → `lastInitial` at the read choke
  point in both stores
- Demo team seeding (`data/seed.ts`), demo mode banner, `MoveLocalData`
- `feedback` is create-only and unreadable by clients

## 10. Design system in place

`globals.css`: dark-first Broadcast tokens, `@media (prefers-color-scheme:
light)` override. `--bg/--surface/--surface-raised/--surface-muted/--border/
--border-strong`, `--ink/--ink-muted/--ink-subtle/--ink-inverse`,
`--brand/--accent` (lime #d4ff3d dark, #5f7800 light), position groups
`--battery/--infield/--outfield/--bench` (+ `-soft`), semantic
`--positive/--caution/--critical`, `--brand-green` (logo only, explicitly NOT
functional). Classes: `.scoreboard`, `.display`, `.eyebrow`, `.paper`,
`.sweep-in`, `.rise`, `.tnum`, `.ring-focus`.

`components/ui.tsx`: Button, Card, CardHeader, Label, Input, Textarea, Select,
Badge, Toggle, SegmentedControl, GROUP_STYLE, PadlockIcon, PinIcon, LockToggle,
EmptyState, Spinner, Notice, Modal, Meter, StatTile, PlayerChip.

`scripts/validate_palette.mjs` — **34 checks**: pairwise CIEDE2000 under
normal/protan/deutan/tritan vision, group-on-surface, group-on-own-fill,
ink-on-fill, group-vs-accent. Run by `npm run validate:palette`. **Colour is
never the only cue** anywhere, and selection states carry a check mark and a
heavier ring as well as a tint.

## 11. Tests protecting the engine (177 passing, 20 files)

`optimizer/seasonSimulation.test.ts` (10-game fairness drift bounds, short-game
recovery, position spread, who-sits-first rotation), `services/workflow.test.ts`,
`services/compareService.test.ts`, `services/recordCorrection.test.ts`
(10 tests — corrections, planned-vs-actual, materialisation),
`lib/gameDayChanges.test.ts`, `lib/schedule.test.ts`, `lib/playerNames.test.ts`,
`lib/rosterImport.test.ts`, `lib/shareLink.test.ts`, `lib/feedback.test.ts`,
`data/firestoreRules.test.ts` (13 — rules vs domain drift),
`data/migratePlayer.test.ts`, `data/seed.test.ts`.

Playwright e2e exists (`e2e/`, port 3210) but **has never been run** — Chromium
cannot launch in the build sandbox.

## 12. Known debt / hazards

1. `src/app/games/[gameId]/page.tsx` is ~640 lines and owns setup, generation,
   four views, batting order, pickers and two sheets. **This is the main
   refactor target.**
2. `GameSetupPanels.tsx` is ~770 lines with 16 advanced keys.
3. No native app, no export (CSV/PDF), no pitch counts, no rest-day
   eligibility, no mandatory-play check, no league presets, no import from
   GameChanger/TeamSnap, no club/league tier, no parent-facing card.
4. `useSearchParams` needs a Suspense boundary (done on `/feedback`).
5. `npm run build` while the dev server runs corrupts `.next` — stop the server
   first.
