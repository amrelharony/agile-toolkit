"use client";

import { useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Waves, Plus, Trash2 } from "lucide-react";
import { iqrOutliers } from "@/lib/analytics/anomaly";
import { generateValueStreamPrompts } from "@/lib/ai-prompts/value-stream";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { VALUE_STREAM_ACTIONS } from "@/lib/history/event-actions";
import { selectEvents } from "@/lib/history/selectors";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { EmptyState } from "@/components/shared/empty-state";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { ragTone } from "@/lib/utils/rag-tone";

interface Stage {
  id: string;
  name: string;
  description?: string;
  processTime: number;
  leadTime: number;
  completeAccurate: number;
}

/**
 * Numeric input that doesn't snap mid-edit. Holds a string draft so empty /
 * partial values stay editable; commits on blur. Guards against NaN with
 * Number.isFinite and clamps into [min, max].
 */
function NumCell({
  value,
  onCommit,
  min = 0,
  max,
  className,
}: {
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  max?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n)) {
      onCommit(Math.max(min, Math.min(max ?? Infinity, n)));
    } else {
      setDraft(String(value));
    }
  };
  return (
    <Input
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={className}
    />
  );
}

export function ValueStreamClient() {
  const [stages, setStages] = usePersisted<Stage[]>("agile-toolkit:value-stream", []);
  const { log } = useHistoryLogger("value-stream");

  const add = () => {
    // Pick the first unused integer suffix so deleting "Stage 2" then adding
    // a new one won't produce a duplicate "Stage 4" (or a third "Stage 4").
    const used = new Set(
      stages
        .map((s) => parseInt(String(s.name).replace(/\D/g, ""), 10))
        .filter(Number.isFinite)
    );
    let n = 1;
    while (used.has(n)) n++;
    const newStage = {
      id: nanoid(6),
      name: `Stage ${n}`,
      processTime: 1,
      leadTime: 2,
      completeAccurate: 90,
    };
    setStages((s) => [...s, newStage]);
    log(VALUE_STREAM_ACTIONS.STAGE_ADDED, { stageId: newStage.id, name: newStage.name });
  };
  const update = (id: string, patch: Partial<Stage>) => setStages((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const remove = (id: string) => {
    const stage = stages.find((x) => x.id === id);
    setStages((s) => s.filter((x) => x.id !== id));
    log(VALUE_STREAM_ACTIONS.STAGE_REMOVED, { stageId: id, name: stage?.name });
  };

  const totals = useMemo(() => {
    const totalProcess = stages.reduce((a, b) => a + Math.max(0, b.processTime), 0);
    const totalLead = stages.reduce((a, b) => a + Math.max(0, b.leadTime), 0);
    // Cap at 100% — process > lead is logically impossible but corrupted
    // input would otherwise display nonsense like "183% efficient".
    const flowEfficiency =
      totalLead > 0 ? Math.min(100, (totalProcess / totalLead) * 100) : 0;
    const rolledCA = stages.length > 0
      ? stages.reduce(
          (acc, s) => acc * (Math.min(100, Math.max(0, s.completeAccurate)) / 100),
          1
        ) * 100
      : 0;
    return { totalProcess, totalLead, flowEfficiency, rolledCA };
  }, [stages]);

  // Outlier stages by IQR on lead time. The anomaly utility returns matching
  // *values* (which can collide when two stages share a lead time), so we
  // map back to indices ourselves and walk each value once — that way each
  // index is associated with exactly one stage.
  const leadOutlierStageIds = useMemo(() => {
    const series = stages.map((s) => s.leadTime);
    const { outliers } = iqrOutliers(series);
    if (outliers.length === 0) return new Set<string>();
    const remaining = outliers.slice();
    const ids = new Set<string>();
    for (let i = 0; i < series.length; i++) {
      const pos = remaining.indexOf(series[i]);
      if (pos !== -1) {
        ids.add(stages[i].id);
        remaining.splice(pos, 1);
      }
    }
    return ids;
  }, [stages]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Value Stream Map",
      prompts: generateValueStreamPrompts({ stages, ...totals }),
    }),
    [stages, totals]
  );

  // ── Cross-tool signal: recent kanban card moves (proxy for story status
  // changes). Surfaces a small chip when stories have moved through stages
  // recently — reminds the user that lead-time/flow-efficiency may be stale
  // if the value-stream model wasn't updated since.
  const recentStoryMoves = useMemo(
    () =>
      selectEvents({
        toolId: "kanban",
        action: "card_moved",
        sinceDays: 7,
        limit: 50,
      }),
    // history-store mutations cause parent re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <ToolPageWrapper
      toolId="value-stream"
      title="Value Stream Map"
      description="Map your process stages with lead time, process time, and %C/A. Auto-computes flow efficiency."
      category="Flow & Delivery"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="value-stream"
          csvData={{
            headers: ["Stage", "Description", "Process Time", "Lead Time", "%C/A"],
            rows: stages.map((s) => [
              s.name,
              s.description ?? "",
              s.processTime,
              s.leadTime,
              s.completeAccurate,
            ]),
          }}
          jsonData={stages}
        />
        <Button onClick={add} className="gap-2 bg-accent text-bg hover:bg-accent/90">
          <Plus className="w-4 h-4" />
          Add Stage
        </Button>
      </ActionRow>

      {recentStoryMoves.length > 0 && (
        <div className="mb-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/5 text-accent px-2.5 py-1 text-[11px]">
            {recentStoryMoves.length} stor{recentStoryMoves.length === 1 ? "y" : "ies"} changed status in last 7 days
          </span>
        </div>
      )}

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          label="Lead Time"
          value={`${totals.totalLead.toFixed(1)}d`}
        />
        <StatCard
          variant="compact"
          label="Process Time"
          value={`${totals.totalProcess.toFixed(1)}d`}
        />
        <StatCard
          variant="compact"
          label="Flow Efficiency"
          value={`${totals.flowEfficiency.toFixed(0)}%`}
          valueClassName={ragTone(totals.flowEfficiency, { good: 40, warn: 15 })}
        />
        <StatCard
          variant="compact"
          label="Rolled %C/A"
          value={`${totals.rolledCA.toFixed(0)}%`}
          valueClassName={ragTone(totals.rolledCA, { good: 80, warn: 60 })}
        />
      </KpiGrid>

      {leadOutlierStageIds.size > 0 && (
        <CalloutAlert tone="warning" className="mb-4">
          <strong>Stage(s) with outlier lead time (IQR):</strong>{" "}
          {stages
            .filter((s) => leadOutlierStageIds.has(s.id))
            .map((s) => `${s.name} (${s.leadTime}d)`)
            .join(", ")}
        </CalloutAlert>
      )}

      <div className="flex gap-2 items-stretch overflow-x-auto pb-4">
        {stages.map((s, i) => (
          <div key={s.id} className="shrink-0 w-56 space-y-2">
            <Card className="bg-surface border-border">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Waves className="w-4 h-4 text-accent" />
                  <Button variant="ghost" size="sm" onClick={() => remove(s.id)} className="h-6 text-sub hover:text-danger">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <Input
                  value={s.name}
                  onChange={(e) => update(s.id, { name: e.target.value })}
                  className="bg-bg border-border text-sm h-8"
                />
                {/* Optional description for this stage; empty trims to undefined. */}
                <Textarea
                  value={s.description ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    update(s.id, { description: v.trim() ? v : undefined });
                  }}
                  placeholder="Description (optional)..."
                  rows={2}
                  className="bg-bg border-border resize-none text-xs"
                  aria-label={`Description for stage ${s.name}`}
                />
                <div>
                  <div className="text-[10px] uppercase text-sub">Process Time (d)</div>
                  <NumCell
                    value={s.processTime}
                    onCommit={(n) => update(s.id, { processTime: n })}
                    min={0}
                    className="bg-bg border-border font-data h-8"
                  />
                </div>
                <div>
                  <div className="text-[10px] uppercase text-sub">Lead Time (d)</div>
                  <NumCell
                    value={s.leadTime}
                    onCommit={(n) => update(s.id, { leadTime: n })}
                    min={0}
                    className="bg-bg border-border font-data h-8"
                  />
                </div>
                <div>
                  <div className="text-[10px] uppercase text-sub">%C/A</div>
                  <NumCell
                    value={s.completeAccurate}
                    onCommit={(n) => update(s.id, { completeAccurate: n })}
                    min={0}
                    max={100}
                    className="bg-bg border-border font-data h-8"
                  />
                </div>
                <div className="pt-1 text-[10px] text-sub">
                  {s.leadTime > 0 && (
                    <span>Wait: {Math.max(0, s.leadTime - s.processTime).toFixed(1)}d</span>
                  )}
                  {/* Inline data-quality warning when process time exceeds
                      lead time — that's logically impossible (process is a
                      subset of lead) and usually indicates bad input. */}
                  {s.processTime > s.leadTime && (
                    <span className="ml-2 text-[#ffaa00]">
                      ⚠ process &gt; lead
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
            {i < stages.length - 1 && <div className="text-center text-accent">→</div>}
          </div>
        ))}
        {stages.length === 0 && (
          <EmptyState className="flex-1">
            No stages yet. Click &ldquo;Add Stage&rdquo; to map the value stream.
          </EmptyState>
        )}
      </div>
    </ToolPageWrapper>
  );
}
