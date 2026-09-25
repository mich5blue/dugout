'use client';

import { GuideShot } from '@/components/guide/GuideShot';
import { FieldView } from '@/components/game/FieldView';
import { LineupGrid, PlayerGrid } from '@/components/game/LineupGrid';
import { BarChart, GroupLegend } from '@/components/season/charts';
import { Badge, Button, Card, CardHeader, GROUP_STYLE, Notice } from '@/components/ui';
import { defaultRuleSettings } from '@/domain/weights';
import type { RuleSettings } from '@/domain/types';
import { guideSample } from '@/lib/guideSample';
import { cn } from '@/lib/cn';
import { SETTINGS, type SettingDoc, type SettingGroup } from './settingsReference';
import Link from 'next/link';
import { useMemo, useState } from 'react';

/**
 * How to use InningGrid.
 *
 * Written for someone holding a phone in a parking lot twenty minutes before
 * first pitch, not for someone reading a manual at a desk — so it is ordered
 * by what you do rather than by where the controls live, every section is
 * skimmable on its own, and the pictures are the real components rather than
 * screenshots that would drift out of date.
 */

const SECTIONS = [
  { id: 'start', label: 'Start here' },
  { id: 'need', label: 'What you need' },
  { id: 'team', label: 'Create a team' },
  { id: 'roster', label: 'Your roster' },
  { id: 'game', label: 'Your first game' },
  { id: 'views', label: 'Reading a lineup' },
  { id: 'locks', label: 'Locks & Rebalance' },
  { id: 'gameday', label: 'Game day' },
  { id: 'after', label: 'After the game' },
  { id: 'season', label: 'Season numbers' },
  { id: 'print', label: 'Printing & sharing' },
  { id: 'coaches', label: 'Coaches & roles' },
  { id: 'options', label: 'Every option' },
  { id: 'colours', label: 'Colour coding' },
  { id: 'trouble', label: 'When it goes wrong' },
];

