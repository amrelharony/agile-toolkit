"use client";

import { useMemo } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Waves, Plus, Trash2 } from "lucide-react";
import { iqrOutliers } from "@/lib/analytics/anomaly";
import { generateValueStreamPrompts } from "@/lib/ai-prompts/value-stream";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { VALUE_STREAM_ACTIONS } from "@/lib/history/event-actions";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { EmptyState } from "@/components/shared/empty-state";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { ragTone } from "@/lib/utils/rag-tone";

interface Stage {
  id: string;
  name: string;
  processTime: number;
  leadTime: number;
  completeAccurate: number;
}

export function ValueStreamClient() {
  const [stages, setStages] = usePersisted<Stage[]>("agile-toolkit:value-stream", []);
  const { log } = useHistoryLogger("value-stream");

  const add = () => {
    const newStage = {
      id: nanoid(6),
      name: `Stage ${stages.length + 1}`,
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

  const leadOutliers = useMemo(() => {
    const { outliers } = iqrOutliers(stages.map((s) => s.leadTime));
    return outliers;
  }, [stages]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Value Stream Map",
      prompts: generateValueStreamPrompts({ stages, ...totals }),
    }),
    [stages, totals]
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
            headers: ["Stage", "Process Time", "Lead Time", "%C/A"],
            rows: stages.map((s) => [s.name, s.processTime, s.leadTime, s.completeAccurate]),
          }}
          jsonData={stages}
        />
        <Button onClick={add} className="gap-2 bg-accent text-bg hover:bg-accent/90">
          <Plus className="w-4 h-4" />
          Add Stage
        </Button>
      </ActionRow>

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

      {leadOutliers.length > 0 && (
        <CalloutAlert tone="warning" className="mb-4">
          <strong>Stage(s) with outlier lead time (IQR):</strong>{" "}
          {stages
            .filter((s) => leadOutliers.includes(s.leadTime))
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
                <div>
                  <div className="text-[10px] uppercase text-sub">Process Time (d)</div>
                  <Input
                    type="number"
                    min={0}
                    value={s.processTime}
                    onChange={(e) =>
                      update(s.id, { processTime: Math.max(0, Number(e.target.value)) })
                    }
                    className="bg-bg border-border font-data h-8"
                  />
                </div>
                <div>
                  <div className="text-[10px] uppercase text-sub">Lead Time (d)</div>
                  <Input
                    type="number"
                    min={0}
                    value={s.leadTime}
                    onChange={(e) =>
                      update(s.id, { leadTime: Math.max(0, Number(e.target.value)) })
                    }
                    className="bg-bg border-border font-data h-8"
                  />
                </div>
                <div>
                  <div className="text-[10px] uppercase text-sub">%C/A</div>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={s.completeAccurate}
                    onChange={(e) =>
                      update(s.id, {
                        completeAccurate: Math.min(100, Math.max(0, Number(e.target.value))),
                      })
                    }
                    className="bg-bg border-border font-data h-8"
                  />
                </div>
                <div className="pt-1 text-[10px] text-sub">
                  {s.leadTime > 0 && (
                    <span>Wait: {Math.max(0, s.leadTime - s.processTime).toFixed(1)}d</span>
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
