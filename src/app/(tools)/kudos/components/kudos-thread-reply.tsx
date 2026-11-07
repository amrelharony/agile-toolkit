"use client";

/**
 * Depth-1 thread reply composer (Phase 5).
 *
 * Renders a single-line input + Send button beneath a parent kudos.
 * Builds a child Kudos with `replyTo` pointing at the parent's id, then
 * calls the parent's `onSend` callback which delegates to the realtime
 * room's `sendKudos`. Threading depth is hard-capped at 1: replies can't
 * be replied to (the card hides the chevron in that case).
 *
 * A reply is a thank-you back: it goes on the "Thank you!" card with no
 * episode, and keeps the parent's recipient so it sits under the original.
 * The sender name comes from the local viewer (passed via props so the
 * same component works for owner + guest seats).
 */

import { useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Kudos } from "@/lib/stores/workspace-types";
import { KUDOS_WORD_LIMITS, countWords } from "../types";

interface Props {
  parent: Kudos;
  /** Local viewer display name — stamped on the reply as `fromName`. */
  fromName: string;
  /** Local viewer's squad profile id when guest-authored. */
  fromProfileId?: string;
  /** Called when the user clicks Send with a valid message. */
  onSend: (reply: Kudos) => Promise<void> | void;
  /** Called after a successful send so the parent can collapse the
   *  composer. Optional — caller may prefer to keep it open. */
  onSent?: () => void;
}

const newReplyId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `kud_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }
  return `kud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

export function KudosThreadReply({ parent, fromName, fromProfileId, onSend, onSent }: Props) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messageWords = countWords(message);
  const ok = messageWords > 0 && messageWords <= KUDOS_WORD_LIMITS.message;
  const canSubmit = ok && !submitting;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const reply: Kudos = {
        id: newReplyId(),
        // A thank-you back, not another episode's card: see the component doc.
        theme: "open-thank-you",
        toName: parent.toName,
        toProfileId: parent.toProfileId,
        fromName: fromName.trim() || "—",
        fromProfileId,
        teamName: parent.teamName,
        message: message.trim(),
        sentAt: new Date().toISOString(),
        replyTo: parent.id,
      };
      await onSend(reply);
      setMessage("");
      onSent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post reply");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSend}
      className="ml-3 sm:ml-6 mt-2 flex flex-col sm:flex-row sm:items-start gap-2 rounded-md border border-border bg-surface-deep/60 p-3"
    >
      <div className="flex flex-1 min-w-0 flex-col gap-1.5">
        <Input
          aria-label={`Reply to kudos for ${parent.toName}`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={`Reply to ${parent.toName}…`}
          maxLength={400}
          className="bg-surface border-border text-sm text-text"
          autoFocus
        />
        <div className="flex items-center justify-between gap-2">
          <span
            className={`text-xs ${
              messageWords > KUDOS_WORD_LIMITS.message ? "text-danger" : "text-sub"
            }`}
          >
            {messageWords}/{KUDOS_WORD_LIMITS.message} words
          </span>
          {error && (
            <span role="alert" className="text-xs text-danger">
              {error}
            </span>
          )}
        </div>
      </div>
      <Button
        type="submit"
        size="sm"
        disabled={!canSubmit}
        className="bg-accent text-bg hover:bg-accent/80 gap-1.5 self-stretch sm:self-start"
      >
        {submitting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        Reply
      </Button>
    </form>
  );
}
