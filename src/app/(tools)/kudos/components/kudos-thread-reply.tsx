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
 * Inherits the parent's theme + recipient so the reply visually anchors
 * to the original — the user is replying to a recognition, not minting
 * a new theme. The sender name comes from the local viewer (passed via
 * props so the same component works for owner + guest seats).
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
        // Inherit parent's theme so the reply visually anchors to the
        // original card — see component-doc comment.
        theme: parent.theme,
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
      className="ml-3 sm:ml-6 mt-2 flex flex-col sm:flex-row sm:items-start gap-2 rounded-md border border-border/40 bg-surface-deep/60 p-3"
    >
      <div className="flex flex-1 min-w-0 flex-col gap-1.5">
        <Input
          aria-label={`Reply to kudos for ${parent.toName}`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={`Reply to ${parent.toName}…`}
          maxLength={400}
          className="bg-surface border-border/40 text-sm text-text"
          autoFocus
        />
        <div className="flex items-center justify-between gap-2">
          <span
            className={`text-[10px] ${
              messageWords > KUDOS_WORD_LIMITS.message ? "text-red-400" : "text-sub/60"
            }`}
          >
            {messageWords}/{KUDOS_WORD_LIMITS.message} words
          </span>
          {error && (
            <span role="alert" className="text-[10px] text-red-300">
              {error}
            </span>
          )}
        </div>
      </div>
      <Button
        type="submit"
        size="sm"
        disabled={!canSubmit}
        className="bg-accent text-[#0a0e1a] hover:bg-accent/80 gap-1.5 self-stretch sm:self-start"
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
