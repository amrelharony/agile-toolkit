"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import dynamic from "next/dynamic";
import { Grid3X3, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem, Workspace } from "@/lib/stores/workspace-types";
import { generateValueEffortPrompts } from "@/lib/ai-prompts/value-effort-matrix";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { VALUE_EFFORT_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";
import {
  BacklogRowLink,
  ImportFromBacklog,
  useBacklogImport,
} from "@/components/prioritization/backlog-link";
import { linkNewRow } from "@/lib/prioritization/backlog-links";

// Recharts loads with the chart, not the page; the placeholder fills the
// chart's fixed-height box while it does.
const ValueEffortScatterChart = dynamic(
  () => import("./charts").then((m) => m.ValueEffortScatterChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
    ),
  }
);

function quadrantOf(
  value: number,
  effort: number
): "Quick Wins" | "Big Bets" | "Fill-Ins" | "Time Wasters" {
  const hiV = value >= 5,
    hiE = effort >= 5;
  if (hiV && !hiE) return "Quick Wins";
  if (hiV && hiE) return "Big Bets";
  if (!hiV && !hiE) return "Fill-Ins";
  return "Time Wasters";
}
/** What's missing before an item can be plotted. */
function missingMessage(titleMissing: boolean, missingScores: readonly string[]): string {
  const parts = [...(titleMissing ? ["a title"] : []), ...missingScores];
  const joined =
    parts.length <= 1
      ? parts.join("")
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const range = missingScores.length > 0 ? " Value and Effort each run from 1 to 10." : "";
  return `Enter ${joined} to plot this item.${range}`;
}

const QUAD_COLORS: Record<string, string> = {
  "Quick Wins": "#00ff88",
  "Big Bets": "#00f0ff",
  "Fill-Ins": "#ffaa00",
  "Time Wasters": "#ff6b6b",
};