export default function GuidePage() {
  /* Built once: the fixture is deterministic, and it feeds five previews. */
  const sample = useMemo(() => guideSample(), []);
  const defaults = useMemo(() => defaultRuleSettings(), []);
  const [fieldInning, setFieldInning] = useState(1);

  return (
    <div className="space-y-10">
      <div>
        <p className="eyebrow text-accent">How to</p>
        <h1 className="display mt-2 text-4xl text-ink sm:text-5xl">
          Everything InningGrid does
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-muted">
          Set up a team, build your first lineup, and understand every option —
          including the ones behind Advanced. Pictures below are the real screens.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/setup">
            <Button variant="primary">Start a team</Button>
          </Link>
          <Link href="/feedback">
            <Button>Something unclear? Tell us</Button>
          </Link>
        </div>
      </div>

      {/*
        The contents list is the whole reason a page this long is usable. Real
        anchors, so a coach can send another coach a link straight to the bit
        that answers their question.
      */}
      <nav aria-label="On this page" className="rounded-xl border border-border bg-surface p-4">
        <p className="eyebrow mb-2.5 text-ink-subtle">On this page</p>
        <ul className="flex flex-wrap gap-1.5">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="ring-focus block rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section id="start" title="Start here" lede="What this thing actually does.">
        <p>
          You tell InningGrid who turned up. It builds a batting order and an
          inning-by-inning defense that spreads playing time, moves players around the
          field, and gives everyone time in the infield. After the game you record what
          was actually played, and the next game makes up whatever anybody missed.
        </p>
        <p>
          That last part is the whole point. One fair game is easy. A fair{' '}
          <em>season</em> needs somebody to remember that Ada has sat first in three
          games running, and that is the job InningGrid takes off you.
        </p>
        <Steps
          items={[
            'Create your team — roster, innings, how many players take the field.',
            'Mark who can pitch and who can catch.',
            'Create a game, toggle off anyone who is missing, hit Generate.',
            'Print the sheet or open the phone view in the dugout.',
            'After the game, record how many innings were actually played.',
          ]}
        />
      </Section>

      <Section
        id="need"
        title="What you need before you start"
        lede="Five minutes, and two things worth getting right."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Need title="Your roster" need>
            First names are enough. A jersey number helps when two players share a
            name. Last names are deliberately not stored — see{' '}
            <a className="text-accent hover:underline" href="#colours">
              names and privacy
            </a>
            .
          </Need>
          <Need title="Who can pitch and catch" need>
            The one thing that blocks a lineup. InningGrid needs a pitcher and a
            catcher for every inning, so aim for two or three of each.
          </Need>
          <Need title="How your league plays">
            Innings per game, and how many players take the field — nine, ten, or ten
            with a rover. Change it later any time.
          </Need>
          <Need title="Ability ratings">
            Optional. Leave everyone at Regular and InningGrid treats the roster as
            interchangeable, which is a perfectly good way to run a season.
          </Need>
        </div>
        <Notice tone="brand" className="mt-4">
          Nothing is saved until the last step of setup, so you can back out of the
          wizard without leaving a half-made team behind.
        </Notice>
      </Section>

      <Section
        id="team"
        title="Create a team"
        lede="Six screens, one decision each, every one changeable later."
      >
        <Steps
          items={[
            'Team — name, baseball or softball, age or division.',
            'Players — type one name per line, or import a photo of your roster or a lineup card. "Race Smith #12", "12 Race Smith" and "Race Smith, 12" all parse.',
            'Defense — innings per game and how many players take the field. InningGrid tells you right here how many players will sit each inning.',
            'Battery — who can pitch, who can catch. It warns you if you only pick one of either.',
            'Style — your coaching philosophy and whether you bat continuously.',
            'Ready — a summary, then Finish or go straight into your first game.',
          ]}
        />
        <p>
          If you coach two teams, run the wizard again from the team menu in the
          header. Your first team is untouched, and you switch between them there.
        </p>
      </Section>

      <Section
        id="roster"
        title="Your roster"
        lede="Where the detail lives, and what is safe to ignore."
      >
        <p>
          Open a player from the Team page. Everything on that page is optional
          except who can pitch and catch — but three fields change lineups noticeably:
        </p>
        <Definitions
          items={[
            {
              term: 'Overall ability — Developing, Regular, Core',
              detail:
                'Used for the positions your formation marks as important, and by Infield ability spread. It is not used to decide how much anyone plays.',
            },
            {
              term: 'Hitting',
              detail:
                'Only read by the Balanced and Competitive batting orders. Under Rotate fairly — the default — it is ignored entirely.',
            },
            {
              term: 'Position eligibility — Never, Avoid, Allowed, Preferred',
              detail:
                'Everyone is Allowed everywhere until you say otherwise. Use Never for a genuine safety issue, Avoid for "only if we have to", and Preferred to nudge without pinning.',
            },
          ]}
        />
        <p>
          You can also cap an individual&apos;s pitching or catching innings, which
          beats the team-wide cap — handy for a player coming back from an injury.
        </p>
      </Section>

      <Section
        id="game"
        title="Your first game"
        lede="Create, mark attendance, generate."
      >
        <Steps
          items={[
            'Games → New game. Opponent, date, innings — then InningGrid walks you through the rest.',
            "Who's here — tap anyone who isn't coming. Three states: here, out, or here for part of the game, which sets the innings they're available for.",
            'How to coach — pick Balanced, Development or Competitive. That is enough. Everything under it is optional, and Advanced holds the full set.',
            'Generate. A couple of seconds, and you have a full defense and batting order.',
            'Something wrong? Tap any cell to swap or bench a player, then Rebalance to rebuild the rest around your change.',
          ]}
        />
        <p>
          If InningGrid cannot build a lineup it tells you why, and offers the specific
          relaxation that would fix it — usually a minimum it cannot satisfy with the
          players present. It never silently ignores a rule you set.
        </p>
      </Section>

      <Section
        id="views"
        title="Four ways to read a lineup"
        lede="Same game, four questions."
      >
        <p>
          <strong className="text-ink">By player</strong> — the one the lineup screen
          opens on. One row per player, one column per inning, so &ldquo;where has Ada
          been all game&rdquo; is one look. Tap any cell to move somebody, or the padlock
          to hold it through a Rebalance.
        </p>
        <GuideShot
          label="Games → By player"
          caption="Pink is pitcher or catcher, cyan infield, purple outfield. A rest inning says REST."
        >
          <PlayerGrid view={sample.view} />
        </GuideShot>

        <p>
          <strong className="text-ink">By inning</strong> — the classic grid, positions
          down the side. This is the one to print for a clipboard.
        </p>
        <GuideShot
          label="Games → By inning"
          caption="A locked cell shows a padlock; the bench rows at the bottom are who is resting."
        >
          <LineupGrid view={sample.view} readOnly />
        </GuideShot>

        <p>
          <strong className="text-ink">Field</strong> — the diamond, one inning at a
          time. The fastest way to sanity-check an inning, and the easiest to show a
          player. Drag a name onto a spot to change it.
        </p>
        <GuideShot
          label="Games → Field"
          caption="Tap the inning numbers to step through the game."
        >
          <FieldView
            view={sample.view}
            inning={fieldInning}
            onInningChange={setFieldInning}
            readOnly
          />
        </GuideShot>

        <p>
          <strong className="text-ink">Live</strong> — a preview of the dugout view
          inside the planning screen. The real thing is <strong className="text-ink">Game
          Day</strong>: press Start game and InningGrid takes over the whole screen.
        </p>
      </Section>

      <Section
        id="locks"
        title="Locks, pins and Rebalance"
        lede="How to keep the bit you like and redo the rest."
      >
        <Definitions
          items={[
            {
              term: 'A padlock on a cell',
              detail:
                'Rebalance will not move that player out of that spot. Lock the two or three you care about, then Rebalance — do not hand-build the whole grid.',
            },
            {
              term: 'A pin on a cell',
              detail:
                'Same effect, different reason: the pitching plan put that pitcher in that inning. Clear it in the Pitching plan panel beside the grid.',
            },
            {
              term: 'A lock in the batting order',
              detail:
                'Holds a batting slot. Rebalance order reshuffles everyone else around it, and leaves the defense alone.',
            },
            {
              term: 'Rebalance',
              detail:
                'Rebuilds the lineup honouring every lock, every pin, and the innings you chose to keep. Use it after any change — a late arrival, a swap, someone going home.',
            },
          ]}
        />
      </Section>

      <Section
        id="gameday"
        title="Game day, when the plan meets reality"
        lede="Three buttons for the three things that actually happen."
      >
        <Definitions
          items={[
            {
              term: 'Your pitcher is cruising — one more inning',
              detail:
                'In Game Day, "Keep them pitching" names both sides of the swap before anything changes — your pitcher stays on, and whoever was down to pitch goes somewhere else. Then you choose: update the rotation, or keep the original plan.',
            },
            {
              term: 'Someone has to come out',
              detail:
                '"Someone out" asks who, and whether it is right now or after this inning. It records their departure, freezes the innings already played, and rebuilds the rest.',
            },
            {
              term: 'The game gets called early',
              detail:
                'Nothing to do during the game. Afterwards, record the innings that were actually played — the rest never happened, and never count against anybody.',
            },
          ]}
        />
        <Notice tone="brand">
          Partial innings do not affect fairness. A game called in the fourth counts as
          four innings for everyone who was there, and nobody carries a debt for the
          two that were rained off.
        </Notice>
      </Section>

      <Section
        id="after"
        title="After the game"
        lede="The two minutes that make the season fair."
      >
        <p>
          Your dashboard and schedule show any game that has been played but not
          recorded, with one-tap answers: <strong className="text-ink">Played all 6</strong>,{' '}
          <strong className="text-ink">Fewer innings</strong>, or{' '}
          <strong className="text-ink">Didn&apos;t play</strong>. That is usually the
          whole job.
        </p>
        <p>
          Recording a result turns the plan into a record. From then on, the season
          counts what happened rather than what was planned — and editing a completed
          game corrects the record. The game page says{' '}
          <strong className="text-ink">Recorded result</strong> at the top when you are
          in that mode, so a correction is never mistaken for a plan change.
        </p>
        <Definitions
          items={[
            {
              term: 'Brody sat the fourth and was not supposed to',
              detail:
                'Open the game, tap his cell in that inning, Move to bench. The season picks it up immediately: one fewer defensive inning, one more rest inning, and the fairness debt moves.',
            },
            {
              term: 'Edit results',
              detail:
                'The full grid, for a game that went differently in several places. Reachable from the game header.',
            },
          ]}
        />
      </Section>

      <Section
        id="season"
        title="What every season number means"
        lede="Only recorded games count. Nothing here is a guess."
      >
        <Definitions
          items={[
            {
              term: 'Season balance',
              detail:
                'How close actual playing time is to what each player should have had, given the games they were available for. Above 80 is a season nobody will complain about.',
            },
            {
              term: 'Spread',
              detail:
                'The gap between the most and fewest defensive innings on the roster. The single most useful fairness number, because it is the one a parent computes in their head.',
            },
            {
              term: 'Debt',
              detail:
                'Expected innings minus actual. Positive means InningGrid owes that player innings and will favour them in the next lineup; negative means they are ahead.',
            },
            {
              term: 'Rest',
              detail:
                'Innings a player was available for and did not take the field. Derived, not recorded — so it is always consistent with the defensive innings beside it.',
            },
            {
              term: 'Spots',
              detail:
                'How many different positions a player has seen this season. The variety counterpart to playing time, and where being parked in right field shows up.',
            },
          ]}
        />
        <GuideShot
          label="Season → Playing time"
          caption="Bars split by group, with a hairline at the team average. A lime name is a player the next lineup will favour."
        >
          <div className="min-w-[420px]">
            <GroupLegend groups={['BATTERY', 'INFIELD', 'OUTFIELD']} className="mb-3" />
            <BarChart
              rows={sample.players.slice(0, 5).map((player, index) => ({
                id: player.id,
                label: player.firstName,
                value: 22 - index,
                segments: [
                  { group: 'BATTERY' as const, value: 6 - index },
                  { group: 'INFIELD' as const, value: 8 },
                  { group: 'OUTFIELD' as const, value: 8 },
                ],
                highlight: index === 4,
              }))}
              average={20.4}
            />
          </div>
        </GuideShot>
      </Section>

      <Section
        id="print"
        title="Printing and sharing"
        lede="Three sheets, for three different readers."
      >
        <Definitions
          items={[
            {
              term: 'Lineup card',
              detail:
                'The by-inning grid on paper, for your clipboard. Backgrounds print, so the colour coding survives.',
            },
            {
              term: 'By-player grid',
              detail:
                'One row per player, in batting order — so the sheet you use to call batters is also the sheet that tells you where everyone goes.',
            },
            {
              term: 'Dugout wall sheet',
              detail:
                'Big type, one row per player, for taping inside the dugout so players can find themselves without asking. A rest inning reads REST on grey.',
            },
            {
              term: 'Share link',
              detail:
                'A read-only link for parents and assistant coaches. No account needed to open it, and it shows names the same abbreviated way the app does.',
            },
          ]}
        />
      </Section>

      <Section
        id="coaches"
        title="Coaches and roles"
        lede="Who can change what."
      >
        <Definitions
          items={[
            {
              term: 'Head coach',
              detail: 'Everything — roster, settings, lineups, results, other coaches.',
            },
            {
              term: 'Assistant coach',
              detail:
                'Can set positions and mark core players. Everything else is read-only, and a banner says so rather than leaving them wondering why a button is missing.',
            },
            {
              term: 'Parents',
              detail:
                'No account. Send a share link — it is read-only and needs no sign-in.',
            },
          ]}
        />
      </Section>

      <Section
        id="options"
        title="Every option, and when to touch it"
        lede="Defaults are read straight out of the code, so this table cannot go stale."
      >
        <OptionTable defaults={defaults} />
      </Section>

      <Section
        id="colours"
        title="Colour coding, names and privacy"
        lede="What the colours mean, and what is deliberately not stored."
      >
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['BATTERY', 'Pitcher and catcher'],
              ['INFIELD', 'Infield'],
              ['OUTFIELD', 'Outfield'],
              ['BENCH', 'Resting'],
            ] as const
          ).map(([group, label]) => (
            <span
              key={group}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-ink"
            >
              <span aria-hidden className={cn('size-3 rounded-full', GROUP_STYLE[group].dot)} />
              {label}
            </span>
          ))}
        </div>
        <p>
          Colour is never the only cue — every coloured thing also carries a number, a
          position code or a label, and the palette is checked against red-green and
          blue-yellow colour blindness.
        </p>
        <p>
          <strong className="text-ink">Names.</strong> InningGrid stores a first name
          and at most a last initial — never a surname. Rosters of children end up on
          printed sheets, taped to a dugout wall and forwarded through group chats, and
          the surname is the field that turns a first name into an identifiable child.
          Two players sharing a first name are separated by jersey number first, and
          only then by an initial.
        </p>
      </Section>

      <Section
        id="trouble"
        title="When it goes wrong"
        lede="The five things that actually come up."
      >
        <Definitions
          items={[
            {
              term: '"It won\'t generate a lineup"',
              detail:
                'Almost always nobody marked able to pitch or catch, or a Required minimum that the players present cannot satisfy. The error names the rule and offers to relax it.',
            },
            {
              term: '"I have fewer players than the formation needs"',
              detail:
                'Pick a formation your roster can fill — the setup wizard offers the ones that fit. Nine players on a ten-player formation cannot work.',
            },
            {
              term: '"I changed a finished game and the season did not move"',
              detail:
                'Check the banner at the top of the game says Recorded result. If it does, the season updates as soon as you save. If the game is still Planned, record the result first.',
            },
            {
              term: '"The same kid keeps pitching"',
              detail:
                'Mark more players able to pitch. With one pitcher there is no decision to make, and no setting can make it fair.',
            },
            {
              term: '"Someone is always in the outfield"',
              detail:
                'Raise Infield opportunity, or set a Max outfield innings cap. Check Critical position strength is not fighting you at High.',
            },
          ]}
        />
        <Card className="mt-6">
          <CardHeader
            title="Still stuck, or something is just confusing?"
            description="That is a bug in the guide as much as in the app. Tell us — it is one screen."
          />
          <div className="px-5 pb-5">
            <Link href="/feedback">
              <Button variant="primary">Send feedback</Button>
            </Link>
          </div>
        </Card>
      </Section>
    </div>
  );
}

