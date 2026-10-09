import { describe, expect, it } from 'vitest';
import type { Game } from '@/domain/types';
import { buildScenario } from '@/test/fixtures';
import {
  attendanceOf,
  copyAttendance,
  previousGameFor,
  setAllAttendance,
  setAttendance,
  setAttendanceWindow,
} from './attendance';

const scenario = () =>
  buildScenario({ players: ['Ava', 'Ben', 'Cal'].map((name) => ({ name })), innings: 6 });

describe('attendance', () => {
  it('round-trips Here, Part and Out', () => {
    const { game, byName } = scenario();
    const id = byName('Ava').id;
    const find = (g: typeof game) => g.gamePlayers.find((gp) => gp.playerId === id)!;

    const part = setAttendance(game, id, 'LIMITED');
    expect(attendanceOf(find(part), 6)).toBe('LIMITED');
    expect(find(part).departureInning).toBe(5);

    const out = setAttendance(part, id, 'ABSENT');
    expect(attendanceOf(find(out), 6)).toBe('ABSENT');
    /* Back in from Out is Here, not a stale Part. */
    expect(attendanceOf(find(setAttendance(out, id, 'PRESENT')), 6)).toBe('PRESENT');
  });

  it('keeps an existing window when marked Part again', () => {
    const { game, byName } = scenario();
    const id = byName('Ben').id;
    const late = setAttendanceWindow(game, id, 'arrivalInning', 3);
    const again = setAttendance(late, id, 'LIMITED');
    const gp = again.gamePlayers.find((entry) => entry.playerId === id)!;
    expect(gp.arrivalInning).toBe(3);
    expect(gp.departureInning).toBeUndefined();
  });

  it('marks everyone at once', () => {
    const { game } = scenario();
    expect(setAllAttendance(game, 'ABSENT').gamePlayers.every((gp) => !gp.available)).toBe(true);
  });

  it('copies presence from the last game, not its windows', () => {
    const { game, byName } = scenario();
    const ava = byName('Ava').id;
    const ben = byName('Ben').id;
    let last: Game = { ...game, id: 'last', date: '2026-04-11', status: 'COMPLETED' };
    last = setAttendance(last, ava, 'ABSENT');
    last = setAttendanceWindow(last, ben, 'arrivalInning', 4);

    expect(previousGameFor(game, [game, last])?.id).toBe('last');
    const copied = copyAttendance(game, last);
    const byId = new Map(copied.gamePlayers.map((gp) => [gp.playerId, gp]));
    expect(byId.get(ava)!.available).toBe(false);
    expect(attendanceOf(byId.get(ben)!, 6)).toBe('PRESENT');
  });

  it('ignores games that are later or not played', () => {
    const { game } = scenario();
    const later = { ...game, id: 'later', date: '2026-05-01', status: 'COMPLETED' as const };
    const planned = { ...game, id: 'planned', date: '2026-04-01' };
    expect(previousGameFor(game, [later, planned])).toBeNull();
  });
});
