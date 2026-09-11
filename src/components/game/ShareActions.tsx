'use client';

import { Button, Modal, SegmentedControl } from '@/components/ui';
import type { Game, Player, Team } from '@/domain/types';
import { buildSharePayload, encodeShare, lineupAsText } from '@/lib/shareLink';
import { useState } from 'react';

/** A link for the schedule app, plain text for the group chat. */
type ShareFormat = 'link' | 'text';

/**
 * Share a lineup with the people who need to read it.
 *
 * Coaches distribute lineups two ways — a link for parents and assistants, and
 * plain text pasted into the team chat — so both live behind one button rather
 * than competing for space in the header. Everything is built in the browser,
 * so neither needs a server or an account.
 */
export function ShareActions({
  team,
  game,
  players,
}: {
  team: Team;
  game: Game;
  players: Player[];
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ShareFormat>('link');
  const [value, setValue] = useState('');
  const [copied, setCopied] = useState(false);

  /*
    Clipboard writes fail on insecure origins and in some in-app browsers, so
    every path also shows the text: a coach on the field can select it by hand
    rather than pressing a button that silently did nothing.
  */
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const build = async (next: ShareFormat) => {
    const payload = buildSharePayload(team, game, players);
    const text =
      next === 'text'
        ? lineupAsText(payload)
        : `${window.location.origin}/s/${await encodeShare(payload)}`;
    setValue(text);
    await copy(text);
  };

  const show = async () => {
    setFormat('link');
    setValue('');
    setOpen(true);
    await build('link');
  };

  const switchTo = async (next: ShareFormat) => {
    setFormat(next);
    setCopied(false);
    setValue('');
    await build(next);
  };

  return (
    <>
      <Button size="sm" onClick={show}>
        Share
      </Button>

      {open ? (
        <Modal
          open
          title="Share this lineup"
          onClose={() => {
            setOpen(false);
            setCopied(false);
          }}
          footer={
            <div className="flex justify-end gap-2">
              <Button size="sm" disabled={!value} onClick={() => void copy(value)}>
                Copy again
              </Button>
              {format === 'link' && value ? (
                <a href={value} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="primary">
                    Preview
                  </Button>
                </a>
              ) : null}
            </div>
          }
        >
          <div className="space-y-3">
            <SegmentedControl<ShareFormat>
              size="sm"
              label="Share as"
              value={format}
              onChange={(next) => void switchTo(next)}
              options={[
                { value: 'link', label: 'Link' },
                { value: 'text', label: 'Text' },
              ]}
            />

            <p className="text-sm text-ink-muted">
              {!value
                ? 'Building…'
                : copied
                  ? 'Copied to your clipboard.'
                  : 'Select the text below to copy it.'}
            </p>

            {!value ? (
              <div className="h-9 animate-pulse rounded-lg bg-surface-muted" />
            ) : format === 'link' ? (
              <input
                readOnly
                value={value}
                aria-label="Share link"
                onFocus={(event) => event.currentTarget.select()}
                className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 font-mono text-xs text-ink"
              />
            ) : (
              <textarea
                readOnly
                value={value}
                aria-label="Lineup text"
                rows={Math.min(18, value.split('\n').length + 1)}
                onFocus={(event) => event.currentTarget.select()}
                className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 font-mono text-xs leading-relaxed text-ink"
              />
            )}

            <p className="text-xs text-ink-subtle">
              {format === 'link'
                ? 'The lineup travels inside the link, so it opens without an account and needs nothing from us to keep working. Anyone holding the link can read it, so send it to your team rather than somewhere public. It carries names, positions and the batting order — never ability ratings, position limits or notes.'
                : 'Paste this straight into your team group chat.'}
            </p>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
