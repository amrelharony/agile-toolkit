"use client";

/**
 * The notice a visitor sees on the first press of the mic in Amr's AI chat
 * (visitor-agent-panel's VisitorDictate), before dictation first listens: the
 * browser's own speech recognition may send the sound of their voice to the
 * company that makes the browser. The words are VOICE_INPUT_DISCLOSURE
 * (lib/site/voice-disclosure, re-exported by lib/site/disclosures), which the
 * privacy page quotes too.
 *
 *   look     a narration caption under the message box's row: the
 *            narrator's words, never Amr's (DNA-SPEC section 6, "Chat
 *            strip"), Inter throughout. Its label asks the question, the
 *            disclosure says why, and two buttons answer: "Use voice" and
 *            "Not now", 44 px on a touch screen.
 *   group    role="group", named by its label and described by the
 *            disclosure, so a screen reader says what it is before the
 *            buttons. It takes focus as it shows, from code only (chat-context
 *            focusFromCode: focusable just while it holds focus, so a tap on
 *            its words takes none), and Tab goes on to the buttons; unless
 *            the visitor moved focus or typed while it loaded (`takeFocus`
 *            false), when it shows without it and the mic's next press,
 *            which shows it again, brings it focus.
 *   choice   either one hands focus back to the mic, and the notice goes;
 *            "Use voice" then starts dictation, and the chat remembers the
 *            yes in this browser (lib/agent/mascot/voice-consent). Escape
 *            inside it is "Not now", and stops there: the panel, which
 *            Escape would close, never sees it.
 *
 * Visitor-only and needed only on that first press, so the visitor's chat
 * loads it with a dynamic import from the mic's handler: the owner never
 * downloads it, nor does a visitor who never presses the mic
 * (test/agent/bundle-boundary.test.ts).
 */

import { useId, useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
// From its own module, not disclosures.ts, so the text ships with this chunk alone.
import { VOICE_INPUT_DISCLOSURE } from "@/lib/site/voice-disclosure";
import { focusFromCode } from "../chat/chat-context";
import { Narration } from "../comic/comic-parts";

/** The notice's label, which names its group: the question its buttons answer. */
export const VOICE_NOTICE_LABEL = "Use your voice?";
/** The yes: dictation starts. */
export const USE_VOICE = "Use voice";
/** The no: nothing starts, and the next press of the mic asks again. */
export const NOT_NOW = "Not now";

export interface VoiceNoticeProps {
  /** The visitor chose: true for "Use voice", false for "Not now" or Escape. */
  onChoose(useVoice: boolean): void;
  /** Take focus as it shows (default); false when the visitor moved on while it loaded. */
  takeFocus?: boolean;
}

/** The voice notice: see the file comment. */
export function VoiceNotice({ onChoose, takeFocus = true }: VoiceNoticeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const labelId = `${id}label`;
  const textId = `${id}text`;

  // Before paint, so no frame shows focus left behind on the mic. As it
  // shows only: a later press of the mic shows a new one (a new key).
  const focusOnShow = useRef(takeFocus);
  useLayoutEffect(() => {
    if (focusOnShow.current) focusFromCode(ref.current);
  }, []);

  return (
    // The group takes Escape for its buttons and for itself (it holds focus as it shows).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={ref}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={textId}
      data-voice-notice=""
      className="mt-2"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        onChoose(false);
      }}
    >
      <Narration
        label={<span id={labelId}>{VOICE_NOTICE_LABEL}</span>}
        actions={
          <>
            <Button type="button" size="sm" onClick={() => onChoose(true)}>
              {USE_VOICE}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onChoose(false)}>
              {NOT_NOW}
            </Button>
          </>
        }
      >
        <span id={textId}>{VOICE_INPUT_DISCLOSURE}</span>
      </Narration>
    </div>
  );
}
