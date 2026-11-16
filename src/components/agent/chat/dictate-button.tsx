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
 *
 * Handed to the composer by the owner's chat only, so a visitor's chat
 * doesn't carry dictation it may not use before saying yes to it (browser
 * dictation may send the audio to the browser's maker).
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

/** The mic: see the file comment. */
export function DictateButton({ draft, put, onNote }: ComposerMicProps) {
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
      onClick={() => {
        if (listening) return voice.stop();
        before.current = draft();
        voice.start();
      }}
      className={cn(listening && "border-accent text-accent")}
    >
      <Mic aria-hidden="true" />
    </Button>
  );
}
