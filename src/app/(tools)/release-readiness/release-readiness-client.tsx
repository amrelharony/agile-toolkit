"use client";

import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Trash2,
  Rocket,
  CheckCircle2,
  Undo2,
  ListChecks,
  BarChart3,
} from "lucide-react";
import { chartTheme } from "@/components/charts/chart-theme";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { RELEASE_READINESS_ACTIONS } from "@/lib/history/event-actions";
import { generateReleaseReadinessPrompts } from "@/lib/ai-prompts/release-readiness";

type ReleaseStatus = "planning" | "shipped" | "rolled_back";

type GateId =
  | "a11y_audit"
  | "perf_baseline"
  | "monitoring_dashboards"
  | "alerts_tuned"
  | "rollback_tested"
  | "runbook_linked"
  | "sre_review"
  | "security_review"
  | "feature_flag_ready";

const GATES: { id: GateId; label: string; description: string }[] = [
  { id: "a11y_audit", label: "A11y audit", description: "WCAG checks pass on changed UI" },
  { id: "perf_baseline", label: "Perf baseline", description: "P75 latency within budget" },
  { id: "monitoring_dashboards", label: "Monitoring dashboards", description: "Updated for new flows" },
  { id: "alerts_tuned", label: "Alerts tuned", description: "No noisy or missing alerts" },
  { id: "rollback_tested", label: "Rollback tested", description: "Procedure dry-run succeeded" },
  { id: "runbook_linked", label: "Runbook linked", description: "Owner-on-call documented" },
  { id: "sre_review", label: "SRE review", description: "Sign-off from reliability" },
  { id: "security_review", label: "Security review", description: "Sign-off from security" },
  { id: "feature_flag_ready", label: "Feature flag ready", description: "Kill switch in place" },
];

const STATUS_BADGE: Record<ReleaseStatus, string> = {
  planning: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  shipped: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  rolled_back: "bg-danger/10 text-danger border-danger/30",
};

interface Release {
  id: string;
  name: string;
  plannedDate: string;
  status: ReleaseStatus;
  shippedDate?: string;
  gates: Record<GateId, boolean>;
  /**
   * Snapshot of gates that were *not* passing at the moment of shipping.
   * Captured before the all-pass precondition is enforced so that future
   * stats ("avg gates open at ship") stay meaningful even when policy
   * changes (e.g. allowing partial-pass ship). Optional for backward
   * compatibility with older persisted data.
   */
  gatesOpenAtShip?: number;
  description?: string;
}

interface ReleaseState {
  releases: Release[];
}

const DEFAULT_STATE: ReleaseState = { releases: [] };

