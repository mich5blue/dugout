'use client';

import { useDugout } from '../providers';
import {
  Button,
  Card,
  CardHeader,
  Input,
  Label,
  SegmentedControl,
  Select,
  Textarea,
  Toggle,
} from '@/components/ui';
import {
  DEFAULT_FORMATION_BY_SPORT,
  systemFormationsForSport,
} from '@/domain/formations';
import { createPlayer, createTeam, parseQuickAddRoster } from '@/domain/factories';
import type { BattingFormat, Sport } from '@/domain/types';
import { defaultTeamSettings } from '@/domain/weights';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

const DIVISIONS = [
  'Coach Pitch',
  '8U',
  '9U',
  '10U',
  'Little League Minors',
  'Little League Majors',
  '12U',
  'Travel',
  'Other',
];

export default function SetupPage() {
  const router = useRouter();
  const { saveTeam, savePlayers } = useDugout();

  const [name, setName] = useState('');
  const [sport, setSport] = useState<Sport>('BASEBALL');
  const [division, setDivision] = useState('Little League Minors');
  const [seasonName, setSeasonName] = useState(`${new Date().getFullYear()} Season`);
  const [innings, setInnings] = useState(6);
  const [formationId, setFormationId] = useState(DEFAULT_FORMATION_BY_SPORT.BASEBALL);
  const [battingFormat, setBattingFormat] = useState<BattingFormat>('CONTINUOUS');
  const [rosterText, setRosterText] = useState('');
  const [saving, setSaving] = useState(false);

  const formations = useMemo(() => systemFormationsForSport(sport), [sport]);

  const changeSport = (next: Sport) => {
    setSport(next);
    setFormationId(DEFAULT_FORMATION_BY_SPORT[next]);
  };

  const rosterPreview = useMemo(
    () => parseQuickAddRoster(rosterText, 'preview'),
    [rosterText],
  );

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const team = createTeam({
        name,
        sport,
        division,
        seasonName,
        defaultInnings: innings,
        defaultFormationId: formationId,
        settings: { ...defaultTeamSettings(), battingFormat },
      });
      await saveTeam(team);

      const parsed = parseQuickAddRoster(rosterText, team.id);
      if (parsed.length > 0) {
        await savePlayers(
          parsed.map((spec, index) =>
            createPlayer({
              ...spec,
              teamId: team.id,
              createdAt: new Date(Date.now() + index).toISOString(),
            }),
          ),
        );
      }

      router.push(parsed.length > 0 ? '/roster' : '/roster');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Set up your team</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Two minutes now, and you never build a lineup by hand again.
        </p>
      </div>

      <Card>
        <CardHeader title="Team" />
        <div className="space-y-4 px-5 py-5">
          <div>
            <Label htmlFor="team-name">Team name</Label>
            <Input
              id="team-name"
              className="mt-1.5"
              placeholder="Balsam Waters"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </div>

          <div>
            <Label>Sport</Label>
            <SegmentedControl
              className="mt-1.5"
              value={sport}
              onChange={changeSport}
              options={[
                { value: 'BASEBALL', label: 'Baseball' },
                { value: 'SOFTBALL', label: 'Softball' },
              ]}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="division">Age / division</Label>
              <Select
                id="division"
                className="mt-1.5"
                value={division}
                onChange={(event) => setDivision(event.target.value)}
              >
                {DIVISIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="season">Season</Label>
              <Input
                id="season"
                className="mt-1.5"
                value={seasonName}
                onChange={(event) => setSeasonName(event.target.value)}
              />
            </div>
          </div>

          <div>
            <Label>Typical game length</Label>
            <SegmentedControl
              className="mt-1.5"
              value={String(innings)}
              onChange={(value) => setInnings(Number(value))}
              options={[
                { value: '5', label: '5 innings' },
                { value: '6', label: '6 innings' },
                { value: '7', label: '7 innings' },
              ]}
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Defensive formation"
          description="How many players your league puts on the field."
        />
        <div className="space-y-2 px-5 py-5">
          {formations.map((formation) => (
            <Toggle
              key={formation.id}
              active={formationId === formation.id}
              onClick={() => setFormationId(formation.id)}
              className="w-full"
            >
              <span>
                <span className="block text-sm font-semibold text-ink">
                  {formation.positions.length} Players
                </span>
                <span className="mt-0.5 block text-sm text-ink-muted">
                  {formation.positions.map((position) => position.code).join(' · ')}
                </span>
              </span>
              {formationId === formation.id ? (
                <span className="text-sm font-medium text-brand">Selected</span>
              ) : null}
            </Toggle>
          ))}
          <p className="pt-1 text-sm text-ink-muted">
            You can build a custom formation, or change the formation for a single
            game, any time in Team Settings.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Batting format" />
        <div className="px-5 py-5">
          <SegmentedControl
            value={battingFormat}
            onChange={setBattingFormat}
            options={[
              { value: 'CONTINUOUS', label: 'Continuous order' },
              { value: 'STARTERS_SUBS', label: 'Starters & subs' },
            ]}
          />
          <p className="mt-2 text-sm text-ink-muted">
            Most recreational leagues use a continuous batting order, where every
            player bats in turn regardless of who is on the field.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Roster"
          description="Optional — paste one player per line. You can add or edit players later."
        />
        <div className="px-5 py-5">
          <Textarea
            rows={7}
            placeholder={'Brody Borek\nRace Smith #12\nWeston Jones\nCalvin Miller'}
            value={rosterText}
            onChange={(event) => setRosterText(event.target.value)}
          />
          {rosterPreview.length > 0 ? (
            <p className="mt-2 text-sm text-ink-muted">
              {rosterPreview.length} {rosterPreview.length === 1 ? 'player' : 'players'}{' '}
              detected.
            </p>
          ) : null}
        </div>
      </Card>

      <div className="flex justify-end gap-2 pb-6">
        <Button variant="primary" size="lg" disabled={!name.trim() || saving} onClick={submit}>
          {saving ? 'Creating…' : 'Create team'}
        </Button>
      </div>
    </div>
  );
}
