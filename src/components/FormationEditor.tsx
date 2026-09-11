'use client';

import { Button, Input, Label, Notice, Select } from '@/components/ui';
import { CRITICAL_WEIGHT, GROUP_LABEL } from '@/domain/formations';
import type { Formation, PositionDefinition, PositionGroup } from '@/domain/types';
import { useState } from 'react';

/**
 * Custom formation editor (spec section 6). Positions can be added, renamed,
 * reordered, regrouped and marked critical. Position ids are never changed once
 * created, so season history stays attached to the right position.
 */

const GROUPS: PositionGroup[] = ['BATTERY', 'INFIELD', 'OUTFIELD'];

const CRITICAL_OPTIONS = [
  { value: String(CRITICAL_WEIGHT.LOW), label: 'Low' },
  { value: String(CRITICAL_WEIGHT.NORMAL), label: 'Normal' },
  { value: String(CRITICAL_WEIGHT.HIGH), label: 'High' },
];

export function FormationEditor({
  formation,
  onSave,
  onCancel,
}: {
  formation: Formation;
  onSave: (formation: Formation) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Formation>({
    ...formation,
    positions: formation.positions.map((position) => ({ ...position })),
  });

  const setPositions = (positions: PositionDefinition[]) =>
    setDraft({
      ...draft,
      positions: positions.map((position, index) => ({ ...position, sortOrder: index })),
    });

  const updatePosition = (id: string, changes: Partial<PositionDefinition>) =>
    setPositions(
      draft.positions.map((position) =>
        position.id === id ? { ...position, ...changes } : position,
      ),
    );

  const move = (id: string, direction: -1 | 1) => {
    const index = draft.positions.findIndex((position) => position.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= draft.positions.length) return;
    const next = [...draft.positions];
    next[index] = draft.positions[target];
    next[target] = draft.positions[index];
    setPositions(next);
  };

  const addPosition = () => {
    const suffix = draft.positions.length + 1;
    setPositions([
      ...draft.positions,
      {
        id: `${draft.id}:custom-${suffix}-${Math.random().toString(36).slice(2, 6)}`,
        code: `P${suffix}`,
        displayName: `Position ${suffix}`,
        group: 'OUTFIELD',
        sortOrder: draft.positions.length,
        criticalWeight: CRITICAL_WEIGHT.NORMAL,
      },
    ]);
  };

  const duplicateCodes = draft.positions
    .map((position) => position.code.trim().toUpperCase())
    .filter((code, index, all) => code !== '' && all.indexOf(code) !== index);

  const hasPitcher = draft.positions.some((position) => position.role === 'PITCHER');
  const hasCatcher = draft.positions.some((position) => position.role === 'CATCHER');
  const valid =
    draft.name.trim().length > 0 &&
    draft.positions.length > 0 &&
    duplicateCodes.length === 0 &&
    draft.positions.every((position) => position.code.trim().length > 0);

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="formation-name">Formation name</Label>
        <Input
          id="formation-name"
          className="mt-1.5"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              {['Code', 'Name', 'Group', 'Critical', 'Role', ''].map((header) => (
                <th
                  key={header}
                  className="px-2 py-2 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {draft.positions.map((position, index) => (
              <tr key={position.id} className="border-b border-border">
                <td className="px-2 py-1.5">
                  <Input
                    className="h-9 w-20"
                    value={position.code}
                    onChange={(event) =>
                      updatePosition(position.id, {
                        code: event.target.value.toUpperCase().slice(0, 4),
                      })
                    }
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    className="h-9 min-w-36"
                    value={position.displayName}
                    onChange={(event) =>
                      updatePosition(position.id, { displayName: event.target.value })
                    }
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Select
                    className="h-9 w-28"
                    value={position.group}
                    onChange={(event) =>
                      updatePosition(position.id, {
                        group: event.target.value as PositionGroup,
                      })
                    }
                  >
                    {GROUPS.map((group) => (
                      <option key={group} value={group}>
                        {GROUP_LABEL[group]}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-2 py-1.5">
                  <Select
                    className="h-9 w-24"
                    value={String(position.criticalWeight)}
                    onChange={(event) =>
                      updatePosition(position.id, {
                        criticalWeight: Number(event.target.value),
                      })
                    }
                  >
                    {CRITICAL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-2 py-1.5">
                  <Select
                    className="h-9 w-28"
                    value={position.role ?? ''}
                    onChange={(event) =>
                      updatePosition(position.id, {
                        role:
                          event.target.value === ''
                            ? undefined
                            : (event.target.value as 'PITCHER' | 'CATCHER'),
                      })
                    }
                  >
                    <option value="">None</option>
                    <option value="PITCHER">Pitcher</option>
                    <option value="CATCHER">Catcher</option>
                  </Select>
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      aria-label="Move up"
                      disabled={index === 0}
                      onClick={() => move(position.id, -1)}
                      className="ring-focus size-8 rounded-md border border-border text-xs text-ink-muted disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      disabled={index === draft.positions.length - 1}
                      onClick={() => move(position.id, 1)}
                      className="ring-focus size-8 rounded-md border border-border text-xs text-ink-muted disabled:opacity-40"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label="Remove position"
                      onClick={() =>
                        setPositions(
                          draft.positions.filter((entry) => entry.id !== position.id),
                        )
                      }
                      className="ring-focus size-8 rounded-md border border-border text-xs text-critical"
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Button size="sm" onClick={addPosition}>
        Add position
      </Button>

      {duplicateCodes.length > 0 ? (
        <Notice tone="critical" title="Duplicate position codes">
          {duplicateCodes.join(', ')} appear more than once. Each position needs its own
          code so your season history stays readable.
        </Notice>
      ) : null}

      {!hasPitcher || !hasCatcher ? (
        <Notice tone="caution" title="No pitcher or catcher role set">
          Mark which position is the pitcher and which is the catcher so pitching and
          catching limits apply. Some formations legitimately have neither — for coach-pitch,
          leaving both unset is correct.
        </Notice>
      ) : null}

      <p className="text-sm text-ink-muted">
        {draft.positions.length} defensive{' '}
        {draft.positions.length === 1 ? 'position' : 'positions'} — Dugout will field
        exactly this many players each inning.
      </p>

      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={!valid} onClick={() => onSave(draft)}>
          Save formation
        </Button>
      </div>
    </div>
  );
}
