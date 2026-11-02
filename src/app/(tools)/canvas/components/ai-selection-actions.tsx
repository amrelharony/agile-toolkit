"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Languages, Wand2, ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveLlm } from "@/lib/llm/use-active-llm";
import {
  translateStickiesPrompt,
  rewriteTonePrompt,
  extractActionItemsPrompt,
} from "@/lib/whiteboard/ai-actions";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import { extractJson } from "@/lib/utils/extract-json";

const AiRunPanel = dynamic(() => import("@/components/shared/ai-run-panel"), { ssr: false });

/**
 * Find the JSON payload inside an LLM response.
 *
 * Real-world output is wrapped in markdown fences, prefixed with
 * preambles, or contains commentary. Delegates to the shared
 * `extractJson` util in `lib/utils/extract-json.ts` which walks the
 * text tracking JSON brace depth while respecting string literals.
 * Returns `null` on any failure.
 */
// Re-exported for the other ai-* sections so the brace-walking logic
// lives in exactly one place. See lib/utils/extract-json.ts for the
// pitfalls of the previous indexOf/lastIndexOf approach.

const COMMON_LANGUAGES = [
  "Spanish",
  "French",
  "German",
  "Italian",
  "Portuguese",
  "Japanese",
  "Korean",
  "Mandarin Chinese",
  "Arabic",
  "Hindi",
];

const TONES = ["formal", "casual", "concise", "actionable"] as const;
type Tone = (typeof TONES)[number];

export type ActionItem = {
  title: string;
  ownerId?: string;
  ownerName?: string;
  targetTool?: string;
};

/**
 * AI actions that operate on the current selection. Three actions:
 *
 *   - **Translate**: pick a language, run translateStickiesPrompt
 *     over selected objects, parse `{ [id]: text }` response,
 *     patch each object's primary text field.
 *
 *   - **Rewrite tone**: pick a tone (formal / casual / concise /
 *     actionable), run rewriteTonePrompt, same response shape +
 *     patch flow as translate.
 *
 *   - **Extract action items**: scan selected objects (or the
 *     whole board when nothing useful is selected), parse `[{title,
 *     ownerId, ownerName, targetTool}]`, hand to the parent which
 *     drops a column of cards on the canvas.
 *
 * The section hides itself when there's no selection to act on.
 */
