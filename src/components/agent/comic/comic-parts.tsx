/**
 * The chat strip's comic parts (DNA-SPEC §6 "Chat strip"): the markup every
 * Amr surface shares, from the owner's chat to the visitor's tool finder.
 *
 *   YouCaption       the reader's own words, in a squared caption box
 *   Narration        every line that isn't Amr's own words, told in the third
 *                    person ("Amr is working in Retro Board..."): status,
 *                    tool steps, notes, errors, limits, empty and resume lines
 *
 * The parts only the chat strip draws (AmrBalloon, ThinkingBalloon and
 * SceneCaption) live in strip-parts.tsx. Every-page code imports this file,
 * and webpack keeps every export some chunk uses inside the module that holds
 * it, so a part kept here ships on every page as soon as the chat uses it.
 * Keep a part here only when every-page code draws it.
 *
 * Runtime-free on purpose: no hooks, no stores, no agent code, and imports from
 * react, @/lib/utils and the ink art only (test/agent/bundle-boundary.test.ts
 * walks this folder), so a part can ship on every page and render on a server.
 * The look is globals.css (`.balloon[data-tail]`, `.comic-caption`); these only
 * add spacing, the speaker for screen readers and the reading direction.
 *
 * Speaker prefixes ("Amr said:", "You said:") are visually hidden and sit
 * outside the `dir="auto"` element, so an English prefix never decides the
 * direction of an Arabic message. Everything is Inter at text-sm; only a
 * balloon's lead is lettered (`font-display`), and data stays in `font-data`.
 */

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A part's own div props: it sets the children and the reading direction. */
export type DivProps = Omit<HTMLAttributes<HTMLDivElement>, "children" | "dir">;

/** An optional slot was given something to draw. */
export const given = (node: ReactNode) => node != null && node !== false && node !== "";

/**
 * The words a part's body shares: Inter (named, so a lettered parent such as a
 * card title can't pass Shantell down), small, roomy, long words wrap.
 */
export const BODY = "font-sans text-sm leading-relaxed break-words";

export interface YouCaptionProps extends DivProps {
  /** The reader's words, shown as typed (line breaks kept). */
  children: ReactNode;
}

/** The reader's own words, in a squared caption box. */
export function YouCaption({ children, className, ...rest }: YouCaptionProps) {
  return (
    <div
      {...rest}
      className={cn("comic-caption min-w-0 px-3 py-2", BODY, className)}
      data-voice="you"
      data-speaker="you"
    >
      <span className="sr-only">You said: </span>
      <div dir="auto" className="whitespace-pre-wrap" data-comic-content="">
        {children}
      </div>
    </div>
  );
}

export type NarrationTone = "note" | "error";

export interface NarrationProps extends DivProps {
  /** The line, in the third person. An error says in words what went wrong. */
  children: ReactNode;
  /** `error` draws the danger line; the words still carry the meaning. */
  tone?: NarrationTone;
  /** A short name for the line, drawn first in medium weight (a tool, "Note"). */
  label?: ReactNode;
  /** Buttons for the line (Try again, Go on, Open), after the words. */
  actions?: ReactNode;
}

/**
 * A narration caption: the narrator's box for every line that isn't Amr's
 * own words. Not a live region; the chat's status line and announcer speak.
 */
export function Narration({
  children,
  tone = "note",
  label,
  actions,
  className,
  ...rest
}: NarrationProps) {
  return (
    <div
      {...rest}
      className={cn(
        "comic-caption flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2",
        BODY,
        className
      )}
      data-voice="narration"
      data-tone={tone}
    >
      <div className="min-w-0 flex-1 basis-40" data-comic-content="">
        {/* A real space, not a margin, so the label never runs into the words. */}
        {given(label) && (
          <>
            <span className="font-medium" data-caption-label="">
              {label}
            </span>{" "}
          </>
        )}
        {children}
      </div>
      {given(actions) && (
        <div className="flex flex-wrap items-center gap-2" data-caption-actions="">
          {actions}
        </div>
      )}
    </div>
  );
}