function emptyGates(): Record<GateId, boolean> {
  return GATES.reduce(
    (acc, g) => {
      acc[g.id] = false;
      return acc;
    },
    {} as Record<GateId, boolean>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface ReleaseDraft {
  name: string;
  plannedDate: string;
  description: string;
}

function emptyDraft(): ReleaseDraft {
  return { name: "", plannedDate: todayIso(), description: "" };
}

export function ReleaseReadinessClient() {
  const [state, setState] = usePersisted<ReleaseState>(
    "agile-toolkit:release-readiness",
    DEFAULT_STATE
  );
  const { log } = useHistoryLogger("release-readiness");
  const [draft, setDraft] = useState<ReleaseDraft>(emptyDraft);

  const addRelease = () => {
    const name = draft.name.trim();
    if (!name) return;
    const release: Release = {
      id: crypto.randomUUID(),
      name,
      plannedDate: draft.plannedDate || todayIso(),
      status: "planning",
      gates: emptyGates(),
      description: draft.description.trim() || undefined,
    };
    setState((s) => ({ releases: [release, ...s.releases] }));
    log(RELEASE_READINESS_ACTIONS.RELEASE_ADDED, {
      releaseId: release.id,
      name: release.name,
      plannedDate: release.plannedDate,
      description: release.description,
    });
    setDraft(emptyDraft());
  };

  const removeRelease = (id: string) => {
    const r = state.releases.find((x) => x.id === id);
    setState((s) => ({ releases: s.releases.filter((x) => x.id !== id) }));
    log(RELEASE_READINESS_ACTIONS.RELEASE_REMOVED, {
      releaseId: id,
      name: r?.name,
    });
  };

  const toggleGate = (id: string, gate: GateId, value: boolean) => {
    setState((s) => ({
      releases: s.releases.map((r) =>
        r.id === id ? { ...r, gates: { ...r.gates, [gate]: value } } : r
      ),
    }));
    log(RELEASE_READINESS_ACTIONS.GATE_TOGGLED, {
      releaseId: id,
      gate,
      passed: value,
    });
  };

  const ship = (id: string) => {
    const release = state.releases.find((r) => r.id === id);
    if (!release) return;
    // Snapshot the open-gate count *before* the all-pass guard so the field
    // is meaningful even if future versions allow partial-pass shipping.
    const openAtShip = GATES.filter((g) => !release.gates[g.id]).length;
    if (openAtShip > 0) return;
    setState((s) => ({
      releases: s.releases.map((r) =>
        r.id === id
          ? {
              ...r,
              status: "shipped",
              shippedDate: todayIso(),
              gatesOpenAtShip: openAtShip,
            }
          : r
      ),
    }));
    log(RELEASE_READINESS_ACTIONS.RELEASE_SHIPPED, {
      releaseId: id,
      name: release.name,
      plannedDate: release.plannedDate,
      gatesOpenAtShip: openAtShip,
    });
  };

  const markRolledBack = (id: string) => {
    setState((s) => ({
      releases: s.releases.map((r) =>
        r.id === id ? { ...r, status: "rolled_back" } : r
      ),
    }));
    log(RELEASE_READINESS_ACTIONS.RELEASE_ROLLED_BACK, {
      releaseId: id,
    });
  };

  const reopenForPlanning = (id: string) => {
    setState((s) => ({
      releases: s.releases.map((r) =>
        r.id === id
          ? { ...r, status: "planning", shippedDate: undefined }
          : r
      ),
    }));
    log(RELEASE_READINESS_ACTIONS.RELEASE_ADDED, {
      releaseId: id,
      reopened: true,
    });
  };

  const shipped = useMemo(
    () => state.releases.filter((r) => r.status === "shipped"),
    [state.releases]
  );

  // % shipped on time = shipped releases where shippedDate <= plannedDate.
  const pctOnTime = useMemo(() => {
    if (shipped.length === 0) return null;
    const onTime = shipped.filter(
      (r) => r.shippedDate && r.shippedDate <= r.plannedDate
    ).length;
    return (onTime / shipped.length) * 100;
  }, [shipped]);

  const avgGatesOpen = useMemo(() => {
    if (shipped.length === 0) return null;
    // Use the at-ship snapshot when present; fall back to the live gate
    // count for releases shipped before the snapshot field existed.
    const sum = shipped.reduce(
      (acc, r) =>
        acc +
        (r.gatesOpenAtShip ??
          GATES.filter((g) => !r.gates[g.id]).length),
      0
    );
    return sum / shipped.length;
  }, [shipped]);

  const gateFailureCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of GATES) counts[g.id] = 0;
    for (const r of shipped) {
      for (const g of GATES) if (!r.gates[g.id]) counts[g.id] += 1;
    }
    return counts;
  }, [shipped]);

  const gateChartData = useMemo(
    () =>
      GATES.map((g) => ({
        gate: g.label,
        skipped: gateFailureCounts[g.id] ?? 0,
      })),
    [gateFailureCounts]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Release Readiness",
      prompts: generateReleaseReadinessPrompts({
        releases: state.releases.map((r) => ({
          name: r.name,
          status: r.status,
          plannedDate: r.plannedDate,
          shippedDate: r.shippedDate,
          gatesPassed: GATES.filter((g) => r.gates[g.id]).length,
          gatesTotal: GATES.length,
          description: r.description,
        })),
        pctOnTime,
        avgGatesOpen,
        gateFailureCounts,
      }),
    }),
    [state.releases, pctOnTime, avgGatesOpen, gateFailureCounts]
  );

  return (
    <ToolPageWrapper
      toolId="release-readiness"
      title="Release Readiness Checklist"
      description="Track 9 pre-release gates per release. See on-time-ship rate and the gates that are most often skipped."
      category="Incidents & Reliability"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="release-readiness"
          csvData={{
            headers: [
              "Release",
              "Status",
              "Planned",
              "Shipped",
              "Gates passed",
              ...GATES.map((g) => g.label),
              "Description",
            ],
            rows: state.releases.map((r) => [
              r.name,
              r.status,
              r.plannedDate,
              r.shippedDate ?? "",
              `${GATES.filter((g) => r.gates[g.id]).length} / ${GATES.length}`,
              ...GATES.map((g) => (r.gates[g.id] ? "yes" : "no")),
              r.description ?? "",
            ]),
          }}
          jsonData={state}
        />
      </ActionRow>

      <KpiGrid cols={3} gap="lg">
        <StatCard
          variant="compact"
          icon={Rocket}
          label="Shipped"
          value={shipped.length}
          hint={`${state.releases.length} total`}
        />
        <StatCard
          variant="compact"
          icon={CheckCircle2}
          label="% on time"
          value={pctOnTime === null ? "—" : `${pctOnTime.toFixed(0)}%`}
          hint={shipped.length > 0 ? "of shipped" : "no ships yet"}
          tone={
            pctOnTime === null
              ? "default"
              : pctOnTime >= 80
                ? "success"
                : pctOnTime >= 50
                  ? "warning"
                  : "danger"
          }
        />
        <StatCard
          variant="compact"
          icon={ListChecks}
          label="Avg gates open at ship"
          value={avgGatesOpen === null ? "—" : avgGatesOpen.toFixed(1)}
          tone={
            avgGatesOpen === null
              ? "default"
              : avgGatesOpen === 0
                ? "success"
                : avgGatesOpen <= 1
                  ? "warning"
                  : "danger"
          }
        />
      </KpiGrid>

      <SectionCard
        title="Add a release"
        icon={Plus}
        titleSize="lg"
        className="mb-6"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <Label htmlFor="rr-name" className="text-xs text-sub">
              Name
            </Label>
            <Input
              id="rr-name"
              value={draft.name}
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") addRelease();
              }}
              placeholder="e.g. v3.4.0 — Checkout redesign"
              className="bg-surface border-border"
            />
          </div>
          <div>
            <Label htmlFor="rr-date" className="text-xs text-sub">
              Planned date
            </Label>
            <Input
              id="rr-date"
              type="date"
              value={draft.plannedDate}
              onChange={(e) =>
                setDraft((d) => ({ ...d, plannedDate: e.target.value }))
              }
              className="bg-surface border-border font-data"
            />
          </div>
          <div className="md:col-span-3">
            <Label htmlFor="rr-desc" className="text-xs text-sub">
              Description (optional)
            </Label>
            <Textarea
              id="rr-desc"
              value={draft.description}
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
              placeholder="One-line scope, target audience, rollout plan…"
              rows={2}
              className="bg-surface border-border resize-none text-xs"
            />
          </div>
          <div className="md:col-span-3">
            <Button
              onClick={addRelease}
              className="gap-2 bg-accent text-bg hover:bg-accent/90 w-full md:w-auto"
            >
              <Plus className="w-4 h-4" aria-hidden="true" /> Add release
            </Button>
          </div>
        </div>
      </SectionCard>

      {state.releases.length === 0 ? (
        <EmptyState icon={Rocket}>
          No releases yet. Add one above to start ticking off pre-release
          gates.
        </EmptyState>
      ) : (
        <div className="space-y-4 mb-6">
          {state.releases.map((r) => (
            <ReleaseCard
              key={r.id}
              release={r}
              onToggleGate={(gate, val) => toggleGate(r.id, gate, val)}
              onShip={() => ship(r.id)}
              onRollBack={() => markRolledBack(r.id)}
              onReopen={() => reopenForPlanning(r.id)}
              onRemove={() => removeRelease(r.id)}
            />
          ))}
        </div>
      )}

      {shipped.length > 0 && (
        <SectionCard
          title="Most-skipped gates (across shipped releases)"
          icon={BarChart3}
          titleSize="lg"
        >
          <div className="-mx-2" style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={gateChartData} margin={{ top: 8, right: 12, left: -16, bottom: 60 }}>
                <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
                <XAxis
                  dataKey="gate"
                  tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
                  angle={-30}
                  textAnchor="end"
                  interval={0}
                  height={70}
                />
                <YAxis
                  tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
                  allowDecimals={false}
                />
                <Tooltip contentStyle={chartTheme.tooltipStyle} />
                <Bar
                  dataKey="skipped"
                  fill={chartTheme.colors.amber}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      )}
    </ToolPageWrapper>
  );
}

