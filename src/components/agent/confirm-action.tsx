"use client";

import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";
import { useAgentStore } from "@/lib/agent/store";

/**
 * Inline approval card for write/intent actions. The summary text is
 * built by `executeToolUse` and describes what's about to run.
 *
 * Approve / Approve all / Deny invoke the resolver embedded in the
 * pending tool_use entry (BUG-G9: previously stored on globalThis,
 * which made concurrent confirmations race). Approve-all flips the
 * `autoApprove` flag for the rest of this session (BUG-G1: cleared
 * on sheet close).
 */
export function ConfirmAction() {
  const pending = useAgentStore((s) => s.pendingToolUse);
  const setAutoApprove = useAgentStore((s) => s.setAutoApprove);
  if (!pending) return null;

  return (
    <div className="rounded-lg border border-accent/40 bg-accent/5 p-3 space-y-2">
      <div className="text-xs uppercase tracking-wide text-accent">Confirm action</div>
      <div className="text-sm text-text">{pending.summary}</div>
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" onClick={() => pending.resolve(true)} className="gap-1">
          <Check className="w-3.5 h-3.5" aria-hidden="true" />
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setAutoApprove(true);
            pending.resolve(true);
          }}
        >
          Approve all this session
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => pending.resolve(false)}
          className="gap-1"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
          Deny
        </Button>
      </div>
    </div>
  );
}
