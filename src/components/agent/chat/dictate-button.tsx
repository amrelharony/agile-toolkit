"use client";

/**
 * The composer's mic (chat-composer `mic`): browser dictation into the
 * message box (lib/agent/mascot/use-voice-input), shown only where the
 * browser has it.
 *
 *   name     "Dictate", always, with aria-pressed saying whether it listens;
 *            its tooltip says how to stop.
 *   look     still: an accent outline while it listens, never a pulse (a
 *            pulse is all a reduced-motion reader would miss, and the
 *            comic's ink never throbs). The composer's status row says
 *            "Listening…" in words, politely, and a failure in plain words.
 *   words    added after what the box held when it started (joinDictation),
 *            never in its place, and cut to the box's limit by the composer.
 *   busy     usable while Amr answers: the box stays editable then too.
 *   ask      when given, asked before it starts listening, with the start
 *            to call once the reader says yes: a visitor's chat asks first
 *            (visitor-agent-panel's VisitorDictate and its voice notice),
 *            since browser dictation may send the audio to the browser's
 *            maker. The owner's chat hands it in as it is.
 *
 * Runtime parts, so this lives in chat/, which every-page code may not reach
 * (test/agent/bundle-boundary.test.ts).
 */

import { useEffect, useRef } from "react";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { joinDictation, useVoiceInput } from "@/lib/agent/mascot/use-voice-input";
import { cn } from "@/lib/utils";
import type { ComposerMicProps } from "./chat-composer";

/** The mic's name, the same whether or not it listens (aria-pressed says which). */
export const DICTATE_LABEL = "Dictate";
/** The status row's note while it listens. */
export const LISTENING_NOTE = "Listening…";

export interface DictateButtonProps extends ComposerMicProps {
  /**
   * Asked on a press that would start listening: call `start` once the
   * reader has said yes (`mic` is this button, for focus to come back to).
   * Without it, a press starts at once.
   */
  ask?(start: () => void, mic: HTMLButtonElement): void;
}

/** The mic: see the file comment. */
export function DictateButton({ draft, put, onNote, ask }: DictateButtonProps) {
  // The box's text when dictation started: what it hears goes after this.
  const before = useRef("");
  const voice = useVoiceInput((heard) => put(joinDictation(before.current, heard)));
  const { listening, error } = voice;

  useEffect(() => {
    onNote(listening ? LISTENING_NOTE : error);
  }, [listening, error, onNote]);

  if (!voice.supported) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={DICTATE_LABEL}
      aria-pressed={listening}
      title={listening ? "Stop dictating" : DICTATE_LABEL}
      data-chat-mic=""
      onClick={(e) => {
        if (listening) return voice.stop();
        // What the box holds as it starts, which may be after a yes.
        const start = () => {
          before.current = draft();
          voice.start();
        };
        if (ask) ask(start, e.currentTarget);
        else start();
      }}
      className={cn(listening && "border-accent text-accent")}
    >
      <Mic aria-hidden="true" />
    </Button>
  );
}
