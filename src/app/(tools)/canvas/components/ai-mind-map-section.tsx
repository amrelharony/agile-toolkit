"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Network, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveLlm } from "@/lib/llm/use-active-llm";
import { generateMindMapPrompt } from "@/lib/whiteboard/ai-actions";
import { extractJson } from "@/lib/utils/extract-json";

const AiRunPanel = dynamic(() => import("@/components/shared/ai-run-panel"), { ssr: false });

/**
 * Recursive shape produced by the LLM. Parser validates that every
 * node has a non-empty `label` string + an array `children`. Bad
 * shapes (missing fields, wrong types) get filtered out — surfacing
 * a half-tree is better UX than refusing to render anything.
 */
export interface MindMapTreeNode {
  label: string;
  children: MindMapTreeNode[];
}

/**
 * Best-effort extractor for the AI's mind-map tree response.
 * Tolerates the same wrapping the rest of the AI actions handle
 * (markdown fences, leading preamble) and rejects shapes that
 * don't carry a usable `label` field.
 *
 * Returns null on any failure; the caller surfaces a quiet
 * "couldn't parse" rather than a hard error.
 */
function parseMindMapTree(text: string): MindMapTreeNode | null {
  if (!text) return null;
  // Use the shared string-aware brace walker. The previous
  // indexOf/lastIndexOf approach over-extended the slice through
  // model commentary that contained a stray `}`, and failed on
  // mind-map labels with literal `{` characters.
  const parsed = extractJson<unknown>(text, "{");
  if (!parsed) return null;
  // Recursive validate-and-clean. Depth-limited so a hostile or
  // pathological response can't blow the stack.
  const MAX_DEPTH = 8;
  const MAX_CHILDREN_PER_NODE = 20;
  const walk = (node: unknown, depth: number): MindMapTreeNode | null => {
    if (depth > MAX_DEPTH) return null;
    if (!node || typeof node !== "object") return null;
    const n = node as { label?: unknown; children?: unknown };
    if (typeof n.label !== "string" || n.label.trim().length === 0) return null;
    const childArr = Array.isArray(n.children) ? n.children : [];
    const children: MindMapTreeNode[] = [];
    for (let i = 0; i < Math.min(childArr.length, MAX_CHILDREN_PER_NODE); i++) {
      const c = walk(childArr[i], depth + 1);
      if (c) children.push(c);
    }
    return {
      label: n.label.trim().slice(0, 200),
      children,
    };
  };
  return walk(parsed, 1);
}

/**
 * Mind-map generation panel: enter a topic, AI produces a tree,
 * parent applies it as a new mind map on the canvas.
 *
 * Lives next to brainstorm in the AI Insights panel since it's the
 * same "type a topic, get structured content" interaction. The
 * differentiator is the tree shape — caller builds a real mind-map
 * hierarchy via `onApplyTree`, not just a list of strings.
 */
export function AiMindMapSection({
  onApplyTree,
}: {
  onApplyTree: (root: MindMapTreeNode) => void;
}) {
  const { isReady, openSettings } = useActiveLlm();
  const [topic, setTopic] = useState("");
  const [armedPrompt, setArmedPrompt] = useState<string | null>(null);
  const [runTrigger, setRunTrigger] = useState(0);

  const canGenerate = topic.trim().length > 0;

  const onGenerate = () => {
    if (!canGenerate || !isReady) return;
    setArmedPrompt(generateMindMapPrompt(topic).prompt);
    setRunTrigger((n) => n + 1);
  };

  const onReset = () => {
    setArmedPrompt(null);
    setTopic("");
  };

  return (
    <section>
      <h4 className="text-xs uppercase tracking-wider text-sub mb-2 flex items-center gap-1.5">
        <Network className="w-3.5 h-3.5 text-accent" />
        AI mind map
      </h4>
      <div className="space-y-2">
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canGenerate && isReady) onGenerate();
          }}
          placeholder="Topic to explore…"
          maxLength={200}
          className="w-full text-xs bg-surface-deep border border-border rounded px-2 py-1.5 text-text placeholder:text-sub focus:outline-none focus:border-accent"
        />
        <Button
          size="sm"
          onClick={onGenerate}
          disabled={!canGenerate || !isReady}
          className="w-full gap-1.5 bg-accent text-bg hover:bg-accent/90 font-semibold disabled:opacity-50"
        >
          {armedPrompt ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Network className="w-3.5 h-3.5" />
          )}
          Generate
        </Button>
        {!isReady && (
          <p className="text-xs text-sub italic">
            Configure an AI provider to enable mind-map generation.{" "}
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
          <div className="space-y-1.5">
            <AiRunPanel
              prompt={armedPrompt}
              toolName="canvas-mind-map"
              runTrigger={runTrigger}
              compact
              onResult={({ text }) => {
                const tree = parseMindMapTree(text);
                if (tree) onApplyTree(tree);
              }}
            />
            <button
              type="button"
              onClick={onReset}
              className="text-xs text-sub hover:text-text underline"
            >
              Start over
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
