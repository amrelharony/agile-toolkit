"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveLlm } from "@/lib/llm/use-active-llm";
import { extractJson } from "@/lib/utils/extract-json";
import { generateStickiesPrompt } from "@/lib/whiteboard/ai-actions";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Lazy-load the run panel so the LLM machinery only lands in the
 * bundle when the user actually clicks Generate. Non-AI users pay
 * zero — they see only the Generate button + the BYOK nudge.
 */
const AiRunPanel = dynamic(
  () => import("@/components/shared/ai-run-panel"),
  { ssr: false },
);

/**
 * Best-effort JSON extractor for LLM responses.
 *
 * Real-world LLM output is messy: sometimes it's `[...]` raw, sometimes
 * it's wrapped in ` ```json ` fences, sometimes there's a one-line
 * preamble ("Here's the list:") followed by the array. We tolerate
 * all of those by finding the first `[` and last `]` and trying to
 * parse the slice between. Returns null on any failure — caller
 * surfaces a toast.
 */
function parseStickyArray(text: string): string[] | null {
  if (!text) return null;
  // Shared string-aware brace walker — previously `indexOf("[")` +
  // `lastIndexOf("]")` over-extended through commentary like
  // `[1,2,3] (note: the closing ] above is intentional)`.
  const parsed = extractJson<unknown>(text, "[");
  if (!Array.isArray(parsed)) return null;
  // Coerce + bound. The AI sometimes returns objects with a `text`
  // field instead of bare strings; accept either shape.
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item === "string") {
      const s = item.trim();
      if (s.length > 0 && s.length <= 5000) out.push(s);
    } else if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
      const s = (item as { text: string }).text.trim();
      if (s.length > 0 && s.length <= 5000) out.push(s);
    }
  }
  return out.length > 0 ? out : null;
}

/**
 * Brainstorm-stickies AI action — wires `generateStickiesPrompt` from
 * `ai-actions.ts` through to the active-LLM runner and applies the
 * resulting JSON array as new stickies on the canvas.
 *
 * Two states:
 *   - Form: topic + count input, "Generate" button.
 *   - Running: AiRunPanel inline with stream + abort + cost preview.
 *     On successful completion, the JSON array is parsed and the
 *     `onApplyStickies` callback is fired with the texts. The parent
 *     creates the actual board objects (positions + ids).
 *
 * The other three ai-actions (translate, rewrite, extract action
 * items) follow the same pattern: build a `PromptDefinition`, pass
 * `.prompt` to `<AiRunPanel>`, parse the result, fire a callback.
 */
export function AiBrainstormSection({
  onApplyStickies,
}: {
  onApplyStickies: (texts: string[]) => void;
}) {
  const { isReady, openSettings } = useActiveLlm();
  const workspace = useWorkspaceStore.getState();
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(10);
  const [runTrigger, setRunTrigger] = useState(0);
  const [armedPrompt, setArmedPrompt] = useState<string | null>(null);

  const canGenerate = topic.trim().length > 0 && count >= 1 && count <= 50;

  const onGenerate = () => {
    if (!canGenerate) return;
    const def = generateStickiesPrompt(topic, count, workspace);
    setArmedPrompt(def.prompt);
    // runTrigger increment fires the next AiRunPanel mount immediately.
    setRunTrigger((n) => n + 1);
  };

  const onReset = () => {
    setArmedPrompt(null);
    setTopic("");
  };

  return (
    <section>
      <h4 className="text-xs uppercase tracking-wider text-sub mb-2 flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5 text-accent" />
        Brainstorm stickies
      </h4>

      <div className="space-y-2">
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canGenerate && isReady) onGenerate();
          }}
          placeholder="What should we brainstorm about?"
          maxLength={200}
          className="w-full text-xs bg-surface-deep border border-border rounded px-2 py-1.5 text-text placeholder:text-sub focus:outline-none focus:border-accent"
        />
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-sub font-mono uppercase">Count</label>
          <input
            type="number"
            value={count}
            onChange={(e) => {
              const n = Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 10)));
              setCount(n);
            }}
            min={1}
            max={50}
            className="w-14 text-xs bg-surface-deep border border-border rounded px-2 py-1 text-text focus:outline-none focus:border-accent"
          />
          <Button
            size="sm"
            onClick={onGenerate}
            disabled={!canGenerate || !isReady}
            className="ml-auto gap-1.5 bg-accent text-bg hover:bg-accent/90 font-semibold disabled:opacity-50"
          >
            {armedPrompt ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Generate
          </Button>
        </div>

        {!isReady && (
          <p className="text-[10px] text-sub italic">
            Configure an AI provider to enable brainstorming.{" "}
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
              toolName="canvas-brainstorm"
              runTrigger={runTrigger}
              compact
              onResult={({ text }) => {
                const stickies = parseStickyArray(text);
                if (stickies && stickies.length > 0) {
                  onApplyStickies(stickies);
                }
              }}
            />
            <button
              type="button"
              onClick={onReset}
              className="text-[10px] text-sub hover:text-text underline"
            >
              Start over
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
