"use client";

import { useEffect, useMemo } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { WorkspaceSyncButton } from "@/components/shared/workspace-sync-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, ShieldAlert } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Risk } from "@/lib/stores/workspace-types";
import { durationsFromTimeRanges, kaplanMeier, medianSurvivalTime } from "@/lib/analytics/survival";
import { generateRiskRegisterPrompts } from "@/lib/ai-prompts/risk-register";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { RISK_ACTIONS } from "@/lib/history/event-actions";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { EmptyState } from "@/components/shared/empty-state";
import { emit as sonify } from "@/lib/sonification/emit";
import { usePersisted } from "@/lib/utils/use-persisted";
import { todayLocalISO } from "@/lib/utils/formatters";

function emptyRisk(): Risk {
  return {
    id: nanoid(8),
    title: "",
    probability: 3,
    impact: 3,
    status: "open",
    raisedAt: todayLocalISO(),
  };
}

function riskScore(r: Risk): number {
  return r.probability * r.impact;
}

function riskColor(score: number): string {
  if (score >= 16) return "#ef4444";
  if (score >= 10) return "#f59e0b";
  if (score >= 5) return "#facc15";
  return "#34d399";
}

export function RiskRegisterClient() {
  const [risks, setRisks] = usePersisted<Risk[]>("agile-toolkit:risk-register", []);
  const workspaceRisks = useWorkspaceStore((s) => s.risks);
  const upsertWorkspaceRisk = useWorkspaceStore((s) => s.upsertRisk);
  const { log } = useHistoryLogger("risk-register");

  useEffect(() => {
    useWorkspaceStore.persist.rehydrate();
  }, []);

  const add = () => {
    sonify("risk-register", "risk-added");
    const risk = emptyRisk();
    setRisks((r) => [risk, ...r]);
    log(RISK_ACTIONS.RISK_ADDED, { riskId: risk.id });
  };
  const update = (id: string, patch: Partial<Risk>) => {
    setRisks((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    log(RISK_ACTIONS.RISK_UPDATED, { riskId: id, fields: Object.keys(patch) });
  };
  const remove = (id: string) => {
    const risk = risks.find((x) => x.id === id);
    setRisks((r) => r.filter((x) => x.id !== id));
    log(RISK_ACTIONS.RISK_REMOVED, { riskId: id, title: risk?.title });
  };

  const matrix = useMemo(() => {
    const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 0));
    for (const r of risks.filter((x) => x.status !== "closed")) {
      grid[r.probability - 1][r.impact - 1]++;
    }
    return grid;
  }, [risks]);

  const survivalCurve = useMemo(() => {
    const obs = durationsFromTimeRanges(risks.map((r) => ({ raisedAt: r.raisedAt, resolvedAt: r.resolvedAt })));
    return kaplanMeier(obs);
  }, [risks]);

  const medianTTM = medianSurvivalTime(survivalCurve);

  const handleImport = () => {
    const fresh = workspaceRisks.filter((w) => !risks.find((r) => r.id === w.id));
    setRisks((r) => [...fresh, ...r]);
    return fresh.length;
  };
  const handlePush = () => {
    let n = 0;
    for (const r of risks) {
      if (r.title.trim()) {
        upsertWorkspaceRisk(r);
        n++;
      }
    }
    return n;
  };

  const promptConfig = useMemo(
    () => ({
      toolName: "Risk Register",
      prompts: generateRiskRegisterPrompts({ risks, medianTTM }),
    }),
    [risks, medianTTM]
  );

  return (
    <ToolPageWrapper
      toolId="risk-register"
      title="Risk Register"
      description="Track risks on a 5×5 probability × impact matrix with mitigation plans and time-to-mitigate survival analysis."
      category="Risk & Governance"
    >
      <ActionRow>
        <WorkspaceSyncButton toolName="Risk Register" onImport={handleImport} onPush={handlePush} />
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="risk-register"
          csvData={{
            headers: ["Title", "Probability", "Impact", "Score", "Status", "Mitigation", "Raised", "Resolved"],
            rows: risks.map((r) => [
              r.title,
              r.probability,
              r.impact,
              riskScore(r),
              r.status,
              r.mitigation ?? "",
              r.raisedAt,
              r.resolvedAt ?? "",
            ]),
          }}
          jsonData={risks}
        />
        <Button onClick={add} className="gap-2 bg-accent text-bg hover:bg-accent/90">
          <Plus className="w-4 h-4" />
          New Risk
        </Button>
      </ActionRow>

      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-6 mb-6">
        <Card className="bg-surface border-border">
          <CardContent className="p-4">
            <div className="text-sm font-semibold text-text mb-3 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-accent" />
              5×5 Matrix
            </div>
            <div className="grid grid-cols-6 gap-1 text-[10px]">
              <div />
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={`h${i}`} className="text-center text-sub font-data">
                  I{i}
                </div>
              ))}
              {[5, 4, 3, 2, 1].map((prob) => (
                <div key={`row${prob}`} style={{ display: "contents" }}>
                  <div className="text-sub font-data text-right pr-1">P{prob}</div>
                  {[1, 2, 3, 4, 5].map((imp) => {
                    const count = matrix[prob - 1][imp - 1];
                    const score = prob * imp;
                    return (
                      <div
                        key={`${prob}-${imp}`}
                        className="h-8 rounded flex items-center justify-center font-data text-xs"
                        style={{ background: `${riskColor(score)}33`, color: riskColor(score), border: `1px solid ${riskColor(score)}66` }}
                      >
                        {count || ""}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <KpiGrid cols={4} marginBottom="none">
          <StatCard
            variant="compact"
            label="Open"
            value={risks.filter((r) => r.status === "open").length}
            valueClassName="text-accent"
          />
          <StatCard
            variant="compact"
            label="Mitigating"
            value={risks.filter((r) => r.status === "mitigating").length}
          />
          <StatCard
            variant="compact"
            label="Closed"
            value={risks.filter((r) => r.status === "closed").length}
          />
          <StatCard
            variant="compact"
            label="Median TTM"
            value={medianTTM !== null ? `${medianTTM}d` : "—"}
          />
        </KpiGrid>
      </div>

      <div className="space-y-2">
        {risks
          .slice()
          .sort((a, b) => riskScore(b) - riskScore(a))
          .map((r) => {
            const score = riskScore(r);
            return (
              <Card key={r.id} className="bg-surface border-border">
                <CardContent className="p-3 space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_80px_80px_140px_auto] gap-2">
                    <Input
                      value={r.title}
                      onChange={(e) => update(r.id, { title: e.target.value })}
                      placeholder="Risk title"
                      className="bg-bg border-border"
                    />
                    <Select value={String(r.probability)} onValueChange={(v) => update(r.id, { probability: Number(v) as Risk["probability"] })}>
                      <SelectTrigger className="bg-bg border-border font-data">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5].map((i) => <SelectItem key={i} value={String(i)}>P{i}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={String(r.impact)} onValueChange={(v) => update(r.id, { impact: Number(v) as Risk["impact"] })}>
                      <SelectTrigger className="bg-bg border-border font-data">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5].map((i) => <SelectItem key={i} value={String(i)}>I{i}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={r.status} onValueChange={(v) => update(r.id, { status: v as Risk["status"], resolvedAt: v === "closed" ? todayLocalISO() : r.resolvedAt })}>
                      <SelectTrigger className="bg-bg border-border capitalize">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="mitigating">Mitigating</SelectItem>
                        <SelectItem value="accepted">Accepted</SelectItem>
                        <SelectItem value="closed">Closed</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 rounded-md font-data text-sm" style={{ background: `${riskColor(score)}22`, color: riskColor(score), border: `1px solid ${riskColor(score)}66` }}>
                        {score}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => remove(r.id)} className="text-sub hover:text-danger">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    rows={2}
                    value={r.mitigation ?? ""}
                    onChange={(e) => update(r.id, { mitigation: e.target.value })}
                    placeholder="Mitigation plan..."
                    className="bg-bg border-border text-sm"
                  />
                </CardContent>
              </Card>
            );
          })}
        {risks.length === 0 && (
          <EmptyState icon={ShieldAlert}>
            No risks logged. Click &ldquo;New Risk&rdquo; to start.
          </EmptyState>
        )}
      </div>
    </ToolPageWrapper>
  );
}
