"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { WorkspaceSyncButton } from "@/components/shared/workspace-sync-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FileText, Plus, Trash2 } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Decision } from "@/lib/stores/workspace-types";
import { generateDecisionLogPrompts } from "@/lib/ai-prompts/decision-log";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { DECISION_ACTIONS } from "@/lib/history/event-actions";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { EmptyState } from "@/components/shared/empty-state";
import { usePersisted } from "@/lib/utils/use-persisted";
import { todayLocalISO } from "@/lib/utils/formatters";

const STATUSES: Decision["status"][] = ["proposed", "accepted", "deprecated", "superseded"];

function emptyDecision(): Decision {
  return {
    id: nanoid(8),
    title: "",
    context: "",
    decision: "",
    consequences: "",
    alternatives: [],
    status: "proposed",
    date: todayLocalISO(),
  };
}

export function DecisionLogClient() {
  const [decisions, setDecisions] = usePersisted<Decision[]>("agile-toolkit:decision-log", []);
  const [editing, setEditing] = useState<Decision | null>(null);
  const workspaceDecisions = useWorkspaceStore((s) => s.decisions);
  const upsertWorkspaceDecision = useWorkspaceStore((s) => s.upsertDecision);
  const tableRef = useRef<HTMLDivElement>(null);
  const { log } = useHistoryLogger("decision-log");

  useEffect(() => {
    useWorkspaceStore.persist.rehydrate();
  }, []);

  const addDecision = () => {
    const fresh = emptyDecision();
    setDecisions((d) => [fresh, ...d]);
    setEditing(fresh);
    log(DECISION_ACTIONS.DECISION_ADDED, { decisionId: fresh.id });
  };

  const updateDecision = (id: string, patch: Partial<Decision>) => {
    setDecisions((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    if (editing?.id === id) setEditing((prev) => (prev ? { ...prev, ...patch } : prev));
    if (patch.status) {
      const prev = decisions.find((x) => x.id === id);
      log(DECISION_ACTIONS.STATUS_CHANGED, {
        decisionId: id,
        title: prev?.title,
        from: prev?.status,
        to: patch.status,
      });
    }
  };

  const removeDecision = (id: string) => {
    const prev = decisions.find((x) => x.id === id);
    setDecisions((d) => d.filter((x) => x.id !== id));
    if (editing?.id === id) setEditing(null);
    log(DECISION_ACTIONS.DECISION_REMOVED, {
      decisionId: id,
      title: prev?.title,
    });
  };

  const counts = useMemo(() => {
    const c: Record<Decision["status"], number> = { proposed: 0, accepted: 0, deprecated: 0, superseded: 0 };
    decisions.forEach((d) => (c[d.status] += 1));
    return c;
  }, [decisions]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Decision Log",
      prompts: generateDecisionLogPrompts({ decisions }),
    }),
    [decisions]
  );

  const handleImport = () => {
    const next = workspaceDecisions.filter((w) => !decisions.find((d) => d.id === w.id));
    if (next.length === 0) return 0;
    setDecisions((d) => [...next, ...d]);
    return next.length;
  };

  const handlePush = () => {
    let n = 0;
    for (const d of decisions) {
      if (d.title.trim()) {
        upsertWorkspaceDecision(d);
        n++;
      }
    }
    return n;
  };

  return (
    <ToolPageWrapper
      toolId="decision-log"
      title="Decision Log (ADR)"
      description="Record architecture and product decisions so your team's reasoning outlives any single person."
      category="Risk & Governance"
    >
      <ActionRow>
        <WorkspaceSyncButton
          toolName="Decision Log"
          onImport={handleImport}
          onPush={handlePush}
        />
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="decision-log"
          csvData={{
            headers: ["ID", "Title", "Status", "Date", "Context", "Decision", "Consequences"],
            rows: decisions.map((d) => [
              d.id,
              d.title,
              d.status,
              d.date,
              d.context ?? "",
              d.decision,
              d.consequences ?? "",
            ]),
          }}
          jsonData={decisions}
        />
        <Button onClick={addDecision} size="sm" className="gap-2 bg-accent text-bg hover:bg-accent/90">
          <Plus className="w-4 h-4" />
          New ADR
        </Button>
      </ActionRow>

      <KpiGrid cols={4}>
        {STATUSES.map((s) => (
          <StatCard key={s} variant="compact" label={s} value={counts[s]} />
        ))}
      </KpiGrid>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div ref={tableRef} className="lg:col-span-2 space-y-2">
          {decisions.length === 0 ? (
            <EmptyState icon={FileText}>
              No ADRs yet. Click &ldquo;New ADR&rdquo; to record your first decision.
            </EmptyState>
          ) : (
            decisions.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setEditing(d)}
                className={`w-full text-left rounded-lg border p-3 transition hover:border-accent/40 ${
                  editing?.id === d.id ? "border-accent/60 bg-accent/5" : "border-border bg-surface"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-text truncate">{d.title || "(untitled)"}</div>
                    <div className="text-xs text-sub mt-0.5">{d.date}</div>
                  </div>
                  <Badge className="shrink-0 capitalize" variant="outline">
                    {d.status}
                  </Badge>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="lg:col-span-3">
          {editing ? (
            <Card className="bg-surface border-border">
              <CardContent className="p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_140px] gap-3">
                  <div>
                    <Label className="text-xs text-sub">Title</Label>
                    <Input
                      value={editing.title}
                      onChange={(e) => updateDecision(editing.id, { title: e.target.value })}
                      placeholder="ADR-0001: Use Postgres for event log"
                      className="bg-bg border-border"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-sub">Status</Label>
                    <Select
                      value={editing.status}
                      onValueChange={(v) => updateDecision(editing.id, { status: v as Decision["status"] })}
                    >
                      <SelectTrigger className="bg-bg border-border capitalize">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s} className="capitalize">
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-sub">Date</Label>
                    <Input
                      type="date"
                      value={editing.date.slice(0, 10)}
                      onChange={(e) => updateDecision(editing.id, { date: e.target.value })}
                      className="bg-bg border-border"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-sub">Context</Label>
                  <Textarea
                    rows={3}
                    placeholder="What problem are we solving? What constraints apply?"
                    value={editing.context ?? ""}
                    onChange={(e) => updateDecision(editing.id, { context: e.target.value })}
                    className="bg-bg border-border"
                  />
                </div>
                <div>
                  <Label className="text-xs text-sub">Decision</Label>
                  <Textarea
                    rows={3}
                    placeholder="We will do X."
                    value={editing.decision}
                    onChange={(e) => updateDecision(editing.id, { decision: e.target.value })}
                    className="bg-bg border-border"
                  />
                </div>
                <div>
                  <Label className="text-xs text-sub">Consequences</Label>
                  <Textarea
                    rows={3}
                    placeholder="Trade-offs, follow-ups, what becomes easier/harder."
                    value={editing.consequences ?? ""}
                    onChange={(e) => updateDecision(editing.id, { consequences: e.target.value })}
                    className="bg-bg border-border"
                  />
                </div>
                <div>
                  <Label className="text-xs text-sub">Alternatives considered (one per line)</Label>
                  <Textarea
                    rows={3}
                    placeholder={"Option A — rejected because...\nOption B — rejected because..."}
                    value={(editing.alternatives ?? []).join("\n")}
                    onChange={(e) =>
                      updateDecision(editing.id, {
                        alternatives: e.target.value.split("\n").filter(Boolean),
                      })
                    }
                    className="bg-bg border-border"
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    onClick={() => removeDecision(editing.id)}
                    className="gap-2 border-danger/40 text-danger hover:bg-danger/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete ADR
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <EmptyState>
              Select an ADR on the left to edit its details.
            </EmptyState>
          )}
        </div>
      </div>
    </ToolPageWrapper>
  );
}
