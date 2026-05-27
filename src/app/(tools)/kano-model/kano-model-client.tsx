"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Heart, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem, Workspace } from "@/lib/stores/workspace-types";
import { generateKanoPrompts } from "@/lib/ai-prompts/kano-model";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { KANO_ACTIONS } from "@/lib/history/event-actions";

type Category = "must-be" | "performance" | "attractive" | "indifferent" | "reverse";
const CATEGORIES: { id: Category; label: string; color: string; hint: string }[] = [
  {
    id: "must-be",
    label: "Must-be",
    color: "#ff00aa",
    hint: "Expected; absence causes dissatisfaction",
  },
  { id: "performance", label: "Performance", color: "#00f0ff", hint: "Linear: more is better" },
  { id: "attractive", label: "Attractive", color: "#00ff88", hint: "Delight; absence is OK" },
  { id: "indifferent", label: "Indifferent", color: "#888", hint: "Customers don't care" },
  { id: "reverse", label: "Reverse", color: "#ff6b6b", hint: "Presence causes dissatisfaction" },
];

export function KanoModelClient() {
  const all = useWorkspaceStore((s) => s.prioritizations ?? []);
  const items = useMemo(() => all.filter((x) => x.framework === "kano"), [all]);
  const upsert = useWorkspaceStore((s) => s.upsertPrioritization);
  const removeOne = useWorkspaceStore((s) => s.removePrioritization);
  const { log } = useHistoryLogger("kano-model");
  const exportRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("performance");
  const [satIfPresent, setSatIfPresent] = useState("");
  const [dissatIfAbsent, setDissatIfAbsent] = useState("");

  function add() {
    if (!title.trim()) return;
    // Clamp to the [0, 5] range advertised in the input placeholders. Without
    // this a stray `e2` keystroke would persist `200` as a satisfaction
    // score, which then dominates every ranking that uses it downstream.
    const parseBounded = (raw: string): number => {
      const n = parseFloat(raw);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(5, n));
    };
    const sat = parseBounded(satIfPresent);
    const dissat = parseBounded(dissatIfAbsent);
    const item: PrioritizationItem = {
      id: crypto.randomUUID(),
      framework: "kano",
      title: title.trim(),
      score: sat + Math.abs(dissat),
      fields: { category, satIfPresent: sat, dissatIfAbsent: dissat },
      status: "scored",
      updatedAt: new Date().toISOString(),
    };
    upsert(item);
    log(KANO_ACTIONS.ITEM_ADDED, { title: item.title, category });
    setTitle("");
    setSatIfPresent("");
    setDissatIfAbsent("");
  }

  function remove(id: string) {
    removeOne(id);
    log(KANO_ACTIONS.ITEM_REMOVED, { id });
  }

  const grouped = useMemo(() => {
    const m: Record<Category, PrioritizationItem[]> = {
      "must-be": [],
      performance: [],
      attractive: [],
      indifferent: [],
      reverse: [],
    };
    const known = new Set<Category>([
      "must-be",
      "performance",
      "attractive",
      "indifferent",
      "reverse",
    ]);
    const isCategory = (v: unknown): v is Category =>
      typeof v === "string" && known.has(v as Category);
    for (const it of items) {
      // Defensive lookup: an unknown persisted category (e.g. renamed enum
      // from an older build) would otherwise resolve to `m[unknown]` =
      // undefined and crash with "Cannot read property 'push' of undefined".
      const raw = it.fields?.category;
      const c: Category = isCategory(raw) ? raw : "performance";
      m[c].push(it);
    }
    return m;
  }, [items]);

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
        prioritizations: s.prioritizations,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Kano Model",
      prompts: generateKanoPrompts({ grouped }, workspace),
    }),
    [grouped, workspace]
  );

  const csvData = {
    headers: ["Category", "Title", "Sat-if-present", "Dissat-if-absent"],
    rows: items.map((it) => [
      String(it.fields?.category ?? ""),
      it.title,
      it.fields?.satIfPresent ?? "",
      it.fields?.dissatIfAbsent ?? "",
    ]),
  };

  return (
    <ToolPageWrapper
      toolId="kano-model"
      title="Kano Model Builder"
      description="Classify features as Must-Be / Performance / Attractive / Indifferent / Reverse based on satisfaction-when-present and dissatisfaction-when-absent."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Classify feature" icon={Plus}>
          <Input
            placeholder="Feature title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
            <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label} — {c.hint}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              min="0"
              max="5"
              placeholder="Sat if present (0-5)"
              value={satIfPresent}
              onChange={(e) => setSatIfPresent(e.target.value)}
            />
            <Input
              type="number"
              min="0"
              max="5"
              placeholder="Dissat if absent (0-5)"
              value={dissatIfAbsent}
              onChange={(e) => setDissatIfAbsent(e.target.value)}
            />
          </div>
          <Button onClick={add} className="mt-3 gap-1">
            <Plus className="w-4 h-4" />
            Add
          </Button>
        </SectionCard>

        <SectionCard
          title={`Categories (${items.length} features)`}
          icon={Heart}
          actions={
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="kano-model"
                csvData={csvData}
                jsonData={items}
                targetRef={exportRef}
              />
            </>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {CATEGORIES.map((c) => (
              <div key={c.id} className="border border-border rounded p-3 bg-surface-deep min-w-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold uppercase" style={{ color: c.color }}>
                    {c.label}
                  </span>
                  <span className="text-xs text-sub">{grouped[c.id].length}</span>
                </div>
                <p className="text-xs text-sub italic mb-2">{c.hint}</p>
                <ul className="space-y-1 text-sm">
                  {grouped[c.id].map((it) => (
                    <li key={it.id} className="flex items-center gap-2">
                      <span className="flex-1 truncate text-text">{it.title}</span>
                      <button
                        onClick={() => remove(it.id)}
                        aria-label="Remove feature"
                        className="min-touch-coarse inline-flex items-center justify-center text-sub hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
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