function Section({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    /* scroll-mt keeps the heading clear of the sticky app header when the
       reader arrives from the contents list. */
    <section id={id} className="scroll-mt-24">
      <h2 className="display text-2xl text-ink sm:text-3xl">{title}</h2>
      {lede ? <p className="mt-1.5 text-sm text-ink-subtle">{lede}</p> : null}
      <div className="mt-4 space-y-3.5 text-[15px] leading-relaxed text-ink-muted">
        {children}
      </div>
    </section>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="my-4 space-y-2.5">
      {items.map((item, index) => (
        <li key={item} className="flex gap-3">
          <span className="tnum mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-ink">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 text-[15px] leading-relaxed text-ink-muted">
            {item}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Definitions({ items }: { items: Array<{ term: string; detail: string }> }) {
  return (
    <dl className="my-4 divide-y divide-border rounded-xl border border-border">
      {items.map((item) => (
        <div key={item.term} className="px-4 py-3">
          <dt className="text-sm font-semibold text-ink">{item.term}</dt>
          <dd className="mt-1 text-sm leading-relaxed text-ink-muted">{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

function Need({
  title,
  need = false,
  children,
}: {
  title: string;
  /** Marks the two things that actually block a lineup. */
  need?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {need ? <Badge tone="caution">Needed</Badge> : <Badge tone="neutral">Optional</Badge>}
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{children}</p>
    </div>
  );
}

const GROUPS: SettingGroup[] = [
  'Playing time',
  'Bench',
  'Variety',
  'Positions',
  'Battery',
  'Batting',
];

function OptionTable({ defaults }: { defaults: RuleSettings }) {
  const [advancedOnly, setAdvancedOnly] = useState(false);
  const rows = advancedOnly ? SETTINGS.filter((setting) => setting.advanced) : SETTINGS;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setAdvancedOnly((value) => !value)}>
          {advancedOnly ? 'Show all options' : 'Only the advanced ones'}
        </Button>
        <span className="text-xs text-ink-subtle">
          {rows.length} of {SETTINGS.length} options
        </span>
      </div>

      <div className="space-y-6">
        {GROUPS.map((group) => {
          const groupRows = rows.filter((setting) => setting.group === group);
          if (groupRows.length === 0) return null;
          return (
            <div key={group}>
              <p className="eyebrow mb-2 text-ink-subtle">{group}</p>
              <dl className="divide-y divide-border rounded-xl border border-border">
                {groupRows.map((setting) => (
                  <OptionRow key={setting.name} setting={setting} defaults={defaults} />
                ))}
              </dl>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OptionRow({
  setting,
  defaults,
}: {
  setting: SettingDoc;
  defaults: RuleSettings;
}) {
  return (
    <div className="px-4 py-3.5">
      <dt className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">{setting.name}</span>
        {setting.advanced ? <Badge tone="neutral">Advanced</Badge> : null}
      </dt>
      <dd className="mt-1.5 space-y-1.5">
        <p className="text-sm leading-relaxed text-ink-muted">{setting.what}</p>
        <p className="text-xs text-ink-subtle">
          <span className="font-semibold text-ink-muted">Where:</span> {setting.where}
          {' · '}
          <span className="font-semibold text-ink-muted">Default:</span>{' '}
          {setting.key ? formatDefault(defaults, setting.key) : setting.fallback}
        </p>
        <p className="text-sm leading-relaxed text-ink-muted">
          <span className="font-semibold text-ink">When to change it: </span>
          {setting.when}
        </p>
      </dd>
    </div>
  );
}

const WORDS: Record<string, string> = {
  EQUAL: 'Equal',
  MOSTLY_EQUAL: 'Mostly equal',
  COMPETITIVE: 'Competitive',
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  OFF: 'Off',
  TARGET: 'Target',
  REQUIRED: 'Required',
  ROTATE_FAIRLY: 'Rotate fairly',
  BALANCED: 'Balanced',
  MANUAL: 'Manual',
};

/**
 * The shipped default, in the words the control uses.
 *
 * Reads the real settings object rather than a copy written into this file.
 * The first draft of the reference hand-wrote these and got four of them
 * wrong — minimum innings, unique positions, critical strength and infield
 * spread were all documented as off when they ship on.
 */
function formatDefault(defaults: RuleSettings, key: keyof RuleSettings): string {
  const value = defaults[key];

  if (value === undefined || value === null) return 'Off';
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'number') {
    if (value === 0) return 'Off';
    return `${value} ${value === 1 ? 'inning' : 'innings'}`;
  }
  if (typeof value === 'string') return WORDS[value] ?? value;

  // InfieldOpportunity: a mode, plus innings when it is on.
  if (typeof value === 'object' && 'mode' in value) {
    if (value.mode === 'OFF') return 'Off';
    return `${WORDS[value.mode] ?? value.mode}, ${value.innings} ${
      value.innings === 1 ? 'inning' : 'innings'
    }`;
  }
  return String(value);
}
