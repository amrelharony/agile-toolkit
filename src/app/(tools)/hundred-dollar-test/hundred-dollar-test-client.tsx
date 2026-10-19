"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Vote, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem, Workspace } from "@/lib/stores/workspace-types";
import { generateHundredDollarPrompts } from "@/lib/ai-prompts/hundred-dollar-test";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { HUNDRED_DOLLAR_ACTIONS } from "@/lib/history/event-actions";

export function HundredDollarTestClient() {
  const all = useWorkspaceStore((s) => s.prioritizations ?? []);
  const items = useMemo(() => all.filter((x) => x.framework === "hundred-dollar"), [all]);
  const upsert = useWorkspaceStore((s) => s.upsertPrioritization);
  const removeOne = useWorkspaceStore((s) => s.removePrioritization);
  const { log } = useHistoryLogger("hundred-dollar-test");
  const exportRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState("");

  function add() {
    if (!title.trim()) return;
    const item: PrioritizationItem = {
      id: crypto.randomUUID(),
      framework: "hundred-dollar",
      title: title.trim(),
      score: 0,
      fields: { allocation: 0 },
      status: "open",
      updatedAt: new Date().toISOString(),
    };
    upsert(item);
    log(HUNDRED_DOLLAR_ACTIONS.ITEM_ADDED, { title });
    setTitle("");
  }

  function setAlloc(it: PrioritizationItem, n: number) {
    // Clamp per-item to [0, 100]: negative values invert the bar fill,
    // values >100 on a single line item make no sense — both silently
    // capped. NaN from `parseFloat("abc")` also coerces to 0.
    // R11-fix: ALSO enforce the aggregate $100 budget. The tool's core
    // premise is "you have $100, allocate it" — without this guard,
    // users could set every item to 100 and "spend" $1000 across N
    // items, completely breaking the forced-tradeoff mechanic. We
    // compute the headroom from OTHER items' allocations and cap the
    // new value at that headroom.
    const requested = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
    const otherTotal = items.reduce((s, x) => {
      if (x.id === it.id) return s;
      return s + (Number(x.fields?.allocation) || 0);
    }, 0);
    const headroom = Math.max(0, 100 - otherTotal);
    const safe = Math.min(requested, headroom);
    upsert({
      ...it,
      score: safe,
      fields: { ...(it.fields ?? {}), allocation: safe },
      updatedAt: new Date().toISOString(),
    });
    log(HUNDRED_DOLLAR_ACTIONS.ALLOCATION_CHANGED, { id: it.id, n: safe });
  }

  // BUG-T3-hundred-dollar-test-2: round to cents to avoid float drift like
  // `0.0000001` showing up in the "Remaining" KPI after many small writes.
  const totalAllocatedRaw = items.reduce((s, x) => s + (Number(x.fields?.allocation) || 0), 0);
  const totalAllocated = Math.round(totalAllocatedRaw * 100) / 100;
  const remaining = Math.round((100 - totalAllocated) * 100) / 100;
  // Treat sub-cent drift as fully allocated for tone decisions.
  const fullyAllocated = Math.abs(remaining) < 0.005;
  const sorted = [...items].sort(
    (a, b) => (Number(b.fields?.allocation) || 0) - (Number(a.fields?.allocation) || 0)
  );

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
      toolName: "$100 Test",
      prompts: generateHundredDollarPrompts({ items: sorted }, workspace),
    }),
    [sorted, workspace]
  );

  const csvData = {
    headers: ["Title", "Allocation"],
    rows: items.map((it) => [it.title, Number(it.fields?.allocation) || 0]),
  };

  return (
    <ToolPageWrapper
      toolId="hundred-dollar-test"
      title="$100 Test"
      description="Each participant allocates $100 across competing items. Forces hard tradeoffs and surfaces real preferences."
    >
      <div ref={exportRef} className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <KPI label="Items" value={String(items.length)} />
          <KPI label="Allocated" value={`$${totalAllocated.toFixed(2)}`} />
          <KPI
            label="Remaining"
            value={`$${remaining.toFixed(2)}`}
            tone={remaining < -0.005 ? "danger" : fullyAllocated ? "ok" : "default"}
          />
        </div>
        {/* BUG-T3-hundred-dollar-test-1: surface a "distribute fully"
            cue. The tool's invariant is sum=100 (modulo cents); without
            this banner the user can export with $20 still unallocated
            and not realise. */}
        {items.length > 0 && !fullyAllocated && (
          <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            {remaining > 0
              ? `Allocate the remaining $${remaining.toFixed(2)} to finalise — the $100 test only works when the budget is fully distributed.`
              : `You’re over budget by $${Math.abs(remaining).toFixed(2)}. Reduce allocations to bring the total to $100.`}
          </div>
        )}

        <SectionCard title="Add item" icon={Plus}>
          <div className="flex gap-2">
            <Input
              placeholder="Item to vote on"
              aria-label="Item to vote on"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Button onClick={add} className="gap-1">
              <Plus className="w-4 h-4" />
              Add
            </Button>
          </div>
        </SectionCard>

        {items.length > 0 && (
          <SectionCard
            title="Allocations"
            icon={Vote}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="100-dollar-test"
                  csvData={csvData}
                  jsonData={items}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <ul className="space-y-2">
              {sorted.map((it) => {
                const a = Number(it.fields?.allocation) || 0;
                return (
                  <li
                    key={it.id}
                    className="flex items-center gap-3 border border-border bg-surface-deep rounded p-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-text truncate">{it.title}</div>
                      <div className="w-full bg-surface h-1.5 rounded mt-1 overflow-hidden">
                        <div
                          className="h-1.5 bg-cyan-400"
                          style={{ width: `${Math.min(100, a)}%` }}
                        />
                      </div>
                    </div>
                    <Input
                      type="number"
                      value={a}
                      onChange={(e) => setAlloc(it, parseFloat(e.target.value) || 0)}
                      aria-label={`Dollars allocated to ${it.title}`}
                      className="h-8 w-20 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        removeOne(it.id);
                        log(HUNDRED_DOLLAR_ACTIONS.ITEM_REMOVED, { id: it.id });
                      }}
                      aria-label={`Remove ${it.title}`}
                      className="min-touch-coarse inline-flex items-center justify-center text-sub hover:text-danger"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}

function KPI({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "ok" | "danger";
}) {
  const colorClass =
    tone === "danger" ? "text-danger" : tone === "ok" ? "text-success" : "text-text";
  return (
    <div className="rounded-md border border-border bg-surface-deep p-3">
      <div className="text-xs text-sub uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-semibold mt-1 font-data ${colorClass}`}>{value}</div>
    </div>
  );
}
