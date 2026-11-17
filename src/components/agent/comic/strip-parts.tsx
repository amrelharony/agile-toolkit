/**
 * The comic parts only the chat strip draws (DNA-SPEC §6 "Chat strip"):
 *
 *   AmrBalloon       only the model's own words, in a speech balloon whose
 *                    tail points at the real Amr beside the panel
 *   ThinkingBalloon  the same balloon with a pen scribble and no words, while
 *                    a reply is on its way (the status line says it in words)
 *   SceneCaption     a change of time or place: a quiet centred rule
 *
 * Kept out of comic-parts.tsx on purpose: every-page code imports that file,
 * and webpack keeps each export a chunk uses inside the module that holds it,
 * so these would ride on every page once the chat used them. Nothing on every
 * page may import this file (test/agent/bundle-boundary.test.ts), so it ships
 * in the chat's lazy chunks only. The same rules as comic-parts.tsx hold:
 * runtime-free, server-safe, react, @/lib/utils and the ink art only.
 *
 * A balloon's tail stands 0.8rem out from its edge: the call site leaves that
 * room on Amr's side (a scroller would clip it).
 */

import type { HTMLAttributes, ReactNode } from "react";
import { InkScribble } from "@/components/ink/ink-scribble";
import { cn } from "@/lib/utils";
import { BODY, given, type DivProps } from "./comic-parts";

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
        {/* A real space after the lead, so a reader, copy and find never run it
            into the first word; it collapses before a block such as <p>. */}
        {given(lead) && (
          <>
            <span className="font-display text-[0.9375rem]" data-balloon-lead="">
              {lead}
            </span>{" "}
          </>
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

export interface SceneCaptionProps extends Omit<HTMLAttributes<HTMLParagraphElement>, "children"> {
  /** The change: "Yesterday", "Picking up where you left off". */
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
