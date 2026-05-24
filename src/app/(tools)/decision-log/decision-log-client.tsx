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
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
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
    // BUG-T2-decision-log-1: do NOT call `log()` from inside the
    // setState updater. React 18 StrictMode re-invokes pure updaters
    // in dev, which previously double-logged every status change. The
    // freshest snapshot is the live store, NOT the closure — read it
    // via `setDecisions((d) => …)` ONLY to compute `next`, and call
    // the side-effecting log AFTER the dispatch using the current
    // closure's prev (acceptable: this same render's value is what
    // the user saw when they clicked).
    const prev = patch.status ? decisions.find((x) => x.id === id) : undefined;
    setDecisions((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    if (patch.status && prev) {
      log(DECISION_ACTIONS.STATUS_CHANGED, {
        decisionId: id,
        title: prev.title,
        from: prev.status,
        to: patch.status,
      });
    }
    if (editing?.id === id) setEditing((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const removeDecision = (id: string) => {
    const prev = decisions.find((x) => x.id === id);
    setDecisions((d) => d.filter((x) => x.id !== id));
    // R5: also cascade through the workspace store so any canvas
    // sticky/card pinned to this decision via sourceRef is cleaned up.
    // Without this, removing a previously-pushed decision left an
    // orphan in `workspace.decisions` (and dangling canvas refs)
    // until the next workspace export/import cycle.
    try {
      useWorkspaceStore.getState().removeDecision(id);
    } catch {
      /* workspace store may be unavailable in tests */
    }
    if (editing?.id === id) setEditing(null);
    log(DECISION_ACTIONS.DECISION_REMOVED, {
      decisionId: id,
      title: prev?.title,
    });
  };

  const counts = useMemo(() => {
    const c: Record<Decision["status"], number> = {
      proposed: 0,
      accepted: 0,
      deprecated: 0,
      superseded: 0,
    };
    // Guard against legacy / imported decisions whose status falls
    // outside the known set. Without this, `c[d.status] += 1` becomes
    // `undefined + 1 = NaN`, and every KPI card on the page renders
    // "NaN" until the offending row is removed.
    decisions.forEach((d) => {
      if (d.status in c) c[d.status] += 1;
    });
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
        <WorkspaceSyncButton toolName="Decision Log" onImport={handleImport} onPush={handlePush} />
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="decision-log"
          csvData={{
            headers: [
              "ID",
              "Title",
              "Status",
              "Date",
              "Context",
              "Decision",
              "Consequences",
              "Alternatives",
            ],
            rows: decisions.map((d) => [
              d.id,
              d.title,
              d.status,
              d.date,
              d.context ?? "",
              d.decision,
              d.consequences ?? "",
              // Join with "; " (semicolons + space) — newlines inside a CSV
              // cell would either need quoting (which the export helper may
              // do) or break consumer tooling that expects single-line cells.
              (d.alternatives ?? []).join("; "),
            ]),
          }}
          jsonData={decisions}
        />
        <Button
          onClick={addDecision}
          size="sm"
          className="gap-2 bg-accent text-bg hover:bg-accent/90"
        >
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
                    <div className="text-sm font-semibold text-text truncate">
                      {d.title || "(untitled)"}
                    </div>
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
                    <BlurInput
                      value={editing.title}
                      onCommit={(v) => updateDecision(editing.id, { title: v })}
                      placeholder="ADR-0001: Use Postgres for event log"
                      className="bg-bg border-border"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-sub">Status</Label>
                    <Select
                      value={editing.status}
                      onValueChange={(v) =>
                        updateDecision(editing.id, { status: v as Decision["status"] })
                      }
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
                      // Defensive nullish — hand-edited localStorage
                      // (or an older schema migration) could leave
                      // `date` as null/undefined and `.slice` on null
                      // would crash the editor open.
                      value={(editing.date ?? "").slice(0, 10)}
                      onChange={(e) => updateDecision(editing.id, { date: e.target.value })}
                      className="bg-bg border-border"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-sub">Context</Label>
                  <BlurTextarea
                    rows={3}
                    placeholder="What problem are we solving? What constraints apply?"
                    value={editing.context ?? ""}
                    onCommit={(v) => updateDecision(editing.id, { context: v })}
                    className="bg-bg border-border"
                  />
                </div>
                <div>
                  <Label className="text-xs text-sub">Decision</Label>
                  <BlurTextarea
                    rows={3}
                    placeholder="We will do X."
                    value={editing.decision}
                    onCommit={(v) => updateDecision(editing.id, { decision: v })}
                    className="bg-bg border-border"
                  />
                </div>
                <div>
                  <Label className="text-xs text-sub">Consequences</Label>
                  <BlurTextarea
                    rows={3}
                    placeholder="Trade-offs, follow-ups, what becomes easier/harder."
                    value={editing.consequences ?? ""}
                    onCommit={(v) => updateDecision(editing.id, { consequences: v })}
                    className="bg-bg border-border"
                  />
                </div>
                <div>
                  <Label className="text-xs text-sub">Alternatives considered (one per line)</Label>
                  <BlurTextarea
                    rows={3}
                    placeholder={"Option A — rejected because...\nOption B — rejected because..."}
                    value={(editing.alternatives ?? []).join("\n")}
                    onCommit={(v) =>
                      // Keep the raw split — including empty trailing lines —
                      // so the user can press Enter at the end of the field
                      // without their cursor jumping back. The previous
                      // `.filter(Boolean)` collapsed every empty line, which
                      // made it impossible to add a blank line between bullets
                      // mid-typing.
                      updateDecision(editing.id, {
                        alternatives: v.split("\n"),
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
            <EmptyState>Select an ADR on the left to edit its details.</EmptyState>
          )}
        </div>
      </div>
    </ToolPageWrapper>
  );
}
