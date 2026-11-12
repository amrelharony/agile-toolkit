"use client";

/**
 * A participant's box for one post on the wall: at most 280 characters
 * (the count shows as they type), one post every 5 seconds. The text lives
 * in this component until it is sent, then the box clears; nothing is
 * stored. Enter alone posts; Shift+Enter is a space (a post is one line).
 */

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
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
  /** Brainwriting: the post this one says "Yes, and…" to, shown above the box. */
  replyTo?: { text: string } | null;
  /** Drop `replyTo` (a plain post again). */
  onCancelReply?: () => void;
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
  replyTo = null,
  onCancelReply,
}: WallPostFormProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const countId = useId();
  const announce = useAnnounce();
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const replyText = replyTo?.text ?? null;
  // Picking a post to say "Yes, and…" to puts the cursor in the box.
  useEffect(() => {
    if (replyText !== null) boxRef.current?.focus();
  }, [replyText]);
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
      onCancelReply?.();
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
      {replyTo && (
        <div className="flex min-w-0 flex-wrap items-start gap-2 rounded-lg border border-accent/30 bg-surface-deep px-3 py-2">
          <p className="min-w-0 flex-1 break-words text-sm text-text">
            <span className="font-medium text-accent">Yes, and… on: </span>
            {replyTo.text}
          </p>
          {onCancelReply && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancelReply}>
              Cancel <span className="sr-only">the Yes, and…</span>
            </Button>
          )}
        </div>
      )}
      <Field
        label={replyTo ? "Your Yes, and…" : label}
        error={error}
        hint={`${length} of ${WALL_LIMITS.maxPostChars} characters.`}
      >
        {(props) => (
          <Textarea
            {...props}
            ref={boxRef}
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
