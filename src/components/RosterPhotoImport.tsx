'use client';

import { Badge, Button, Input, Modal, Notice, Spinner } from '@/components/ui';
import { toLastInitial } from '@/domain/factories';
import { cn } from '@/lib/cn';
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  type NormalizedImport,
  type RosterImportResponse,
} from '@/lib/rosterImport';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Import a roster from a screenshot or photo.
 *
 * Reading handwriting is never certain, so the extracted names are always shown
 * in an editable review step and nothing is saved until the coach confirms.
 * Rows the model flagged as unsure are called out so the coach knows where to
 * look rather than having to re-check all of them.
 */

export interface ReviewedPlayer {
  key: string;
  firstName: string;
  lastInitial?: string;
  jerseyNumber: string;
  confident: boolean;
  include: boolean;
}

type Stage = 'choose' | 'reading' | 'review';

export function RosterPhotoImport({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (
    players: Array<{ firstName: string; lastInitial?: string; jerseyNumber?: string }>,
  ) => void;
}) {
  const [stage, setStage] = useState<Stage>('choose');
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [meta, setMeta] = useState<Pick<NormalizedImport, 'source' | 'warning' | 'duplicatesRemoved'> | null>(null);
  const [rows, setRows] = useState<ReviewedPlayer[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setStage('choose');
    setError(null);
    setUnavailable(false);
    setMeta(null);
    setRows([]);
    setDragging(false);
  }, []);

  const submitImage = useCallback(async (file: File) => {
    setError(null);

    if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setError('Use a PNG, JPEG, WebP or GIF image.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('That image is larger than 5 MB. A screenshot or smaller photo will work.');
      return;
    }

    setStage('reading');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('That file could not be read.'));
        reader.readAsDataURL(file);
      });

      const response = await fetch('/api/roster-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      const payload = (await response.json()) as RosterImportResponse;

      if (!payload.ok || !payload.result) {
        setUnavailable(Boolean(payload.unavailable));
        setError(payload.error ?? 'Reading that image failed.');
        setStage('choose');
        return;
      }

      setMeta({
        source: payload.result.source,
        warning: payload.result.warning,
        duplicatesRemoved: payload.result.duplicatesRemoved,
      });
      setRows(
        payload.result.players.map((player, index) => ({
          key: `${index}-${player.firstName}-${player.lastName}`,
          firstName: player.firstName,
          /* A photographed card carries a surname; only its initial is kept. */
          lastInitial: toLastInitial(player.lastName),
          jerseyNumber: player.jerseyNumber ?? '',
          confident: player.confident,
          include: true,
        })),
      );
      setStage('review');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reading that image failed.');
      setStage('choose');
    }
  }, []);

  // Let the coach paste a screenshot straight from the clipboard.
  useEffect(() => {
    if (!open || stage !== 'choose') return;
    const onPaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? [])[0];
      if (file) void submitImage(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open, stage, submitImage]);

  if (!open) return null;

  const included = rows.filter((row) => row.include);
  const unsure = included.filter((row) => !row.confident).length;

  const update = (key: string, changes: Partial<ReviewedPlayer>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...changes } : row)),
    );

  return (
    <Modal
      open
      onClose={() => {
        reset();
        onClose();
      }}
      title={stage === 'review' ? 'Check what we read' : 'Import roster from a photo'}
      footer={
        stage === 'review' ? (
          <>
            <Button onClick={reset}>Try another image</Button>
            <Button
              variant="primary"
              disabled={included.length === 0}
              onClick={() => {
                onConfirm(
                  included.map((row) => ({
                    firstName: row.firstName.trim(),
                    lastInitial: toLastInitial(row.lastInitial),
                    jerseyNumber: row.jerseyNumber.trim() || undefined,
                  })),
                );
                reset();
              }}
            >
              Add {included.length} {included.length === 1 ? 'player' : 'players'}
            </Button>
          </>
        ) : (
          <Button
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
        )
      }
    >
      {stage === 'choose' ? (
        <div className="space-y-4">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = Array.from(event.dataTransfer.files)[0];
              if (file) void submitImage(file);
            }}
            className={cn(
              'rounded-xl border-2 border-dashed px-5 py-10 text-center transition-colors',
              dragging ? 'border-brand bg-brand-soft' : 'border-border-strong',
            )}
          >
            <p className="text-sm font-medium text-ink">
              Drop a screenshot or photo here
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              or paste from your clipboard
            </p>
            <Button
              variant="primary"
              className="mt-4"
              onClick={() => inputRef.current?.click()}
            >
              Choose a file
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(',')}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void submitImage(file);
                event.target.value = '';
              }}
            />
          </div>

          <div className="text-sm text-ink-muted">
            <p className="font-medium text-ink">What works</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>A screenshot of a lineup from your scorekeeping app</li>
              <li>A photo of a typed or printed team list</li>
              <li>A photo of a handwritten lineup card</li>
            </ul>
          </div>

          {error ? (
            <Notice tone={unavailable ? 'caution' : 'critical'} title={unavailable ? 'Not set up yet' : 'Could not read that'}>
              {error}
            </Notice>
          ) : null}

          <Notice tone="neutral">
            Your photo is sent to the Claude API to be read, and is not stored by
            Dugout. Names come back to this device for you to check before anything
            is saved. If you would rather nothing left your device, paste or type
            the names instead.
          </Notice>
        </div>
      ) : null}

      {stage === 'reading' ? (
        <div className="flex items-center gap-3 py-10">
          <Spinner />
          <p className="text-sm text-ink-muted">Reading the roster…</p>
        </div>
      ) : null}

      {stage === 'review' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-ink-muted">
              Read {rows.length} {rows.length === 1 ? 'player' : 'players'} from your{' '}
              {meta?.source}.
            </p>
            {unsure > 0 ? (
              <Badge tone="caution">{unsure} to double-check</Badge>
            ) : (
              <Badge tone="positive">All read clearly</Badge>
            )}
          </div>

          {meta?.warning ? <Notice tone="caution">{meta.warning}</Notice> : null}
          {meta && meta.duplicatesRemoved.length > 0 ? (
            <Notice tone="neutral">
              Skipped a repeated entry for {meta.duplicatesRemoved.join(', ')}.
            </Notice>
          ) : null}

          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.key}
                className={cn(
                  'rounded-xl border px-3 py-2.5',
                  row.include ? 'border-border' : 'border-border bg-surface-muted opacity-60',
                  row.include && !row.confident && 'border-caution/50 bg-caution-soft/40',
                )}
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={row.include}
                    aria-label={`Include ${row.firstName} ${row.lastInitial ?? ''}`.trim()}
                    onClick={() => update(row.key, { include: !row.include })}
                    className={cn(
                      'ring-focus flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold',
                      row.include
                        ? 'border-brand bg-brand text-ink-inverse'
                        : 'border-border-strong text-transparent',
                    )}
                  >
                    ✓
                  </button>

                  <Input
                    aria-label="First name"
                    className="h-9 flex-1"
                    value={row.firstName}
                    onChange={(event) => update(row.key, { firstName: event.target.value })}
                  />
                  <Input
                    aria-label="Last name"
                    className="h-9 flex-1"
                    value={row.lastInitial ?? ''}
                    maxLength={1}
                    onChange={(event) =>
                      update(row.key, { lastInitial: toLastInitial(event.target.value) })
                    }
                  />
                  <Input
                    aria-label="Jersey number"
                    className="h-9 w-16"
                    inputMode="numeric"
                    placeholder="#"
                    value={row.jerseyNumber}
                    onChange={(event) => update(row.key, { jerseyNumber: event.target.value })}
                  />
                </div>

                {row.include && !row.confident ? (
                  <p className="mt-1.5 pl-7 text-xs text-caution">
                    Hard to read — worth checking the spelling.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>

          <p className="text-sm text-ink-subtle">
            Everyone starts able to play any position. You can set who pitches and
            catches next.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
