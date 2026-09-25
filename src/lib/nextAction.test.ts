import { describe, expect, it } from 'vitest';
import { createGame, createPlayer } from '@/domain/factories';
import { getSystemFormation } from '@/domain/formations';
import { defaultTeamSettings } from '@/domain/weights';
import { attendanceFor, nextActionFor } from '@/lib/nextAction';
import type { Game } from '@/domain/types';

/**
 * Home's primary button. Worth pinning: the whole redesign rests on the coach
 * being told one correct next step, and every branch here is a different
 * screen.
 */

const formation = getSystemFormation('baseball-10-lc-rc')!;

function game(overrides: Partial<Game> = {}): Game {
  const players = ['Ada', 'Bo', 'Cruz'].map((firstName, index) => ({
    ...createPlayer({ teamId: 't', firstName }),
    id: `p${index}`,
  }));
  return {
    ...createGame({
      teamId: 't',
      opponent: 'Cardinals',
      date: '2026-05-10',
      plannedInnings: 6,
      formation,
      settings: defaultTeamSettings(),
      players,
    }),
    ...overrides,
  };
}

const beforeTheGame = new Date('2026-05-01T12:00:00Z');
const gameDay = new Date('2026-05-10T12:00:00Z');

describe('nextActionFor', () => {
  it('asks for attendance first, because it blocks everything after it', () => {
    const subject = game();
    const action = nextActionFor(subject, beforeTheGame);
    expect(action.kind).toBe('CONFIRM_ATTENDANCE');
    expect(action.href).toBe(`/games/${subject.id}/build`);
  });

  it('moves to generating once attendance is confirmed', () => {
    const action = nextActionFor(
      game({ attendanceConfirmedAt: '2026-05-09T18:00:00Z' }),
      beforeTheGame,
    );
    expect(action.kind).toBe('GENERATE');
    expect(action.href).toContain('step=generate');
  });

  it('offers the lineup, not the dugout, before game day', () => {
    const withLineup = game({
      attendanceConfirmedAt: '2026-05-09T18:00:00Z',
      defensiveAssignments: [
        {
          id: 'a1',
          gameId: 'g',
          inning: 1,
          positionId: formation.positions[0].id,
          playerId: 'p0',
          locked: false,
          assignmentType: 'PLANNED',
        },
      ],
    });
    expect(nextActionFor(withLineup, beforeTheGame).kind).toBe('OPEN_LINEUP');
  });

  it('offers to start the game once the day arrives', () => {
    const withLineup = game({
      attendanceConfirmedAt: '2026-05-09T18:00:00Z',
      defensiveAssignments: [
        {
          id: 'a1',
          gameId: 'g',
          inning: 1,
          positionId: formation.positions[0].id,
          playerId: 'p0',
          locked: false,
          assignmentType: 'PLANNED',
        },
      ],
    });
    const action = nextActionFor(withLineup, gameDay);
    expect(action.kind).toBe('START_GAME');
    expect(action.href).toContain('/live');
  });

  it('returns a coach mid-game to the game', () => {
    expect(nextActionFor(game({ status: 'IN_PROGRESS' }), gameDay).kind).toBe(
      'CONFIRM_ATTENDANCE',
    );
    const started = game({
      status: 'IN_PROGRESS',
      defensiveAssignments: [
        {
          id: 'a1',
          gameId: 'g',
          inning: 1,
          positionId: formation.positions[0].id,
          playerId: 'p0',
          locked: false,
          assignmentType: 'PLANNED',
        },
      ],
    });
    expect(nextActionFor(started, gameDay).kind).toBe('START_GAME');
  });

  it('sends a finished game to review', () => {
    expect(nextActionFor(game({ status: 'COMPLETED' }), gameDay).kind).toBe('OPEN_LINEUP');
  });
});

describe('attendanceFor', () => {
  it('counts absent and limited separately from expected', () => {
    const base = game();
    const [a, b, c] = base.gamePlayers;
    const counted = attendanceFor({
      ...base,
      gamePlayers: [
        { ...a },
        { ...b, available: false },
        /* Coming, but leaving after the fourth: present and limited. */
        { ...c, departureInning: 4 },
      ],
    });

    expect(counted).toEqual({ expected: 2, absent: 1, limited: 1, total: 3 });
  });

  it('treats a late arrival as limited too', () => {
    const base = game();
    const counted = attendanceFor({
      ...base,
      gamePlayers: base.gamePlayers.map((gp, i) =>
        i === 0 ? { ...gp, arrivalInning: 3 } : gp,
      ),
    });
    expect(counted.limited).toBe(1);
    expect(counted.expected).toBe(3);
  });
});
