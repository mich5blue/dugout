import { createGame, createPlayer, createTeam } from '@/domain/factories';
import { getSystemFormation } from '@/domain/formations';
import type { DefensiveAssignment, Game, Player, Team } from '@/domain/types';
import { defaultTeamSettings } from '@/domain/weights';
import { buildGameView, type GameView } from '@/lib/gameView';

/**
 * A small, fixed lineup for the guide's illustrations.
 *
 * The guide shows the real components rather than pasted-in screenshots. A PNG
 * of a grid goes stale the moment the grid changes, and a stale picture in a
 * help page teaches the wrong UI — worse than no picture. Rendering the actual
 * LineupGrid, PlayerGrid and FieldView against this fixture means the pictures
 * cannot drift from the product, and they follow the theme into light mode.
 *
 * Built by hand rather than by running the optimizer: the guide must render
 * synchronously, identically every time, and never depend on solver behaviour
 * that is free to change.
 */

const NAMES: Array<[string, string, string]> = [
  ['Ada', 'L', '4'],
  ['Bo', 'N', '7'],
  ['Cruz', 'M', '11'],
  ['Dev', 'P', '2'],
  ['Eli', 'R', '9'],
  ['Fern', 'S', '5'],
  ['Gus', 'T', '14'],
  ['Hana', 'W', '3'],
  ['Ivo', 'B', '8'],
  ['Juno', 'C', '6'],
  ['Kit', 'D', '12'],
];

/** Position codes in the order the four innings rotate through them. */
const ROTATION = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LC', 'RC', 'RF'];

const INNINGS = 4;

export interface GuideSample {
  team: Team;
  players: Player[];
  game: Game;
  view: GameView;
}

/**
 * The fixture. Deterministic: same ids, same assignments, every call.
 *
 * Ids are fixed strings rather than createId() output so a React key or a
 * snapshot never changes between renders of the same page.
 */
export function guideSample(): GuideSample {
  const formation = getSystemFormation('baseball-10-lc-rc')!;

  const team: Team = {
    ...createTeam({
      name: 'Balsam Waters',
      sport: 'BASEBALL',
      division: 'Little League Minors',
      defaultInnings: INNINGS,
      defaultFormationId: formation.id,
      settings: defaultTeamSettings(),
    }),
    id: 'guide-team',
  };

  const players: Player[] = NAMES.map(([firstName, lastInitial, jerseyNumber], index) => ({
    ...createPlayer({
      teamId: team.id,
      firstName,
      lastInitial,
      jerseyNumber,
      // Enough of each so the battery rotates rather than pinning one player.
      canPitch: index % 3 === 0,
      canCatch: index % 4 === 1,
    }),
    id: `guide-player-${index}`,
    // A spread of tiers, so the colour coding in the previews has something
    // to show rather than eleven identical chips.
    overallTier: index % 5 === 0 ? 'CORE' : index % 4 === 3 ? 'DEVELOPING' : 'REGULAR',
    createdAt: `2026-03-0${(index % 9) + 1}T00:00:00.000Z`,
  }));

  const base = createGame({
    teamId: team.id,
    opponent: 'Cardinals',
    date: '2026-04-18',
    plannedInnings: INNINGS,
    formation,
    settings: team.settings,
    players,
  });

  const positionByCode = new Map(formation.positions.map((p) => [p.code, p]));

  /*
    A straight rotation: everyone shifts one spot along each inning, so each
    player visits several positions and one player sits each inning. It is the
    shape a real lineup has, without pretending to be optimizer output.
  */
  const defensiveAssignments: DefensiveAssignment[] = [];
  for (let inning = 1; inning <= INNINGS; inning++) {
    ROTATION.forEach((code, slot) => {
      const position = positionByCode.get(code);
      if (!position) return;
      const player = players[(slot + inning - 1) % players.length];
      defensiveAssignments.push({
        id: `guide-asg-${inning}-${code}`,
        gameId: 'guide-game',
        inning,
        positionId: position.id,
        playerId: player.id,
        // One locked cell, so the guide's picture of a lock is a real lock.
        locked: inning === 1 && code === 'P',
        assignmentType: 'PLANNED',
      });
    });
  }

  const game: Game = {
    ...base,
    id: 'guide-game',
    defensiveAssignments,
    battingAssignments: players.map((player, index) => ({
      gameId: 'guide-game',
      playerId: player.id,
      battingSlot: index + 1,
      locked: index === 0,
    })),
    gamePlayers: players.map((player) => ({ playerId: player.id, available: true })),
    createdAt: '2026-04-01T00:00:00.000Z',
  };

  return { team, players, game, view: buildGameView(game, players) };
}
