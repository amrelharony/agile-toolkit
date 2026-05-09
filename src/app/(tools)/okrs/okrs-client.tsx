"use client";

import { useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { WorkspaceSyncButton } from "@/components/shared/workspace-sync-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Flag, Plus, Trash2, Target } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Okr, KeyResult } from "@/lib/stores/workspace-types";
// `forecastLinear` was used to fit a regression of KR-progress against
// KR-index. That has no temporal meaning — KR ordering inside an objective is
// editorial, not chronological — so the resulting "forecast" was misleading.
// Removed until we have actual historical snapshots to fit against.
import { generateOkrsPrompts } from "@/lib/ai-prompts/okrs";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { OKR_ACTIONS } from "@/lib/history/event-actions";
import { ActionRow } from "@/components/shared/action-row";
import { EmptyState } from "@/components/shared/empty-state";
import { usePersisted } from "@/lib/utils/use-persisted";

/**
 * Numeric input with a string draft buffer so typing a multi-digit value
 * doesn't snap mid-edit (e.g. typing "1500" wouldn't briefly show "1" → "15"
 * → "150" coerced through Number()). Commits on blur or Enter.
 */
function NumCell({
  value,
  onChange,
  min,
  max,
  className,
  placeholder,
  title,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  className?: string;
  placeholder?: string;
  title?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n)) {
      const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));
      onChange(clamped);
      setDraft(String(clamped));
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
      placeholder={placeholder}
      title={title}
    />
  );
}

function emptyKr(): KeyResult {
  return { id: nanoid(6), title: "", target: 100, current: 0, confidence: 5 };
}

function emptyOkr(): Okr {
  return {
    id: nanoid(8),
    objective: "",
    keyResults: [emptyKr()],
    quarter: currentQuarter(),
  };
}

function currentQuarter(): string {
  const now = new Date();
  return `${now.getFullYear()} Q${Math.floor(now.getMonth() / 3) + 1}`;
}

function krProgress(kr: KeyResult): number {
  if (kr.target === 0) return 0;
  return Math.max(0, Math.min(1, kr.current / kr.target));
}

function objectiveHealth(okr: Okr): number {
  if (okr.keyResults.length === 0) return 0;
  return okr.keyResults.reduce((a, kr) => a + krProgress(kr), 0) / okr.keyResults.length;
}

