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
