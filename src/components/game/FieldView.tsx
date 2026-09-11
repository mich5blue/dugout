'use client';

import { GROUP_STYLE } from '@/components/ui';
import { playerShortName } from '@/domain/factories';
import type { Player, PositionDefinition } from '@/domain/types';
import { cn } from '@/lib/cn';
import { canPlay } from '@/lib/eligibility';
import type { GameView } from '@/lib/gameView';
import { useState } from 'react';

/**
 * Field view — the "field first" direction.
 *
 * The diamond is the interface here, not an illustration of one: the field is
 * the primary surface, the inning scrubber belongs to it, and assignments are
 * made directly on it.
 *
 * Positions are placed from the coordinates the formation provides, so a
 * four-outfielder or custom formation renders correctly without any
 * position-specific code in this file.
 *
 * Editing works two ways on purpose. Tapping a card opens the swap picker,
 * which is the only thing that works on a phone — where a coach actually uses
 * this. Dragging one card onto another is a desktop accelerator for the same
 * action. Both route through the same assignment call, and both refuse illegal
 * drops using the shared eligibility rules.
 */

type DragSource =
  | { kind: 'position'; positionId: string; playerId: string }
  | { kind: 'bench'; playerId: string };

export function FieldView({
  view,
  inning,
  onInningChange,
  onSelectPosition,
  onAssign,
  onBench,
  readOnly = false,
}: {
  view: GameView;
  inning: number;
  onInningChange: (inning: number) => void;
  onSelectPosition?: (position: PositionDefinition) => void;
  /** Put `playerId` at `positionId`, swapping or benching as needed. */
  onAssign?: (positionId: string, playerId: string) => void;
  onBench?: (positionId: string) => void;
  readOnly?: boolean;
}) {
  const [drag, setDrag] = useState<DragSource | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const editable = !readOnly && Boolean(onAssign);
  const bench = view.benchAt(inning);

  const positioned = view.positions.filter(
    (position) => position.diagramX !== undefined && position.diagramY !== undefined,
  );
  const unpositioned = view.positions.filter(
    (position) => position.diagramX === undefined || position.diagramY === undefined,
  );

  const draggedPlayer: Player | undefined = drag
    ? view.playerById.get(drag.playerId)
    : undefined;

  /** Can what is being dragged legally land on this position? */
  const isValidTarget = (position: PositionDefinition): boolean => {
    if (!drag || !draggedPlayer) return false;
    if (drag.kind === 'position' && drag.positionId === position.id) return false;
    return canPlay(view.game, draggedPlayer, position);
  };

  const handleDrop = (position: PositionDefinition) => {
    if (!drag || !onAssign) return;
    if (isValidTarget(position)) onAssign(position.id, drag.playerId);
    setDrag(null);
    setHover(null);
  };

  const dropStateFor = (position: PositionDefinition): DropState => {
    if (!drag) return 'idle';
    if (!isValidTarget(position)) return 'invalid';
    return hover === position.id ? 'over' : 'valid';
  };

  return (
    <div className="space-y-3">
      {/*
        Inning scrubber. Big condensed figures rather than a row of "Inn 3"
        chips: this is the control a coach hits mid-game with cold hands, so
        the targets are deliberately oversized.
      */}
      <div
        role="radiogroup"
        aria-label="Inning"
        className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-bg/60 p-1"
      >
        {view.innings.map((value) => {
          const active = value === inning;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onInningChange(value)}
              className={cn(
                'ring-focus flex min-w-14 flex-1 flex-col items-center rounded-lg px-3 py-1.5 transition-colors',
                active
                  ? 'bg-brand text-ink-inverse'
                  : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
              )}
            >
              <span className="eyebrow opacity-70">Inn</span>
              <span className="scoreboard text-2xl">{value}</span>
            </button>
          );
        })}
      </div>

      {/* Taller than 4:3 on a phone: the infield positions are only ~14% apart
          vertically, which collides once the field gets narrow. */}
      <div className="relative mx-auto aspect-square w-full max-w-3xl overflow-hidden rounded-xl border border-border sm:aspect-4/3">
        <FieldBackdrop />

        {positioned.map((position) => (
          <div
            key={position.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${position.diagramX}%`, top: `${position.diagramY}%` }}
          >
            <PositionCard
              view={view}
              inning={inning}
              position={position}
              editable={editable}
              dragging={drag?.kind === 'position' && drag.positionId === position.id}
              dropState={dropStateFor(position)}
              onSelect={() => onSelectPosition?.(position)}
              onDragStart={(playerId) =>
                setDrag({ kind: 'position', positionId: position.id, playerId })
              }
              onDragEnd={() => {
                setDrag(null);
                setHover(null);
              }}
              onDragEnter={() => setHover(position.id)}
              onDrop={() => handleDrop(position)}
            />
          </div>
        ))}
      </div>

      {unpositioned.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-2">
          {unpositioned.map((position) => (
            <PositionCard
              key={position.id}
              view={view}
              inning={inning}
              position={position}
              editable={editable}
              dragging={drag?.kind === 'position' && drag.positionId === position.id}
              dropState={dropStateFor(position)}
              onSelect={() => onSelectPosition?.(position)}
              onDragStart={(playerId) =>
                setDrag({ kind: 'position', positionId: position.id, playerId })
              }
              onDragEnd={() => {
                setDrag(null);
                setHover(null);
              }}
              onDragEnter={() => setHover(position.id)}
              onDrop={() => handleDrop(position)}
            />
          ))}
        </div>
      ) : null}

      {/* Bench: a drop target for taking someone off the field, and a source
          for putting someone on it. */}
      <div
        onDragOver={(event) => {
          if (drag?.kind === 'position' && onBench) event.preventDefault();
        }}
        onDrop={() => {
          if (drag?.kind === 'position' && onBench) onBench(drag.positionId);
          setDrag(null);
          setHover(null);
        }}
        className={cn(
          'rounded-xl border px-3 py-2.5 transition-colors',
          drag?.kind === 'position' && onBench
            ? 'border-accent border-dashed bg-accent-soft'
            : 'border-border bg-bench-soft',
        )}
      >
        <p className="eyebrow text-bench">
          Bench
          {drag?.kind === 'position' && onBench ? (
            <span className="ml-2 font-normal text-accent normal-case">
              drop here to sit
            </span>
          ) : null}
        </p>

        {bench.length === 0 ? (
          <p className="mt-1 text-sm text-ink-muted">Nobody sits this inning</p>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {bench.map((player) => (
              <button
                key={player.id}
                type="button"
                draggable={editable}
                onDragStart={() => setDrag({ kind: 'bench', playerId: player.id })}
                onDragEnd={() => {
                  setDrag(null);
                  setHover(null);
                }}
                disabled={!editable}
                className={cn(
                  'ring-focus rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm font-medium text-ink',
                  editable && 'cursor-grab active:cursor-grabbing hover:border-accent',
                  drag?.kind === 'bench' && drag.playerId === player.id && 'opacity-40',
                )}
              >
                {playerShortName(player)}
                {player.jerseyNumber ? (
                  <span className="ml-1 text-xs text-ink-subtle">
                    #{player.jerseyNumber}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>

      {editable ? (
        <p className="text-center text-xs text-ink-subtle">
          Tap a player to swap them, or drag one card onto another.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The field itself: flat, saturated geometry.
 *
 * Drawn in a 100x100 box with preserveAspectRatio="none" so a y value here is
 * the same percentage the position cards are placed at. The container is wider
 * than it is tall, which compresses the vertical axis — the base diamond reads
 * as a wide rhombus, exactly as a real field does from behind home plate.
 */
function FieldBackdrop() {
  const FAIR_TERRITORY = 'M 50 84 L 2 30 A 58 58 0 0 1 98 30 Z';

  return (
    <svg
      viewBox="0 0 100 100"
      className="absolute inset-0 size-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        {/* Keeps the infield skin inside the foul lines. */}
        <clipPath id="dugout-fair-territory">
          <path d={FAIR_TERRITORY} />
        </clipPath>
      </defs>

      {/* Foul ground, so the corners of the frame are not dead space. */}
      <rect x="0" y="0" width="100" height="100" fill="var(--field-grass)" opacity="0.45" />

      {/* Grass, from home plate out to the fence. */}
      <path d={FAIR_TERRITORY} fill="var(--field-grass)" />

      {/*
        Mown stripes: alternating wedges fanning from home plate, the one piece
        of texture the field gets and the cue that reads most immediately as a
        real ballpark.

        The fan is divided evenly across the 83° between the two foul lines and
        every wedge overshoots the fence, letting the fair-territory clip cut
        the outer edge. Hand-placed wedges read as stray gray triangles instead
        of mowing, because uneven spacing has no physical explanation.
      */}
      <g clipPath="url(#dugout-fair-territory)" opacity="0.07">
        <path d="M 50 84 L -29.7 -5.7 L -5.8 -22.3 Z" fill="var(--field-line)" />
        <path d="M 50 84 L 21.3 -32.5 L 50 -36 Z" fill="var(--field-line)" />
        <path d="M 50 84 L 78.7 -32.5 L 105.8 -22.3 Z" fill="var(--field-line)" />
      </g>

      {/*
        Infield skin, built from the same diamond geometry as the base paths
        rather than an ellipse. Because the vertical axis is compressed by
        whatever aspect ratio the container has, a circle distorts differently
        than the diamond does and the skin stops lining up; a scaled diamond
        with a bowed back edge stretches identically at every size.
      */}
      <g clipPath="url(#dugout-fair-territory)">
        <path d="M 50 92 L 81 57 Q 50 0 19 57 Z" fill="var(--field-dirt)" />
      </g>

      {/* Grass inside the base paths. */}
      <path d="M 50 77 L 68 57 L 50 37 L 32 57 Z" fill="var(--field-infield)" />

      {/* Base paths. */}
      <path
        d="M 50 82 L 72 57 L 50 32 L 28 57 Z"
        fill="none"
        stroke="var(--field-line)"
        strokeWidth="0.6"
        opacity="0.8"
      />

      {/* Foul lines. */}
      <path
        d="M 50 84 L 2 30 M 50 84 L 98 30"
        stroke="var(--field-line)"
        strokeWidth="0.6"
        opacity="0.8"
        fill="none"
      />

      {/* Mound, centred where the pitcher card sits so the card never clips it
          into a stray arc. */}
      <ellipse cx="50" cy="62" rx="7" ry="6" fill="var(--field-dirt)" />

      {/* Bases and home plate. */}
      {[
        [72, 57],
        [50, 32],
        [28, 57],
      ].map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          x={x - 1.8}
          y={y - 1.8}
          width="3.6"
          height="3.6"
          fill="var(--field-line)"
        />
      ))}
      <path
        d="M 48 81 L 52 81 L 52 83.4 L 50 85.2 L 48 83.4 Z"
        fill="var(--field-line)"
      />
    </svg>
  );
}

type DropState = 'idle' | 'valid' | 'invalid' | 'over';

function PositionCard({
  view,
  inning,
  position,
  editable,
  dragging,
  dropState,
  onSelect,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDrop,
}: {
  view: GameView;
  inning: number;
  position: PositionDefinition;
  editable: boolean;
  dragging: boolean;
  dropState: DropState;
  onSelect: () => void;
  onDragStart: (playerId: string) => void;
  onDragEnd: () => void;
  onDragEnter: () => void;
  onDrop: () => void;
}) {
  const player = view.playerAt(inning, position.id);
  const assignment = view.assignmentAt(inning, position.id);
  const style = GROUP_STYLE[position.group];

  return (
    <button
      type="button"
      disabled={!editable}
      draggable={editable && Boolean(player)}
      onClick={onSelect}
      onDragStart={() => player && onDragStart(player.id)}
      onDragEnd={onDragEnd}
      onDragEnter={onDragEnter}
      onDragOver={(event) => {
        if (dropState === 'valid' || dropState === 'over') event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      title={`${position.displayName}${player ? '' : ' — unfilled'}`}
      className={cn(
        /*
          A solid card on a group-coloured top rail. On a saturated field a
          tinted fill loses against the grass, so the group colour moves to a
          hard edge and the card itself stays opaque for legibility.
        */
        'ring-focus relative w-[4.5rem] overflow-hidden rounded-lg border border-t-2 bg-surface/95 px-1 pt-1 pb-1.5 text-center shadow-sm backdrop-blur-[2px] transition-all sm:w-20',
        'border-border',
        style.ring,
        editable && 'cursor-grab active:cursor-grabbing hover:border-accent hover:shadow',
        dragging && 'opacity-40',
        dropState === 'valid' && 'border-accent/60 ring-2 ring-accent/25',
        dropState === 'over' && 'scale-110 border-accent ring-2 ring-accent',
        dropState === 'invalid' && 'opacity-30',
      )}
    >
      <span className="flex items-center justify-center gap-0.5">
        <span className={cn('scoreboard text-[11px] leading-none', style.text)}>
          {position.code}
        </span>
        {assignment?.locked ? (
          <span className="text-[8px] leading-none text-accent" aria-label="Locked">
            ●
          </span>
        ) : null}
      </span>
      <span className="mt-0.5 block truncate text-xs leading-tight font-semibold text-ink">
        {player ? playerShortName(player) : '—'}
      </span>
      {player?.jerseyNumber ? (
        <span className="tnum block text-[9px] leading-none text-ink-subtle">
          #{player.jerseyNumber}
        </span>
      ) : null}
    </button>
  );
}
