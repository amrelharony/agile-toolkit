"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import dynamic from "next/dynamic";
import { Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem, Workspace } from "@/lib/stores/workspace-types";
import { wsjfScore, rank } from "@/lib/analytics/scoring-rubric";
import { generateWsjfPrompts } from "@/lib/ai-prompts/wsjf";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { WSJF_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";
import { undoable } from "@/lib/utils/undoable";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { buildExample } from "./example";
import { toMarkdown } from "./markdown";

// Recharts loads with the chart, not the page; the placeholder fills the
// chart's fixed-height box while it does.
const WsjfScoreChart = dynamic(() => import("./charts").then((m) => m.WsjfScoreChart), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function WsjfClient() {
  const all = useWorkspaceStore((s) => s.prioritizations ?? []);
  const items = useMemo(() => all.filter((x) => x.framework === "wsjf"), [all]);
  const upsert = useWorkspaceStore((s) => s.upsertPrioritization);
  const removeOne = useWorkspaceStore((s) => s.removePrioritization);
  const { log } = useHistoryLogger("wsjf");
  const exportRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState("");
  const [bv, setBv] = useState("");
  const [tc, setTc] = useState("");
  const [rrOe, setRrOe] = useState("");
  const [size, setSize] = useState("");

  function add() {
    if (!title.trim()) return;
    const fn = (s: string, fb: number) => {
      const v = parseFloat(s);
      return Number.isFinite(v) ? v : fb;
    };
    const businessValue = fn(bv, 0);
    const timeCriticality = fn(tc, 0);
    const rrOeVal = fn(rrOe, 0);
    // R5: a user-typed `0` was previously accepted as jobSize → div/0
    // in wsjfScore produced Infinity → that feature dominated the rank
    // chart. Floor jobSize at 0.5 even when the user explicitly typed 0.
    const jobSize = Math.max(0.5, fn(size, 1));
    const score = wsjfScore(businessValue, timeCriticality, rrOeVal, jobSize);
    const item: PrioritizationItem = {
      id: crypto.randomUUID(),
      framework: "wsjf",
      title: title.trim().slice(0, 200),
      score,
      fields: { businessValue, timeCriticality, rrOe: rrOeVal, jobSize },
      status: "scored",
      updatedAt: new Date().toISOString(),
    };
    upsert(item);
    log(WSJF_ACTIONS.ITEM_ADDED, { title: item.title, score });
    emitSignal({
      kind: "prioritization.scored",
      at: item.updatedAt,
      toolId: "wsjf",
      payload: { framework: "wsjf", id: item.id, score },
    });
    setTitle("");
    setBv("");
    setTc("");
    setRrOe("");
    setSize("");
  }

  // The table is ranked by score, so the restored item finds its own place.
  function remove(id: string) {
    const item = items.find((x) => x.id === id);
    if (!item) return;
    undoable({
      label: `Deleted “${shortName(item.title)}”`,
      apply: () => {
        removeOne(id);
        log(WSJF_ACTIONS.ITEM_REMOVED, { id });
      },
      revert: () => {
        const back = (useWorkspaceStore.getState().prioritizations ?? []).some((x) => x.id === id);
        if (!back) upsert(item);
      },
    });
  }

  // Example rows are written like any other item but never logged or
  // signalled: loading an example isn't the user's own scoring work.
  function loadExample() {
    for (const item of buildExample()) upsert(item);
  }

  function clearExample() {
    for (const x of items) if (isExampleId(x.id)) removeOne(x.id);
  }

  const ranked = useMemo(
    () =>
      rank(
        items.map((x) => ({
          id: x.id,
          title: x.title,
          fields: x.fields ?? {},
          score: x.score ?? 0,
        }))
      ),
    [items]
  );

  // R10: prefix with rank so two features with the same (or same-truncated)
  // title don't collapse into one bar — Recharts uses dataKey="title" as
  // YAxis category and duplicate categories silently merge, hiding scores.
  //
  // Truncate the title BEFORE prefixing so the rank stays inside the 80px
  // YAxis margin even at rank ≥ 10 (where the prefix is "#10 " = 4 chars).
  // Total label width stays ≤ 18 chars.
  const chartData = ranked.slice(0, 10).map((r) => {
    const t = r.title.length > 14 ? r.title.slice(0, 14) + "…" : r.title;
    return { title: `#${r.rank} ${t}`, score: Number(r.score.toFixed(2)) };
  });

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
      toolName: "WSJF Calculator",
      prompts: generateWsjfPrompts({ items: ranked }, workspace),
    }),
    [ranked, workspace]
  );

  const markdown = useMemo(() => toMarkdown(items), [items]);

  const csvData = {
    headers: ["Rank", "Title", "BV", "TC", "RR/OE", "Size", "WSJF"],
    rows: ranked.map((r) => [
      r.rank,
      r.title,
      r.fields.businessValue ?? "",
      r.fields.timeCriticality ?? "",
      r.fields.rrOe ?? "",
      r.fields.jobSize ?? "",
      r.score.toFixed(2),
    ]),
  };

  return (
    <ToolPageWrapper
      toolId="wsjf"
      title="WSJF Calculator"
      description="Weighted Shortest Job First: (Business Value + Time Criticality + Risk Reduction/Opportunity Enablement) ÷ Job Size."
    >
      {hasExampleItems(items) && <ExampleNotice onClear={clearExample} />}
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Add feature" icon={Plus}>
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
            <Input
              className="sm:col-span-2"
              placeholder="Feature title"
              aria-label="Feature title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Business Value"
              aria-label="Business Value"
              value={bv}
              onChange={(e) => setBv(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Time Criticality"
              aria-label="Time Criticality"
              value={tc}
              onChange={(e) => setTc(e.target.value)}
            />
            <Input
              type="number"
              placeholder="RR/OE"
              aria-label="Risk Reduction / Opportunity Enablement (RR/OE)"
              value={rrOe}
              onChange={(e) => setRrOe(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Job Size"
              aria-label="Job Size"
              value={size}
              onChange={(e) => setSize(e.target.value)}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={add} className="gap-1">
              <Plus className="w-4 h-4" />
              Add & score
            </Button>
            {items.length === 0 && <LoadExampleButton onLoad={loadExample} />}
          </div>
        </SectionCard>

        {chartData.length > 0 && (
          <SectionCard
            title="Top 10 by WSJF"
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="wsjf-scores"
                  csvData={csvData}
                  jsonData={ranked}
                  markdown={markdown}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <div className="-mx-2 h-72">
              <WsjfScoreChart data={chartData} />
            </div>
          </SectionCard>
        )}

        {ranked.length > 0 && (
          <SectionCard title="Features (sorted by WSJF)">
            <div className="table-wrap-responsive">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-sub uppercase">
                    <th className="p-2">#</th>
                    <th className="p-2">Title</th>
                    <th className="p-2 text-right">BV</th>
                    <th className="p-2 text-right">TC</th>
                    <th className="p-2 text-right">RR/OE</th>
                    <th className="p-2 text-right">Size</th>
                    <th className="p-2 text-right">WSJF</th>
                    <th className="p-2 w-10">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="p-2 font-mono text-xs">{r.rank}</td>
                      <td className="p-2">{r.title}</td>
                      <td className="p-2 text-right font-mono text-xs">{r.fields.businessValue}</td>
                      <td className="p-2 text-right font-mono text-xs">
                        {r.fields.timeCriticality}
                      </td>
                      <td className="p-2 text-right font-mono text-xs">{r.fields.rrOe}</td>
                      <td className="p-2 text-right font-mono text-xs">{r.fields.jobSize}</td>
                      <td className="p-2 text-right font-mono">{r.score.toFixed(2)}</td>
                      <td className="p-2">
                        <button
                          type="button"
                          onClick={() => remove(r.id)}
                          aria-label={`Remove ${r.title}`}
                          className="min-touch-coarse inline-flex items-center justify-center text-sub hover:text-danger"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}
