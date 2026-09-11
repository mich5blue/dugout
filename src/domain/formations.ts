import type {
  Formation,
  PositionDefinition,
  PositionGroup,
  PositionRole,
  Sport,
} from './types';

/** Criticality weight scale, used everywhere instead of bare numbers. */
export const CRITICAL_WEIGHT = {
  LOW: 0.25,
  NORMAL: 0.5,
  HIGH: 1.0,
} as const;

type PosSpec = {
  code: string;
  displayName: string;
  group: PositionGroup;
  role?: PositionRole;
  criticalWeight?: number;
  diagramX?: number;
  diagramY?: number;
};

function buildPositions(formationId: string, specs: PosSpec[]): PositionDefinition[] {
  return specs.map((spec, index) => ({
    id: `${formationId}:${spec.code}`,
    code: spec.code,
    displayName: spec.displayName,
    group: spec.group,
    role: spec.role,
    sortOrder: index,
    criticalWeight: spec.criticalWeight ?? CRITICAL_WEIGHT.NORMAL,
    diagramX: spec.diagramX,
    diagramY: spec.diagramY,
  }));
}

/** Shared infield/battery geometry for the diamond view (percent coordinates). */
const BATTERY_AND_INFIELD: PosSpec[] = [
  { code: 'P', displayName: 'Pitcher', group: 'BATTERY', role: 'PITCHER', criticalWeight: CRITICAL_WEIGHT.HIGH, diagramX: 50, diagramY: 62 },
  { code: 'C', displayName: 'Catcher', group: 'BATTERY', role: 'CATCHER', criticalWeight: CRITICAL_WEIGHT.HIGH, diagramX: 50, diagramY: 86 },
  { code: '1B', displayName: 'First Base', group: 'INFIELD', criticalWeight: CRITICAL_WEIGHT.HIGH, diagramX: 72, diagramY: 52 },
  { code: '2B', displayName: 'Second Base', group: 'INFIELD', diagramX: 62, diagramY: 38 },
  { code: '3B', displayName: 'Third Base', group: 'INFIELD', diagramX: 28, diagramY: 52 },
  { code: 'SS', displayName: 'Shortstop', group: 'INFIELD', criticalWeight: CRITICAL_WEIGHT.HIGH, diagramX: 38, diagramY: 38 },
];

const THREE_OUTFIELD: PosSpec[] = [
  { code: 'LF', displayName: 'Left Field', group: 'OUTFIELD', diagramX: 18, diagramY: 16 },
  { code: 'CF', displayName: 'Center Field', group: 'OUTFIELD', diagramX: 50, diagramY: 10 },
  { code: 'RF', displayName: 'Right Field', group: 'OUTFIELD', diagramX: 82, diagramY: 16 },
];

const FOUR_OUTFIELD_LC_RC: PosSpec[] = [
  { code: 'LF', displayName: 'Left Field', group: 'OUTFIELD', diagramX: 14, diagramY: 18 },
  { code: 'LC', displayName: 'Left Center', group: 'OUTFIELD', diagramX: 38, diagramY: 10 },
  { code: 'RC', displayName: 'Right Center', group: 'OUTFIELD', diagramX: 62, diagramY: 10 },
  { code: 'RF', displayName: 'Right Field', group: 'OUTFIELD', diagramX: 86, diagramY: 18 },
];

const FOUR_OUTFIELD_LCF_RCF: PosSpec[] = [
  { code: 'LF', displayName: 'Left Field', group: 'OUTFIELD', diagramX: 14, diagramY: 18 },
  { code: 'LCF', displayName: 'Left Center Field', group: 'OUTFIELD', diagramX: 38, diagramY: 10 },
  { code: 'RCF', displayName: 'Right Center Field', group: 'OUTFIELD', diagramX: 62, diagramY: 10 },
  { code: 'RF', displayName: 'Right Field', group: 'OUTFIELD', diagramX: 86, diagramY: 18 },
];

