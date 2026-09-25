# Redesign plan

The engine stays. The way a coach reaches it changes. See `inventory.md` for
what must not break.

## The workflow we are building toward

```
GAME  →  WHO'S HERE?  →  HOW DO YOU WANT TO COACH?  →  GENERATE  →  ADJUST  →  PLAY
```

Everything else is one layer down.

## Navigation: 6 items → 5

| Now | After |
| --- | --- |
| Dashboard · Schedule · Roster · Season · Coaches · Team Settings | **Home · Team · Games · Season · Settings** |

Routes stay where they are — relabelling costs nothing and moving them breaks
every share link and bookmark. `Roster` becomes **Team** and absorbs a link to
`/coaches`, which is where a coach looks for it anyway. `?` (guide/feedback)
stays outside the tab set.

## Routes

| Route | Change |
| --- | --- |
| `/` | Rebuilt: next game dominant, context-aware CTA, plain-English fairness snapshot, alerts |
| `/games/new` | Becomes step 1 of the build flow; saves the game on leaving step 1 so it exists in the schedule |
| `/games/[gameId]/build` | **New.** Steps 2–4: Who's here → How to coach → Generate |
| `/games/[gameId]` | **The hero screen.** Batting order · defensive grid · fairness notes + rule checks. Setup panels move into the flow |
| `/games/[gameId]/live` | **New.** Game Day mode: own bare layout, field-first, quick actions with impact preview |
| `/season` | Plain-English Owed / On Target / Ahead over the existing charts; forecast |
| everything else | Preserved as-is |

## Component architecture

Break up `games/[gameId]/page.tsx` (640 lines, owns everything) into:

```
components/game/
  build/            GameBuilderSteps, WhosHere, HowToCoach, GenerateStep
  hero/             LineupWorkspace (3-pane), FairnessNotes, RuleChecks, WhyPanel
  live/             GameDayShell, FieldNow, BattingNow, QuickActions, ImpactSheet
```

Existing components to reuse unchanged: `LineupGrid`, `PlayerGrid`, `FieldView`,
`BattingOrderPanel`, `AssignmentPicker`, `SomeoneOutSheet`, `AttendanceBar`,
`QualitySummary`, `ShareActions`, all of `ui.tsx`, all of `season/charts.tsx`.

`GameSetupPanels.tsx` keeps `RulesPanel` and `PitchingPlanPanel` as the
Advanced layer; its plain-language grouped controls are new and live in
`HowToCoach`.

## Philosophy presets → engine settings

Presets are **configurations of one engine**, never separate algorithms.
`domain/weights.ts` already has `applyPhilosophy(settings, philosophy)`. The
three cards in the new Rules step map straight onto it:

| Card | `philosophy` | What the coach is told |
| --- | --- | --- |
| Balanced | `BALANCED` | "Keep playing time and opportunities as equal as possible." |
| Development | `DEVELOPMENT` | "Prioritise rotation, position exposure and new experience." |
| Competitive | `COMPETITIVE` | "Strongest lineup that still respects required playing time." |

`EQUAL_PLAYING_TIME` stays reachable from Advanced, and any manual dial change
flips `philosophy` to `CUSTOM` as it does today.

## Plain English

Every rule gets a coach-facing sentence. The wording lives in one place so the
flow, the settings page and the guide cannot disagree:
`domain/ruleCopy.ts` (new) — `{ key, label, help, group }` keyed by settings
field, with `app/guide/settingsReference.ts` reading from it rather than
repeating it.

Groups, in this order: **Playing time · Position development · Pitching &
catching · Batting order · Bench & substitutions**, then **Advanced rules →**.

## What is genuinely new engine work

1. **Per-cell "Why this assignment?"** — `explain.ts` is lineup-level. Add
   `explainAssignment(ctx, solution, inning, positionId)` returning the reasons
   that cell holds: eligibility, position not yet played today, infield debt,
   pitching plan, lock.
2. **Fairness forecast** — project the season forward at the current rotation.
3. **Pitch counts + rest eligibility** — new cross-game state, same shape as
   fairness debt. Architecture now, implementation after the redesign.
4. **League rule presets** — real configuration, never faked compliance.
5. **Parent card** — a read-only player season view on the existing share-link
   mechanism.

## Preserving behaviour

- Characterisation tests exist for the engine (177 passing). Run them after
  every step; they are the contract.
- The palette validator (`npm run validate:palette`) runs before any token
  change ships.
- Nothing is deleted from `RuleSettings`. Controls move; fields stay.
- `settingsSnapshot` per game keeps history stable — the flow writes to the
  game's snapshot, never retroactively.

## Order of work

1. Design-system additions (chips, step header, sheet, field tokens)
2. App shell → 5 items
3. Home
4. Build flow: Game → Who's here → How to coach → Generate
5. Hero lineup: 3-pane, fairness notes, rule checks, why-this-cell
6. Game Day mode
7. Season plain English + forecast
8. Mobile / tablet polish
9. Print & share polish

---

## Status — 25 Sept 2026

Done and verified in the running app:

1. **Design-system additions** — `StepHeader`, `FlowFooter`, editable grid cells,
   bottom sheets with safe-area padding and a grab handle.
2. **App shell** — five destinations. `/roster` → `/team` with redirects.
3. **Home** — next game dominant, context-aware primary action
   (`lib/nextAction.ts`), Owed / On target / Ahead, named alerts.
4. **Build flow** — `/games/[gameId]/build`: Game → Who's here → How to coach →
   Generate. Three attendance states with no model change. Philosophy cards
   drive real engine settings.
5. **Hero lineup** — three panes, by-player grid, fairness notes, rule checks,
   per-cell "why this assignment?" (`lib/whyAssignment.ts`), locks, Rebalance,
   Try another, Undo.
6. **Game Day** — `/games/[gameId]/live`, own full-screen dark surface,
   persisted live state, field-first, impact preview before committing.
7. **Season** — outlook sentence, at-risk names, expected-vs-actual cards.
8. **Mobile** — every route measured at 375px; overflow fixed, touch targets
   ≥40px on game day, dead controls removed from read-only views.

The brief's Phase 5 scenario was walked end to end: build for 10 of 11, hit an
infeasible sixth inning, take the offered fix, start the game, keep the pitcher
on an extra inning, finish after five. Walter (missed two games) finished +0.8
debt; Mehki (left early) +0.4. Opportunity, not attendance.

### Not built yet

Listed so they are not mistaken for done:

- **League rule presets** (brief §24) — Little League Minors/Majors, Travel,
  Rec. Needs verified per-division configuration, not invented defaults.
- **Pitch counts and rest-day eligibility** (§23) — the architecture note
  stands: same cross-game shape as fairness debt. Nothing built.
- **Parent-facing fairness card** (§22) — the data and the share-link mechanism
  both exist; the surface does not.
- **Drag in the by-player grid** (§12) — tap-to-change and locks work; drag
  works only in the Field view. Redo is not implemented; undo is.
- **Compare summaries** (§15) — `/games/[gameId]/compare` still shows three
  grids rather than the one-line summaries the brief asks for.
- **Import from GameChanger / TeamSnap, CSV** (§25) — photo and paste only.
- **Print polish** (§26) — the three existing sheets are unchanged and still
  good; no parent view.
- **Tablet-specific layout** (§30) — game day goes two-column from `lg`, which
  covers landscape, but the planning screens have had no dedicated tablet pass.
- **Playwright e2e** — still never run; Chromium cannot launch in this sandbox.
