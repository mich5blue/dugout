'use client';

import { cn } from '@/lib/cn';

/**
 * A framed picture of a piece of the product.
 *
 * What is inside the frame is the real component, rendered read-only against
 * the guide's fixture — not a screenshot. Pasted images would have been
 * quicker and are the usual way to do this, but a help page whose pictures
 * lag the UI teaches the wrong product, and these cannot: they are the UI. As
 * a bonus they follow the reader into light mode and stay sharp at any zoom.
 *
 * The frame exists so the reader can tell "this is a picture of the app" from
 * "this is the app" — without it, a live LineupGrid sitting in prose looks
 * like something they are supposed to edit.
 */
export function GuideShot({
  label,
  caption,
  children,
  className,
}: {
  /** What this is a picture of, e.g. "Games → By inning". */
  label: string;
  /** What to notice in it. */
  caption?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <figure className={cn('my-5', className)}>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border bg-surface-raised px-3 py-2">
          {/* Three dots: the universal "this is a window" cue, in one colour
              so it never competes with the palette inside the frame. */}
          <span aria-hidden className="flex gap-1">
            <span className="size-2 rounded-full bg-border-strong" />
            <span className="size-2 rounded-full bg-border-strong" />
            <span className="size-2 rounded-full bg-border-strong" />
          </span>
          <span className="eyebrow truncate text-ink-subtle">{label}</span>
        </div>
        {/*
          Only the pressable things ignore pointers — not every element.

          Two earlier attempts broke the pictures on a phone. `pointer-events-
          none` on this container, and then on all its descendants, both stop
          the swipe that a grid wider than 375px needs to be read at all: these
          components bring their own horizontal scroller, and a scroller that
          ignores touches is a picture cropped with no way to see the rest.

          So: buttons, links and fields go inert, and every plain element —
          including those scrollers — keeps its pointer events.
        */}
        <div className="overflow-x-auto p-3 [&_a]:pointer-events-none [&_button]:pointer-events-none [&_input]:pointer-events-none [&_select]:pointer-events-none [&_textarea]:pointer-events-none">
          {children}
        </div>
      </div>
      {caption ? (
        <figcaption className="mt-2 text-xs text-ink-subtle">{caption}</figcaption>
      ) : null}
    </figure>
  );
}
