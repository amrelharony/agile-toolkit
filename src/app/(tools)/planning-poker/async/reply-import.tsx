"use client";

/**
 * A reply link opened on the host's own page: /planning-poker#reply=AT1.…
 *
 * Never applied by itself. It asks "Add Lee's cards to “X”?" with Add or
 * Ignore, or, when Lee has already replied, Replace, Keep both or Ignore.
 * Either way the hash is cleared from the address, so a refresh or a shared
 * address doesn't bring the question back. A reply for a round this browser
 * doesn't hold says to open the link on the device that made the round.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { PLANNING_POKER_ACTIONS } from "@/lib/history/event-actions";
import { readAsyncRound, readReply, replyClash, replyProblem } from "@/lib/estimation/async-pack";
import { addReplyToRound, shortTitle } from "./round-actions";

/** The address without its #reply= fragment. */
function clearReplyHash() {
  if (!window.location.hash.startsWith("#reply=")) return;
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}`
  );
}

export function ReplyImport({ code, onDone }: { code: string; onDone: () => void }) {
  const hydrated = useWorkspaceHydrated();
  const { log } = useHistoryLogger("planning-poker");
  const reply = useMemo(() => readReply(code), [code]);
  const stored = useWorkspaceStore((s) =>
    reply ? s.pokerAsyncRounds?.find((r) => r.id === reply.roundId) : undefined
  );
  const round = stored ? readAsyncRound(stored) : undefined;
  const [done, setDone] = useState<string | null>(null);
  const boxRef = useRef<HTMLElement>(null);

  // The question gets the focus once it can be answered.
  useEffect(() => {
    if (hydrated) boxRef.current?.focus();
  }, [hydrated]);

  if (!hydrated) {
    return (
      <p role="status" className="mx-auto mb-4 max-w-xl text-sm text-sub">
        Reading the reply…
      </p>
    );
  }

  const finish = (message: string | null) => {
    clearReplyHash();
    if (message) setDone(message);
    else onDone();
  };

  const problem = done ? null : reply ? replyProblem(reply, round) : null;
  const clash = !done && reply && round && !problem ? replyClash(reply, round) : null;

  const add = (mode: "replace" | "keep-both") => {
    if (!reply) return;
    const res = addReplyToRound(reply, mode);
    if (!res.ok) return finish(res.problem);
    log(PLANNING_POKER_ACTIONS.ASYNC_REPLY_ADDED, {
      roundId: res.round.id,
      replies: res.round.replies.length,
    });
    finish(`Added ${res.name}'s cards to “${shortTitle(res.round.title)}”.`);
  };

  return (
    <section
      ref={boxRef}
      tabIndex={-1}
      aria-label="A reply to a round without a meeting"
      className="mx-auto mb-4 flex max-w-xl flex-col gap-3 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 focus:outline-none"
    >
      <p className="flex items-start gap-2 text-sm text-text">
        <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <span role="status">
          {done
            ? done
            : !reply
              ? "This reply link isn't complete. Ask for it again, copied in full."
              : problem
                ? problem
                : clash
                  ? `Add ${reply.name}'s cards to “${shortTitle(round?.title ?? "")}”? This replaces ${reply.name}'s earlier reply.`
                  : `Add ${reply.name}'s cards to “${shortTitle(round?.title ?? "")}”?`}
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        {done || !reply || problem ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => (done ? onDone() : finish(null))}
          >
            {done ? "Done" : "Dismiss"}
          </Button>
        ) : clash ? (
          <>
            <Button type="button" size="sm" onClick={() => add("replace")}>
              Replace
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => add("keep-both")}>
              Keep both
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => finish(null)}>
              Ignore
            </Button>
          </>
        ) : (
          <>
            <Button type="button" size="sm" onClick={() => add("replace")}>
              Add
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => finish(null)}>
              Ignore
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