export function AiSelectionActions({
  selection,
  onApplyTextUpdates,
  onApplyActionItems,
}: {
  selection: readonly string[];
  /** Patch text content on existing objects by id. Used by both
   * translate and rewrite. Parent decides which field on the object
   * gets the new text (sticky.content vs frame.label vs card.title). */
  onApplyTextUpdates: (updates: Record<string, string>) => void;
  /** Drop a column of action-item cards next to the selection bbox. */
  onApplyActionItems: (items: readonly ActionItem[]) => void;
}) {
  const { isReady, openSettings } = useActiveLlm();
  const allObjects = useWorkspaceStore(
    (s) => s.whiteboardObjects ?? []
  ) as readonly WhiteboardObject[];

  // Resolve selected objects once per change. Cheap lookup — selection
  // sizes are typically ≤ 50, allObjects ≤ a few thousand.
  const selectedObjects = useMemo(() => {
    if (selection.length === 0) return [] as WhiteboardObject[];
    const ids = new Set(selection);
    return allObjects.filter((o) => ids.has(o.id));
  }, [allObjects, selection]);

  const [language, setLanguage] = useState("Spanish");
  const [tone, setTone] = useState<Tone>("concise");
  const [armed, setArmed] = useState<"translate" | "rewrite" | "extract" | null>(null);
  const [armedPrompt, setArmedPrompt] = useState<string | null>(null);
  const [runTrigger, setRunTrigger] = useState(0);

  const armRun = (action: "translate" | "rewrite" | "extract", prompt: string) => {
    setArmed(action);
    setArmedPrompt(prompt);
    setRunTrigger((n) => n + 1);
  };

  const onTranslate = () => {
    if (!isReady || selectedObjects.length === 0) return;
    armRun("translate", translateStickiesPrompt(selectedObjects, language).prompt);
  };
  const onRewrite = () => {
    if (!isReady || selectedObjects.length === 0) return;
    armRun("rewrite", rewriteTonePrompt(selectedObjects, tone).prompt);
  };
  const onExtract = () => {
    if (!isReady) return;
    // For Extract, fall back to all objects when the selection is
    // empty — "find me action items across the board" is a
    // legitimate ask. Translate/rewrite REQUIRE a selection so we
    // don't accidentally rewrite the whole board.
    const targets = selectedObjects.length > 0 ? selectedObjects : allObjects;
    if (targets.length === 0) return;
    armRun("extract", extractActionItemsPrompt(targets).prompt);
  };

  if (selection.length === 0 && !isReady) {
    // Nothing to show — no selection AND no LLM configured. Stay
    // hidden so the panel isn't cluttered.
    return null;
  }

  return (
    <section className="space-y-2">
      <h4 className="text-xs uppercase tracking-wider text-sub mb-2 flex items-center gap-1.5">
        <Wand2 className="w-3.5 h-3.5 text-accent" />
        Selection actions
      </h4>

      {!isReady ? (
        <p className="text-xs text-sub italic">
          Configure an AI provider to enable these actions.{" "}
          <button
            type="button"
            onClick={openSettings}
            className="underline text-accent hover:text-text"
          >
            Open AI settings
          </button>
        </p>
      ) : selection.length === 0 ? (
        <p className="text-xs text-sub italic">
          Select one or more objects, then use Translate or Rewrite. Extract action items works on
          the whole board if nothing is selected.
        </p>
      ) : null}

      {/* Translate */}
      <div className="flex items-center gap-2">
        <Languages className="w-3.5 h-3.5 text-sub shrink-0" />
        <select
          aria-label="Target language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="text-xs bg-surface-deep border border-border rounded px-2 py-1 text-text focus:outline-none focus:border-accent flex-1"
          disabled={!isReady}
        >
          {COMMON_LANGUAGES.map((lang) => (
            <option key={lang} value={lang}>
              {lang}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          onClick={onTranslate}
          disabled={!isReady || selectedObjects.length === 0}
          className="text-xs font-mono uppercase bg-accent/15 hover:bg-accent/20 text-accent border border-accent/40 disabled:opacity-40"
        >
          Translate
        </Button>
      </div>

      {/* Rewrite tone */}
      <div className="flex items-center gap-2">
        <Wand2 className="w-3.5 h-3.5 text-sub shrink-0" />
        <select
          aria-label="Rewrite tone"
          value={tone}
          onChange={(e) => setTone(e.target.value as Tone)}
          className="text-xs bg-surface-deep border border-border rounded px-2 py-1 text-text focus:outline-none focus:border-accent flex-1"
          disabled={!isReady}
        >
          {TONES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          onClick={onRewrite}
          disabled={!isReady || selectedObjects.length === 0}
          className="text-xs font-mono uppercase bg-accent/15 hover:bg-accent/20 text-accent border border-accent/40 disabled:opacity-40"
        >
          Rewrite
        </Button>
      </div>

      {/* Extract action items */}
      <Button
        size="sm"
        onClick={onExtract}
        disabled={!isReady}
        className="w-full gap-1.5 text-xs font-mono uppercase bg-accent/15 hover:bg-accent/20 text-accent border border-accent/40 disabled:opacity-40"
      >
        <ListTodo className="w-3 h-3" />
        Extract action items {selection.length === 0 ? "(whole board)" : ""}
      </Button>

      {armedPrompt && (
        <div className="space-y-1.5">
          <AiRunPanel
            prompt={armedPrompt}
            toolName={`canvas-${armed}`}
            runTrigger={runTrigger}
            compact
            onResult={({ text }) => {
              if (armed === "translate" || armed === "rewrite") {
                const parsed = extractJson<Record<string, string>>(text, "{");
                if (parsed && typeof parsed === "object") {
                  // Only keep entries where both key + value are
                  // non-empty strings. Defends against malformed
                  // LLM responses with stray nulls / numbers.
                  const clean: Record<string, string> = {};
                  for (const [k, v] of Object.entries(parsed)) {
                    if (typeof v === "string" && v.trim().length > 0) {
                      clean[k] = v.trim();
                    }
                  }
                  if (Object.keys(clean).length > 0) {
                    onApplyTextUpdates(clean);
                  }
                }
              } else if (armed === "extract") {
                const parsed = extractJson<ActionItem[]>(text, "[");
                if (Array.isArray(parsed)) {
                  // Filter to entries with a non-empty title; the
                  // other fields are optional and the parent
                  // gracefully handles missing values.
                  const items = parsed
                    .filter(
                      (x): x is ActionItem =>
                        !!x &&
                        typeof x === "object" &&
                        typeof (x as ActionItem).title === "string" &&
                        (x as ActionItem).title.trim().length > 0
                    )
                    .map((x) => ({
                      title: x.title.trim().slice(0, 500),
                      ownerId: typeof x.ownerId === "string" ? x.ownerId : undefined,
                      ownerName: typeof x.ownerName === "string" ? x.ownerName : undefined,
                      targetTool: typeof x.targetTool === "string" ? x.targetTool : undefined,
                    }));
                  if (items.length > 0) {
                    onApplyActionItems(items);
                  }
                }
              }
            }}
          />
          <button
            type="button"
            onClick={() => {
              setArmed(null);
              setArmedPrompt(null);
            }}
            className="text-xs text-sub hover:text-text underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </section>
  );
}