function ReleaseCard({
  release,
  onToggleGate,
  onShip,
  onRollBack,
  onReopen,
  onRemove,
}: {
  release: Release;
  onToggleGate: (gate: GateId, value: boolean) => void;
  onShip: () => void;
  onRollBack: () => void;
  onReopen: () => void;
  onRemove: () => void;
}) {
  const passed = GATES.filter((g) => release.gates[g.id]).length;
  const pct = (passed / GATES.length) * 100;
  const allPassed = passed === GATES.length;

  return (
    <SectionCard
      title={release.name}
      icon={Rocket}
      titleSize="lg"
      titleSuffix={
        <span className="flex items-center gap-2">
          <Badge variant="outline" className={STATUS_BADGE[release.status]}>
            {release.status === "rolled_back" ? "rolled back" : release.status}
          </Badge>
        </span>
      }
      actions={
        <div className="flex items-center gap-2">
          <span className="text-xs text-sub font-data">
            {passed} / {GATES.length}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label={`Remove ${release.name}`}
            className="h-8 w-8 p-0 text-sub hover:text-danger"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="text-xs text-sub flex items-center gap-3">
          <span>
            Planned:{" "}
            <span className="font-data text-text">{release.plannedDate}</span>
          </span>
          {release.shippedDate && (
            <span>
              Shipped:{" "}
              <span className="font-data text-text">{release.shippedDate}</span>
            </span>
          )}
        </div>
        {release.description && (
          <p className="text-xs text-sub whitespace-pre-wrap break-words">
            {release.description}
          </p>
        )}

        <div className="h-1.5 rounded-full bg-bg overflow-hidden">
          <div
            className={`h-full transition-all ${
              allPassed ? "bg-emerald-400" : "bg-accent"
            }`}
            style={{ width: `${pct}%` }}
            aria-label={`${pct.toFixed(0)}% gates complete`}
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {GATES.map((g) => (
            <label
              key={g.id}
              className="flex items-start gap-2 p-2 rounded-md border border-border bg-bg cursor-pointer hover:border-accent/30"
            >
              <input
                type="checkbox"
                checked={release.gates[g.id]}
                onChange={(e) => onToggleGate(g.id, e.target.checked)}
                disabled={release.status !== "planning"}
                className="mt-0.5 shrink-0 accent-emerald-400"
                aria-label={g.label}
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-text">
                  {g.label}
                </div>
                <div className="text-[11px] text-sub line-clamp-2">
                  {g.description}
                </div>
              </div>
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
          <Button
            onClick={onShip}
            disabled={!allPassed || release.status !== "planning"}
            className="gap-2 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/40 disabled:opacity-50"
          >
            <Rocket className="w-4 h-4" aria-hidden="true" /> Ship
          </Button>
          {release.status === "shipped" && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRollBack}
              className="border-danger/40 text-danger hover:bg-danger/10"
            >
              <Undo2 className="w-4 h-4 mr-1" aria-hidden="true" /> Mark rolled
              back
            </Button>
          )}
          {release.status === "rolled_back" && (
            <Button
              variant="outline"
              size="sm"
              onClick={onReopen}
              className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
            >
              <Undo2 className="w-4 h-4 mr-1" aria-hidden="true" /> Reopen for
              planning
            </Button>
          )}
          {!allPassed && release.status === "planning" && (
            <span className="text-xs text-sub">
              {GATES.length - passed} gate{GATES.length - passed !== 1 && "s"}{" "}
              remaining
            </span>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
