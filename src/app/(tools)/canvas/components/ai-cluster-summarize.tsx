"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveLlm } from "@/lib/llm/use-active-llm";
import { summarizeClusterPrompt } from "@/lib/whiteboard/ai-actions";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import type { ClusterResult } from "@/lib/whiteboard/cluster-bridge";

const AiRunPanel = dynamic(() => import("@/components/shared/ai-run-panel"), { ssr: false });

/**
 * Reduce the AI's free-form response to a clean summary string.
 *
 * The prompt says "just the text, no JSON / quotes / commentary"
 * but LLMs love to wrap things in markdown or add a preamble. We
 * defensively strip:
 *   - leading / trailing whitespace
 *   - surrounding `"`, `'`, ` `` `, or markdown bold/italic wrappers
 *   - a leading "Summary:" / "Here's a summary:" preamble
 *   - markdown bullet markers ("- ", "* ", "• ")
 *
 * Returns null when the result is empty after cleanup so the caller
 * can decline to drop an empty sticky.
 */
function cleanSummary(text: string): string | null {
  if (!text) return null;
  let s = text.trim();
  // Strip a preamble like "Summary:" / "Here is the summary:"
  s = s.replace(/^(summary|here(?:'s| is)(?: the| a)? summary)[:.\s]*/i, "");
  // Strip surrounding code fences / quotes / asterisks / underscores.
  s = s.replace(/^[`"'_*]+|[`"'_*]+$/g, "");
  // Strip leading bullet markers (the model occasionally returns a single-bullet list).
  s = s.replace(/^[-*•]\s+/, "");
  s = s.trim();
  if (!s) return null;
  if (s.length > 500) s = s.slice(0, 500);
  return s;
}

/**
 * Cluster summarization button + inline run panel.
 *
 * Compact form: a "Summarize" button next to each cluster. Clicking
 * arms the run; AiRunPanel streams the response. On completion the
 * summary text is cleaned (preambles, fences, bullets) and handed to
 * `onApplySummary` which drops a sticky at the cluster's bbox
 * centre.
 */
export function AiClusterSummarize({
  cluster,
  memberObjects,
  onApplySummary,
}: {
  cluster: ClusterResult;
  memberObjects: readonly WhiteboardObject[];
  onApplySummary: (cluster: ClusterResult, text: string) => void;
}) {
  const { isReady } = useActiveLlm();
  const [runTrigger, setRunTrigger] = useState(0);
  const [armedPrompt, setArmedPrompt] = useState<string | null>(null);

  const onClick = () => {
    if (!isReady || memberObjects.length === 0) return;
    const def = summarizeClusterPrompt(memberObjects);
    setArmedPrompt(def.prompt);
    setRunTrigger((n) => n + 1);
  };

  if (!isReady) return null;

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        size="sm"
        onClick={onClick}
        disabled={memberObjects.length === 0}
        className="w-full gap-1.5 bg-accent/15 hover:bg-accent/20 text-accent border border-accent/40 font-mono text-xs uppercase tracking-wider"
      >
        <Sparkles className="w-3 h-3" />
        Summarize cluster
      </Button>
      {armedPrompt && (
        <AiRunPanel
          prompt={armedPrompt}
          toolName="canvas-cluster-summary"
          runTrigger={runTrigger}
          compact
          onResult={({ text }) => {
            const cleaned = cleanSummary(text);
            if (cleaned) onApplySummary(cluster, cleaned);
          }}
        />
      )}
    </div>
  );
}
