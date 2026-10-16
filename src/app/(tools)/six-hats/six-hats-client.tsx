"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Sparkles, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { SixHatsThought, Workspace } from "@/lib/stores/workspace-types";
import { generateSixHatsPrompts } from "@/lib/ai-prompts/six-hats";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SIX_HATS_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

const HATS: { id: SixHatsThought["hat"]; label: string; color: string; hint: string }[] = [
  {
    id: "white",
    label: "White — Facts",
    color: "#cccccc",
    hint: "Just the data — what do we know?",
  },
  {
    id: "red",
    label: "Red — Feelings",
    color: "#ff6b6b",
    hint: "Gut reactions, intuition, no justification needed",
  },
  {
    id: "black",
    label: "Black — Risks",
    color: "#666666",
    hint: "What could go wrong? Cautions, downsides",
  },
  {
    id: "yellow",
    label: "Yellow — Benefits",
    color: "#ffaa00",
    hint: "Optimism, value, why this could work",
  },
  {
    id: "green",
    label: "Green — Creativity",
    color: "#00ff88",
    hint: "New ideas, alternatives, what if?",
  },
  {
    id: "blue",
    label: "Blue — Process",
    color: "#00f0ff",
    hint: "Manage the thinking; next steps, summary",
  },
];

export function SixHatsClient() {
  const list = useWorkspaceStore((s) => s.sixHatsThoughts ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertSixHatsThought);
  const removeOne = useWorkspaceStore((s) => s.removeSixHatsThought);
  const { log } = useHistoryLogger("six-hats");
  const exportRef = useRef<HTMLDivElement>(null);

  const [hat, setHat] = useState<SixHatsThought["hat"]>("white");
  const [text, setText] = useState("");

  function add() {
    if (!text.trim()) return;
    const item: SixHatsThought = {
      id: crypto.randomUUID(),
      hat,
      text: text.trim(),
      loggedAt: new Date().toISOString(),
    };
    upsert(item);
    log(SIX_HATS_ACTIONS.THOUGHT_ADDED, { hat });
    emitSignal({
      kind: "sixHats.thoughtLogged",
      at: item.loggedAt,
      toolId: "six-hats",
      payload: item,
    });
    setText("");
  }

  const grouped = useMemo(() => {
    const m: Record<SixHatsThought["hat"], SixHatsThought[]> = {
      white: [],
      red: [],
      black: [],
      yellow: [],
      green: [],
      blue: [],
    };
    // R5: skip thoughts whose `hat` is out of schema (legacy persist,
    // hand-edit). The previous `m[t.hat].push(t)` crashed on undefined.
    for (const t of list) {
      if (t.hat && m[t.hat]) m[t.hat].push(t);
    }
    return m;
  }, [list]);

  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers,
        sprints: s.sprints,
        stories: s.stories,
        impediments: s.impediments,
        risks: s.risks,
        okrs: s.okrs,
        decisions: s.decisions,
        techDebt: s.techDebt,
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
        sixHatsThoughts: s.sixHatsThoughts,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Six Thinking Hats",
      prompts: generateSixHatsPrompts({ grouped }, workspace),
    }),
    [grouped, workspace]
  );

  const csvData = {
    headers: ["Hat", "Thought", "Logged"],
    rows: list.map((t) => [t.hat, t.text, t.loggedAt]),
  };

  return (
    <ToolPageWrapper
      toolId="six-hats"
      title="Six Thinking Hats"
      description="De Bono's parallel-thinking framework: six perspectives (facts / feelings / risks / benefits / creativity / process) on the same problem."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Add thought" icon={Plus}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Select value={hat} onValueChange={(v) => setHat(v as SixHatsThought["hat"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HATS.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {h.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              placeholder="Your thought (one per hat at a time)"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              className="sm:col-span-2"
            />
          </div>
          <p className="text-xs text-sub mt-2 italic">{HATS.find((h) => h.id === hat)?.hint}</p>
          <Button onClick={add} className="mt-3 gap-1">
            <Plus className="w-4 h-4" />
            Log
          </Button>
        </SectionCard>

        <SectionCard
          title={`Thoughts (${list.length})`}
          icon={Sparkles}
          actions={
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="six-hats"
                csvData={csvData}
                jsonData={list}
                targetRef={exportRef}
              />
            </>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {HATS.map((h) => (
              <div key={h.id} className="border border-border rounded p-3 bg-surface-deep">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold uppercase text-sm" style={{ color: h.color }}>
                    {h.label}
                  </span>
                  <span className="text-xs text-sub">{grouped[h.id].length}</span>
                </div>
                <ul className="space-y-1.5">
                  {grouped[h.id].map((t) => (
                    <li key={t.id} className="flex items-start gap-2 text-sm">
                      <span className="flex-1 text-text">{t.text}</span>
                      <button
                        onClick={() => {
                          removeOne(t.id);
                          log(SIX_HATS_ACTIONS.THOUGHT_REMOVED, { id: t.id });
                        }}
                        aria-label="Remove thought"
                        className="text-sub hover:text-danger min-touch-coarse"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </ToolPageWrapper>
  );
}