export function ValueEffortMatrixClient() {
  const all = useWorkspaceStore((s) => s.prioritizations ?? []);
  const items = useMemo(() => all.filter((x) => x.framework === "value-effort"), [all]);
  const upsert = useWorkspaceStore((s) => s.upsertPrioritization);
  const removeOne = useWorkspaceStore((s) => s.removePrioritization);
  const { log } = useHistoryLogger("value-effort-matrix");
  const exportRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [effort, setEffort] = useState("");

  // "Import from backlog" (or a "Score with Value/Effort" link) fills the
  // form; the next item plotted links to that backlog item.
  const backlog = useBacklogImport("value-effort", (picked, prefill) => {
    setTitle(picked.name);
    setValue(prefill.value === undefined ? "" : String(prefill.value));
    setEffort(prefill.effort === undefined ? "" : String(prefill.effort));
  });

  // An empty Value or Effort used to become 5 without a word — the exact
  // quadrant boundary — so an unscored item landed in Big Bets. Both are
  // required; after a failed Plot the empty fields are flagged and named.
  const errorId = useId();
  const [attempted, setAttempted] = useState(false);
  const titleMissing = !title.trim();
  const missingScores = (
    [
      ["Value", value],
      ["Effort", effort],
    ] as const
  )
    .filter(([, raw]) => !Number.isFinite(parseFloat(raw)))
    .map(([label]) => label);
  const showError = attempted && (titleMissing || missingScores.length > 0);
  const flag = (missing: boolean) =>
    showError && missing ? { "aria-invalid": true as const, "aria-describedby": errorId } : {};

  function add() {
    if (titleMissing || missingScores.length > 0) {
      setAttempted(true);
      return;
    }
    // Clamp into the documented 1-10 range so out-of-range typos can't drag
    // the ReferenceLine math off-axis.
    const clamp = (raw: string) => Math.min(10, Math.max(1, parseFloat(raw)));
    const v = clamp(value),
      e = clamp(effort);
    const item: PrioritizationItem = linkNewRow(
      {
        id: crypto.randomUUID(),
        framework: "value-effort",
        title: title.trim(),
        score: v - e,
        fields: { value: v, effort: e, quadrant: quadrantOf(v, e) },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
      backlog.pending?.id
    );
    upsert(item);
    backlog.clear();
    log(VALUE_EFFORT_ACTIONS.ITEM_ADDED, { title, quadrant: item.fields?.quadrant });
    emitSignal({
      kind: "prioritization.scored",
      at: item.updatedAt,
      toolId: "value-effort-matrix",
      payload: { framework: "value-effort", id: item.id, score: v - e },
    });
    setTitle("");
    setValue("");
    setEffort("");
    setAttempted(false);
  }

  // Memoize derived shapes — without this, both `scatterData` and `grouped`
  // are recomputed on every render, and any consumer that takes them in a
  // dep array (the AI promptConfig below) re-builds its payload every keystroke.
  const scatterData = useMemo(
    () =>
      items
        // BUG-RD3-value-effort-matrix-1: drop items whose effort / value
        // failed to parse rather than mapping them to the origin (0,0).
        // The prior `Number(...) || 0` collapsed every malformed import
        // to the same point as a legitimate zero, so the user couldn't
        // distinguish a real (0, 0) from a parse failure or schema
        // drift on an imported row.
        .map((it) => ({
          title: it.title,
          x: Number(it.fields?.effort),
          y: Number(it.fields?.value),
          quadrant: String(it.fields?.quadrant ?? ""),
        }))
        .filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y)),
    [items]
  );

  const grouped = useMemo(() => {
    const g: Record<string, PrioritizationItem[]> = {
      "Quick Wins": [],
      "Big Bets": [],
      "Fill-Ins": [],
      "Time Wasters": [],
    };
    for (const it of items) g[String(it.fields?.quadrant ?? "Fill-Ins")]?.push(it);
    return g;
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
      toolName: "Value vs Effort Matrix",
      prompts: generateValueEffortPrompts({ grouped }, workspace),
    }),
    [grouped, workspace]
  );

  const csvData = {
    headers: ["Title", "Value", "Effort", "Quadrant"],
    rows: items.map((it) => [
      it.title,
      it.fields?.value ?? "",
      it.fields?.effort ?? "",
      String(it.fields?.quadrant ?? ""),
    ]),
  };

  return (
    <ToolPageWrapper
      toolId="value-effort-matrix"
      title="Value vs Effort Matrix"
      description="Plot items into Quick Wins / Big Bets / Fill-Ins / Time Wasters quadrants based on value (1–10) and effort (1–10)."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="Add item" icon={Plus} actions={<ImportFromBacklog link={backlog} />}>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <Input
              className="sm:col-span-2"
              placeholder="Item title"
              aria-label="Item title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              {...flag(titleMissing)}
            />
            <Input
              type="number"
              min="1"
              max="10"
              placeholder="Value 1-10"
              aria-label="Value (1-10)"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              {...flag(missingScores.includes("Value"))}
            />
            <Input
              type="number"
              min="1"
              max="10"
              placeholder="Effort 1-10"
              aria-label="Effort (1-10)"
              value={effort}
              onChange={(e) => setEffort(e.target.value)}
              {...flag(missingScores.includes("Effort"))}
            />
          </div>
          {showError && (
            <p id={errorId} role="alert" className="mt-2 text-xs text-danger">
              {missingMessage(titleMissing, missingScores)}
            </p>
          )}
          <Button onClick={add} className="mt-3 gap-1">
            <Plus className="w-4 h-4" />
            Plot
          </Button>
        </SectionCard>

        {scatterData.length > 0 && (
          <SectionCard
            title="Matrix"
            icon={Grid3X3}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="value-effort"
                  csvData={csvData}
                  jsonData={items}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <div className="-mx-2 h-80">
              <ValueEffortScatterChart data={scatterData} />
            </div>
          </SectionCard>
        )}

        {items.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.entries(grouped).map(([q, list]) => (
              <div key={q} className="border border-border rounded p-3 bg-surface-deep min-w-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold uppercase" style={{ color: QUAD_COLORS[q] }}>
                    {q}
                  </span>
                  <span className="text-xs text-sub">{list.length}</span>
                </div>
                <ul className="space-y-1 text-sm">
                  {list.map((it) => (
                    <li key={it.id} className="flex justify-between items-center min-w-0">
                      <span className="text-text truncate flex-1 min-w-0">{it.title}</span>
                      <span className="text-xs text-sub mx-2 shrink-0">
                        v{it.fields?.value} e{it.fields?.effort}
                      </span>
                      <BacklogRowLink row={it} />
                      <button
                        onClick={() => {
                          removeOne(it.id);
                          log(VALUE_EFFORT_ACTIONS.ITEM_REMOVED, { id: it.id });
                        }}
                        aria-label={`Remove ${it.title}`}
                        className="min-touch-coarse inline-flex items-center justify-center text-sub hover:text-danger"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </ToolPageWrapper>
  );
}