export function OkrsClient() {
  const [okrs, setOkrs] = usePersisted<Okr[]>("agile-toolkit:okrs", []);
  const workspaceOkrs = useWorkspaceStore((s) => s.okrs);
  const upsertOkr = useWorkspaceStore((s) => s.upsertOkr);
  const { log } = useHistoryLogger("okrs");

  useEffect(() => {
    useWorkspaceStore.persist.rehydrate();
  }, []);

  const add = () => {
    const obj = emptyOkr();
    setOkrs((s) => [...s, obj]);
    log(OKR_ACTIONS.OBJECTIVE_ADDED, { okrId: obj.id });
  };
  const remove = (id: string) => {
    const obj = okrs.find((o) => o.id === id);
    setOkrs((s) => s.filter((o) => o.id !== id));
    log(OKR_ACTIONS.OBJECTIVE_REMOVED, { okrId: id, objective: obj?.objective });
  };
  const update = (id: string, patch: Partial<Okr>) =>
    setOkrs((s) => s.map((o) => (o.id === id ? { ...o, ...patch } : o)));

  const addKr = (okrId: string) => {
    const kr = emptyKr();
    setOkrs((s) => s.map((o) => (o.id === okrId ? { ...o, keyResults: [...o.keyResults, kr] } : o)));
    log(OKR_ACTIONS.KEY_RESULT_ADDED, { okrId, krId: kr.id });
  };
  const updateKr = (okrId: string, krId: string, patch: Partial<KeyResult>) => {
    setOkrs((s) =>
      s.map((o) =>
        o.id === okrId ? { ...o, keyResults: o.keyResults.map((k) => (k.id === krId ? { ...k, ...patch } : k)) } : o
      )
    );
    if (patch.current !== undefined || patch.target !== undefined) {
      log(OKR_ACTIONS.PROGRESS_UPDATED, { okrId, krId, ...patch });
    }
  };
  const removeKr = (okrId: string, krId: string) => {
    setOkrs((s) =>
      s.map((o) => (o.id === okrId ? { ...o, keyResults: o.keyResults.filter((k) => k.id !== krId) } : o))
    );
    log(OKR_ACTIONS.KEY_RESULT_REMOVED, { okrId, krId });
  };

  const handleImport = () => {
    const fresh = workspaceOkrs.filter((w) => !okrs.find((o) => o.id === w.id));
    if (fresh.length === 0) return 0;
    setOkrs((s) => [...fresh, ...s]);
    return fresh.length;
  };

  const handlePush = () => {
    let n = 0;
    for (const o of okrs) {
      if (o.objective.trim()) {
        upsertOkr(o);
        n++;
      }
    }
    return n;
  };

  const promptConfig = useMemo(
    () => ({
      toolName: "OKR Tracker",
      prompts: generateOkrsPrompts({ okrs }),
    }),
    [okrs]
  );

  return (
    <ToolPageWrapper
      toolId="okrs"
      title="OKR Tracker"
      description="Track quarterly Objectives and Key Results with confidence scores and trajectory forecasts."
      category="Outcomes & Pulse"
    >
      <ActionRow>
        <WorkspaceSyncButton toolName="OKR Tracker" onImport={handleImport} onPush={handlePush} />
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="okrs"
          csvData={{
            headers: ["Quarter", "Objective", "Objective Description", "KR", "KR Description", "Current", "Target", "Progress %", "Confidence"],
            rows: okrs.flatMap((o) =>
              o.keyResults.map((kr) => [
                o.quarter,
                o.objective,
                o.description ?? "",
                kr.title,
                kr.description ?? "",
                kr.current,
                kr.target,
                Math.round(krProgress(kr) * 100),
                kr.confidence ?? "",
              ])
            ),
          }}
          jsonData={okrs}
        />
        <Button onClick={add} className="gap-2 bg-accent text-bg hover:bg-accent/90">
          <Plus className="w-4 h-4" />
          New Objective
        </Button>
      </ActionRow>

      <div className="space-y-4">
        {okrs.length === 0 && (
          <EmptyState icon={Flag}>
            No objectives yet. Click &ldquo;New Objective&rdquo; to start.
          </EmptyState>
        )}
        {okrs.map((o) => {
          const health = objectiveHealth(o);
          return (
            <Card key={o.id} className="bg-surface border-border">
              <CardHeader className="pb-3">
                <div className="flex items-start gap-3">
                  <Target className="w-5 h-5 text-accent mt-0.5 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_140px] gap-2">
                      <Input
                        value={o.objective}
                        onChange={(e) => update(o.id, { objective: e.target.value })}
                        placeholder="Achieve X by end of quarter"
                        className="bg-bg border-border text-text"
                      />
                      <Input
                        value={o.quarter}
                        onChange={(e) => update(o.id, { quarter: e.target.value })}
                        placeholder="2026 Q2"
                        className="bg-bg border-border text-text font-data"
                      />
                    </div>
                    <Textarea
                      value={o.description ?? ""}
                      onChange={(e) => update(o.id, { description: e.target.value.trim() ? e.target.value : undefined })}
                      placeholder="Description (optional)..."
                      rows={2}
                      className="bg-bg border-border resize-none text-xs"
                      aria-label="Objective description"
                    />
                    <div className="flex items-center gap-3">
                      <Progress value={health * 100} className="h-2 flex-1" />
                      <Badge variant="outline" className="font-data">
                        {Math.round(health * 100)}%
                      </Badge>
                      {/* Forecast badge removed: regressing KR-progress
                          against KR-index produced a "forecast" with no
                          temporal grounding. Will reintroduce once we capture
                          historical OKR snapshots over time. */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(o.id)}
                        className="text-sub hover:text-danger"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {o.keyResults.map((kr) => (
                  <div
                    key={kr.id}
                    className="space-y-2 rounded-md border border-border bg-bg p-2"
                  >
                    <div className="grid grid-cols-[1fr_80px_80px_80px_32px] gap-2 items-center">
                      <Input
                        value={kr.title}
                        onChange={(e) => updateKr(o.id, kr.id, { title: e.target.value })}
                        placeholder="KR: Increase DAU from 1k to 10k"
                        className="bg-surface border-border"
                      />
                      <NumCell
                        value={kr.current}
                        onChange={(n) => updateKr(o.id, kr.id, { current: n })}
                        placeholder="Current"
                        className="bg-surface border-border font-data"
                      />
                      <NumCell
                        value={kr.target}
                        onChange={(n) => updateKr(o.id, kr.id, { target: n })}
                        placeholder="Target"
                        className="bg-surface border-border font-data"
                      />
                      <NumCell
                        value={kr.confidence ?? 5}
                        onChange={(n) => updateKr(o.id, kr.id, { confidence: n })}
                        min={0}
                        max={10}
                        title="Confidence (0-10)"
                        className="bg-surface border-border font-data"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeKr(o.id, kr.id)}
                        className="text-sub hover:text-danger"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <Textarea
                      value={kr.description ?? ""}
                      onChange={(e) => updateKr(o.id, kr.id, { description: e.target.value.trim() ? e.target.value : undefined })}
                      placeholder="Description (optional)..."
                      rows={2}
                      className="bg-surface border-border resize-none text-xs"
                      aria-label="Key result description"
                    />
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => addKr(o.id)}
                  className="gap-2 border-border text-sub hover:text-accent hover:border-accent/30"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Key Result
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </ToolPageWrapper>
  );
}
