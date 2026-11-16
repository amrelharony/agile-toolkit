"use client";

/**
 * The composer's mic (chat-composer `mic`): browser dictation into the
 * message box (lib/agent/mascot/use-voice-input), shown only where the
 * browser has it.
 *
 *   name     "Dictate", always, with aria-pressed saying whether it listens;
 *            its tooltip says how to stop.
 *   look     still: while it listens (aria-pressed), held flat with no
 *            shadow, a /20 accent tint (hover's is /10, so a pointer resting
 *            on it still shows which) and a heavier ink outline, a shape cue
 *            that High contrast and forced colours keep; never a pulse (a
 *            pulse is all a reduced-motion reader would miss, and the
 *            comic's ink never throbs). The composer's status row says
 *            "Listening…" in words, politely, and a failure in plain words.
 *   words    added after what the box held when it started (joinDictation),
 *            never in its place, and cut to the box's limit by the composer.
 *            Once the box changes under it (a send, the reader typing) it
 *            stops and drops what it hears after: the reader's box wins, and
 *            a message sent never comes back into it.
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
export function DictateButton({ draft, put, onNote, sent, ask }: DictateButtonProps) {
  // The box's text when dictation started: what it hears goes after this.
  const before = useRef("");
  // The box as dictation last left it (after the composer's cut), or null once
  // the box changed under it (a send, the reader typing): then it stops, and
  // what it hears after is dropped, so a sent message never comes back.
  const last = useRef<string | null>(null);
  const voice = useVoiceInput((heard) => {
    if (last.current !== draft()) {
      last.current = null;
      return voice.stop();
    }
    put(joinDictation(before.current, heard));
    last.current = draft();
  });
  const { listening, error, stop } = voice;

  useEffect(() => {
    onNote(listening ? LISTENING_NOTE : error);
  }, [listening, error, onNote]);

  // A message went out: dictation ends at once, so neither the note nor
  // aria-pressed outlives it.
  useEffect(() => {
    last.current = null;
    stop();
  }, [sent, stop]);

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
        // Stopped by its own press, it keeps the words still to come.
        if (listening) return stop();
        // What the box holds as it starts, which may be after a yes.
        const start = () => {
          before.current = draft();
          last.current = before.current;
          voice.start();
        };
        if (ask) ask(start, e.currentTarget);
        else start();
      }}
      className="aria-pressed:border-2 aria-pressed:border-accent aria-pressed:bg-accent/20 aria-pressed:text-accent aria-pressed:shadow-none"
    >
      <Mic aria-hidden="true" />
    </Button>
  );
}
