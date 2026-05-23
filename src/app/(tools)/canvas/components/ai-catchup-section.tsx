"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Clock, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveLlm } from "@/lib/llm/use-active-llm";
import { catchUpPrompt } from "@/lib/whiteboard/ai-actions";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WhiteboardActivityEvent } from "@/lib/stores/workspace-types";
import { useBoardLastCatchup } from "../hooks/use-board-last-catchup";

const AiRunPanel = dynamic(
  () => import("@/components/shared/ai-run-panel"),
  { ssr: false },
);

/**
 * "What's new since you were last here" — AI-summarised activity log.
 *
 * Shows a count of events since the user's last catch-up. Clicking
 * "Catch me up" builds a prompt over those events, streams the LLM
 * response inline, and on success advances the local timestamp so
 * the next visit starts fresh.
 *
 * Activity events are pulled live from the workspace store filtered
 * to the current board + `at > lastCatchupAt`. Server-synced
 * activity (via Realtime) shows up automatically.
 */
export function AiCatchupSection({ boardId }: { boardId: string }) {
  const { isReady, openSettings } = useActiveLlm();
  const { lastCatchupAt, markCaughtUp } = useBoardLastCatchup(boardId);
  const allEvents = useWorkspaceStore(
    (s) => s.whiteboardActivityLog ?? [],
  ) as readonly WhiteboardActivityEvent[];

  // Filter to this board + since-timestamp. Memo so the count + the
  // prompt builder don't re-walk the full log on every render of
  // the AI panel (the parent panel can re-render at ~30 Hz during
  // AI streaming).
  const newEvents = useMemo(
    () =>
      allEvents
        .filter((e) => e.boardId === boardId && e.at > lastCatchupAt)
        .sort((a, b) => b.at - a.at),
    [allEvents, boardId, lastCatchupAt],
  );

  const [runTrigger, setRunTrigger] = useState(0);
  const [armedPrompt, setArmedPrompt] = useState<string | null>(null);

  const onCatchUp = () => {
    if (!isReady || newEvents.length === 0) return;
    const def = catchUpPrompt(newEvents, lastCatchupAt);
    setArmedPrompt(def.prompt);
    setRunTrigger((n) => n + 1);
  };

  const onDismiss = () => {
    // Advance the timestamp and tear down the panel. The user has
    // either read the summary or chosen not to wait for one.
    markCaughtUp();
    setArmedPrompt(null);
  };

  return (
    <section>
      <h4 className="text-xs uppercase tracking-wider text-sub mb-2 flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5 text-accent" />
        What&apos;s new
      </h4>

      {newEvents.length === 0 ? (
        <p className="text-xs text-sub italic">
          No new activity since your last catch-up.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-text">
            <span className="font-mono text-accent">{newEvents.length}</span>{" "}
            event{newEvents.length === 1 ? "" : "s"} since your last visit.
          </p>
          <Button
            size="sm"
            onClick={onCatchUp}
            disabled={!isReady}
            className="w-full gap-1.5 bg-accent text-bg hover:bg-accent/90 font-semibold disabled:opacity-50"
          >
            <ChevronRight className="w-3.5 h-3.5" />
            Catch me up
          </Button>
          {!isReady && (
            <p className="text-[10px] text-sub italic">
              Configure an AI provider to enable summaries.{" "}
              <button
                type="button"
                onClick={openSettings}
                className="underline text-accent hover:text-text"
              >
                Open AI settings
              </button>
            </p>
          )}
          {armedPrompt && (
            <div className="space-y-2">
              <AiRunPanel
                prompt={armedPrompt}
                toolName="canvas-catchup"
                runTrigger={runTrigger}
                compact
                onResult={() => {
                  // Successful summary — advance the timestamp so a
                  // re-open doesn't show the same events. The user
                  // sees the summary in the run panel until they
                  // dismiss.
                  markCaughtUp();
                }}
              />
              <button
                type="button"
                onClick={onDismiss}
                className="text-[10px] text-sub hover:text-text underline"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
