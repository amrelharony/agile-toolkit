"use client";

/**
 * A participant's box for one post on the wall: at most 280 characters
 * (the count shows as they type), one post every 5 seconds. The text lives
 * in this component until it is sent, then the box clears; nothing is
 * stored. Enter alone posts; Shift+Enter is a space (a post is one line).
 */

import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { WALL_LIMITS } from "@/lib/realtime/wall-room/protocol";
import type { WallSendResult } from "@/lib/realtime/wall-room/use-wall-room";

export interface WallPostFormProps {
  onPost: (text: string) => Promise<WallSendResult>;
  /** Why posting is off right now (shown, and the button is disabled). */
  disabledReason?: string | null;
  label?: string;
}

/** What a refused post means for the person, or null when it went. */
export function wallSendError(result: WallSendResult): string | null {
  switch (result) {
    case "sent":
      return null;
    case "empty":
      return "Write something first.";
    case "too-long":
      return `Keep it to ${WALL_LIMITS.maxPostChars} characters.`;
    case "too-soon":
      return "One post every 5 seconds: wait a moment and send it again.";
    case "closed":
      return "The host isn't taking posts right now.";
    case "not-yours":
      return "That isn't yours to change.";
    default:
      return "Couldn't send it. Try again.";
  }
}

export function WallPostForm({
  onPost,
  disabledReason = null,
  label = "Your post",
}: WallPostFormProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const countId = useId();
  const announce = useAnnounce();
  const length = text.replace(/\s+/g, " ").trim().length;
  const over = length > WALL_LIMITS.maxPostChars;

  const send = async () => {
    if (sending || disabledReason) return;
    setSending(true);
    const result = await onPost(text);
    setSending(false);
    const message = wallSendError(result);
    setError(message);
    if (result === "sent") {
      setText("");
      announce("Posted. It shows on the wall once the host's browser takes it.");
    }
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void send();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-2">
      <Field
        label={label}
        error={error}
        hint={`${length} of ${WALL_LIMITS.maxPostChars} characters.`}
      >
        {(props) => (
          <Textarea
            {...props}
            aria-describedby={
              [props["aria-describedby"], countId].filter(Boolean).join(" ") || undefined
            }
            value={text}
            rows={3}
            maxLength={WALL_LIMITS.maxRawPostChars}
            onKeyDown={onKeyDown}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
          />
        )}
      </Field>
      <span id={countId} className="sr-only">
        {over ? `${length - WALL_LIMITS.maxPostChars} characters too many.` : ""}
      </span>
      {disabledReason && <p className="text-sm text-sub">{disabledReason}</p>}
      <Button
        type="submit"
        variant="toolkit"
        className="gap-1.5"
        disabled={sending || Boolean(disabledReason) || over}
      >
        <Send className="h-4 w-4" aria-hidden="true" />
        {sending ? "Posting…" : "Post"}
      </Button>
    </form>
  );
}