function preset(
  id: string,
  sport: Sport,
  name: string,
  specs: PosSpec[],
): Formation {
  return {
    id,
    teamId: null,
    sport,
    name,
    isSystemPreset: true,
    positions: buildPositions(id, specs),
  };
}

export const SYSTEM_FORMATIONS: Formation[] = [
  preset('baseball-9', 'BASEBALL', 'Standard Baseball — 9 Players', [
    ...BATTERY_AND_INFIELD,
    ...THREE_OUTFIELD,
  ]),
  preset('baseball-10-lc-rc', 'BASEBALL', 'Youth Baseball — 10 Players (LF/LC/RC/RF)', [
    ...BATTERY_AND_INFIELD,
    ...FOUR_OUTFIELD_LC_RC,
  ]),
  preset('baseball-10-lcf-rcf', 'BASEBALL', 'Youth Baseball — 10 Players (LF/LCF/RCF/RF)', [
    ...BATTERY_AND_INFIELD,
    ...FOUR_OUTFIELD_LCF_RCF,
  ]),
  preset('softball-9', 'SOFTBALL', 'Standard Softball — 9 Players', [
    ...BATTERY_AND_INFIELD,
    ...THREE_OUTFIELD,
  ]),
  preset('softball-10', 'SOFTBALL', 'Youth Softball — 10 Players (Four Outfielders)', [
    ...BATTERY_AND_INFIELD,
    ...FOUR_OUTFIELD_LC_RC,
  ]),
  preset('softball-10-rover', 'SOFTBALL', 'Youth Softball — 10 Players (Rover)', [
    ...BATTERY_AND_INFIELD,
    ...THREE_OUTFIELD,
    { code: 'RV', displayName: 'Rover', group: 'OUTFIELD', diagramX: 50, diagramY: 26 },
  ]),
];

export function getSystemFormation(id: string): Formation | undefined {
  return SYSTEM_FORMATIONS.find((f) => f.id === id);
}

export function systemFormationsForSport(sport: Sport): Formation[] {
  return SYSTEM_FORMATIONS.filter((f) => f.sport === sport);
}

export const DEFAULT_FORMATION_BY_SPORT: Record<Sport, string> = {
  BASEBALL: 'baseball-10-lc-rc',
  SOFTBALL: 'softball-10',
};

/** Deep copy, used when snapshotting a formation onto a game. */
export function cloneFormation(formation: Formation): Formation {
  return {
    ...formation,
    positions: formation.positions.map((p) => ({ ...p })),
  };
}

/**
 * Creates a team-owned editable copy of a formation. Position ids are
 * regenerated so the custom formation's history is distinct from the preset's,
 * but the code/group mapping keeps group-level season stats comparable.
 */
export function deriveCustomFormation(
  source: Formation,
  teamId: string,
  name: string,
  newId: string,
): Formation {
  return {
    id: newId,
    teamId,
    sport: source.sport,
    name,
    isSystemPreset: false,
    positions: source.positions.map((p, index) => ({
      ...p,
      id: `${newId}:${p.code}`,
      sortOrder: index,
    })),
  };
}

export function positionsByGroup(formation: Formation, group: PositionGroup): PositionDefinition[] {
  return formation.positions.filter((p) => p.group === group);
}

export function findPosition(formation: Formation, positionId: string): PositionDefinition | undefined {
  return formation.positions.find((p) => p.id === positionId);
}

export function findPositionByCode(formation: Formation, code: string): PositionDefinition | undefined {
  return formation.positions.find((p) => p.code === code);
}

export const GROUP_LABEL: Record<PositionGroup, string> = {
  BATTERY: 'Battery',
  INFIELD: 'Infield',
  OUTFIELD: 'Outfield',
  BENCH: 'Bench',
};

export const GROUP_ORDER: PositionGroup[] = ['BATTERY', 'INFIELD', 'OUTFIELD', 'BENCH'];
