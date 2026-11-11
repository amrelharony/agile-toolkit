/**
 * The chat strip's comic parts (DNA-SPEC §6 "Chat strip"): the markup every
 * Amr surface shares, from the owner's chat to the visitor's tool finder.
 *
 *   AmrBalloon       only the model's own words, in a speech balloon whose
 *                    tail points at the real Amr beside the panel
 *   ThinkingBalloon  the same balloon with a pen scribble and no words, while
 *                    a reply is on its way (the status line says it in words)
 *   YouCaption       the reader's own words, in a squared caption box
 *   Narration        every line that isn't Amr's own words, told in the third
 *                    person ("Amr is working in Retro Board..."): status,
 *                    tool steps, notes, errors, limits, empty and resume lines
 *   SceneCaption     a change of time or place: a quiet centred rule
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
 *
 * A balloon's tail stands 0.8rem out from its edge: the call site leaves that
 * room on Amr's side (a scroller would clip it).
 */

import type { HTMLAttributes, ReactNode } from "react";
import { InkScribble } from "@/components/ink/ink-scribble";
import { cn } from "@/lib/utils";

type DivProps = Omit<HTMLAttributes<HTMLDivElement>, "children" | "dir">;

/** An optional slot was given something to draw. */
const given = (node: ReactNode) => node != null && node !== false && node !== "";

/**
 * The words a part's body shares: Inter (named, so a lettered parent such as a
 * card title can't pass Shantell down), small, roomy, long words wrap.
 */
const BODY = "font-sans text-sm leading-relaxed break-words";

export interface AmrBalloonProps extends DivProps {
  /** The reply: markdown or plain text, laid out by the caller. */
  children: ReactNode;
  /**
   * A lettered opening drawn first, in Shantell: the reply's first sentence,
   * cut by the caller by character position so streamed text never changes
   * face. Leave it out when the reply has no short Latin-script opener.
   */
  lead?: ReactNode;
}

/** Amr's own words, in a balloon whose tail points at him. */
export function AmrBalloon({ children, lead, className, ...rest }: AmrBalloonProps) {
  return (
    <div
      {...rest}
      className={cn("balloon min-w-0 px-3 py-2", BODY, className)}
      data-tail="amr"
      data-speaker="amr"
    >
      <span className="sr-only">Amr said: </span>
      <div dir="auto" data-comic-content="">
        {given(lead) && (
          <span className="font-display text-[0.9375rem]" data-balloon-lead="">
            {lead}
          </span>
        )}
        {children}
      </div>
    </div>
  );
}

/**
 * Amr is about to answer: his balloon with a pen scribbling in it and no
 * words. Hidden from assistive tech, because the always-mounted status line
 * says it in words; the scribble is drawn still under reduced motion.
 */
export function ThinkingBalloon({ className, ...rest }: DivProps) {
  return (
    <div
      {...rest}
      className={cn("balloon flex w-fit items-center px-3 py-2.5", className)}
      data-tail="amr"
      data-speaker="amr"
      data-thinking=""
      aria-hidden="true"
    >
      <InkScribble className="h-4 w-12" />
    </div>
  );
}

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
        {given(label) && (
          <span className="me-1.5 font-medium" data-caption-label="">
            {label}
          </span>
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

export interface SceneCaptionProps extends Omit<HTMLAttributes<HTMLParagraphElement>, "children"> {
  /** The change: "Earlier today", "Picked up where you left off". */
  children: ReactNode;
}

/** A change of time or place in the strip: no paper, a quiet rule, centred. */
export function SceneCaption({ children, className, ...rest }: SceneCaptionProps) {
  return (
    <p
      {...rest}
      className={cn(
        "comic-caption mx-auto w-fit max-w-full px-3 py-1 font-sans text-xs leading-relaxed",
        className
      )}
      data-voice="scene"
    >
      {children}
    </p>
  );
}
