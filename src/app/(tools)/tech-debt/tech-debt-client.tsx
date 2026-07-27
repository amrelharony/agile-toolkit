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
import { BlurInput } from "@/components/shared/blur-fields";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Wrench, Activity } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TechDebtItem } from "@/lib/stores/workspace-types";
import { generateTechDebtPrompts } from "@/lib/ai-prompts/tech-debt";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { TECH_DEBT_ACTIONS } from "@/lib/history/event-actions";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { usePersisted } from "@/lib/utils/use-persisted";
import { todayLocalISO } from "@/lib/utils/formatters";
import { chartTheme } from "@/components/charts/chart-theme";
import { SmartInput } from "@/components/shared/smart-input";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import { durationsFromTimeRanges, kaplanMeier, medianSurvivalTime } from "@/lib/analytics/survival";
import { bootstrapQuantile } from "@/lib/analytics/bootstrap";

function emptyItem(): TechDebtItem {
  return {
    id: nanoid(8),
    title: "",
    impact: 3,
    effort: 3,
    interestRate: 1,
    raisedAt: todayLocalISO(),
  };
}

function ageDays(item: TechDebtItem): number {
  // Guard against NaN propagation when raisedAt is missing or unparseable —
  // an unparseable date would otherwise yield NaN days, which then poisons
  // every priorityScore() that depends on it.
  const t = new Date(item.raisedAt).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.floor((Date.now() - t) / 86_400_000);
}

function priorityScore(item: TechDebtItem): number {
  const interest = (item.interestRate ?? 0) * ageDays(item);
  return item.impact * 4 - item.effort + interest * 0.5;
}

/**
 * Per-row interest-rate input wired to the smart-default predictor. The
 * SmartInput chip appears for empty (or zero-default) values, and pressing
 * Tab on an empty field accepts the prediction. We display a string draft
 * so the placeholder/ghost is visible while the user thinks.
 */
function InterestRateInput({
  value,
  commit,
}: {
  value: number | undefined;
  commit: (next: number) => void;
}) {
  const isUnset = value === undefined || value === 0;
  const [draft, setDraft] = useState<string>(isUnset ? "" : String(value));
  const lastSyncedRef = useRef<number | undefined>(value);
  // Sync external changes (e.g. workspace import) into local draft when
  // the field isn't being edited — same pattern as DescriptionEditor.
  useEffect(() => {
    if (lastSyncedRef.current === value) return;
    lastSyncedRef.current = value;
    setDraft(value === undefined || value === 0 ? "" : String(value));
  }, [value]);
  const pred = usePredictedDefault<number>("tech-debt", "interestRate", 0.5);

  return (
    <SmartInput<number>
      predicted={pred}
      onAccept={(v) => {
        setDraft(String(v));
        lastSyncedRef.current = v;
        commit(v);
      }}
      render={({ ghost, accept, chip }) => (
        <div className="flex flex-col gap-0.5">
          <Input
            type="number"
            step="0.5"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft === "") {
                if (value !== 0 && value !== undefined) commit(0);
                return;
              }
              const n = Number(draft);
              if (Number.isFinite(n) && n !== value) {
                lastSyncedRef.current = n;
                commit(n);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Tab" && draft === "") {
                e.preventDefault();
                accept();
              }
            }}
            placeholder={ghost ?? "Int/sprint"}
            className="bg-bg border-border font-data"
            aria-label="Interest per sprint"
          />
          {draft === "" && chip}
        </div>
      )}
    />
  );
}

/**
 * Inline-edit description with local draft state. Avoids the
 * per-keystroke pattern that would (a) write to localStorage on every
 * character and (b) flood the history log with ITEM_UPDATED events. We
 * commit on blur, only firing the upstream update if the value actually
 * changed since the last commit.
 */
function DescriptionEditor({
  value,
  commit,
}: {
  value: string;
  commit: (next: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(value);
  const lastCommittedRef = useRef(value);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (typeof document !== "undefined" && document.activeElement === inputRef.current) {
      return;
    }
    if (value === lastCommittedRef.current) return;
    setDraft(value);
    lastCommittedRef.current = value;
  }, [value]);
  return (
    <Textarea
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === lastCommittedRef.current) return;
        lastCommittedRef.current = draft;
        commit(draft.trim() ? draft : undefined);
      }}
      placeholder="Description (optional)..."
      rows={2}
      className="bg-bg border-border resize-none text-xs"
      aria-label="Debt item description"
    />
  );
}

export function TechDebtClient() {
  const [items, setItems] = usePersisted<TechDebtItem[]>("agile-toolkit:tech-debt", []);
  const workspaceDebt = useWorkspaceStore((s) => s.techDebt);
  const upsertDebt = useWorkspaceStore((s) => s.upsertTechDebt);
  const { log } = useHistoryLogger("tech-debt");

  useEffect(() => {
    useWorkspaceStore.persist.rehydrate();
  }, []);

  const add = () => {
    const item = emptyItem();
    setItems((s) => [item, ...s]);
    log(TECH_DEBT_ACTIONS.ITEM_ADDED, { itemId: item.id });
  };
  const update = (id: string, patch: Partial<TechDebtItem>) => {
    // Use the functional setter so we observe the freshest list, not a value
    // captured at render time. A rapid double-update would otherwise see a
    // stale `prev` and miss the resolve transition.
    setItems((items) => {
      const prev = items.find((x) => x.id === id);
      const next = items.map((x) => (x.id === id ? { ...x, ...patch } : x));
      if (patch.resolvedAt && !prev?.resolvedAt) {
        log(TECH_DEBT_ACTIONS.ITEM_RESOLVED, { itemId: id, title: prev?.title });
      } else {
        log(TECH_DEBT_ACTIONS.ITEM_UPDATED, { itemId: id, fields: Object.keys(patch) });
      }
      return next;
    });
  };
  const remove = (id: string) => {
    const item = items.find((x) => x.id === id);
    setItems((s) => s.filter((x) => x.id !== id));
    // R10: mirror to workspace store so the item disappears for any
    // downstream consumer (dashboards, anti-pattern detectors, canvas
    // stickies via the workspace cascade). Previously local-only,
    // leaving a zombie in `workspace.techDebt` after push.
    try {
      useWorkspaceStore.getState().removeTechDebt(id);
    } catch {
      /* workspace store may be unavailable in tests */
    }
    log(TECH_DEBT_ACTIONS.ITEM_REMOVED, { itemId: id, title: item?.title });
  };

  const handleImport = () => {
    // Merge by id with workspace-as-newer-wins: existing items are replaced
    // with the workspace version, and brand-new ones are prepended. This
    // turns Import into a true sync rather than a one-time copy that ignored
    // updates.
    let imported = 0;
    setItems((existing) => {
      const byId = new Map(existing.map((i) => [i.id, i] as const));
      let replaced = 0;
      let added = 0;
      for (const w of workspaceDebt) {
        if (byId.has(w.id)) replaced++;
        else added++;
        byId.set(w.id, w);
      }
      imported = replaced + added;
      // Preserve original ordering when possible: keep existing-id items in
      // their previous order, append any genuinely new ones at the front so
      // the user notices them.
      const existingIds = new Set(existing.map((i) => i.id));
      const newOnes = workspaceDebt.filter((w) => !existingIds.has(w.id));
      const merged = existing.map((i) => byId.get(i.id) ?? i);
      return [...newOnes, ...merged];
    });
    return imported;
  };
  const handlePush = () => {
    let n = 0;
    for (const i of items) {
      if (i.title.trim()) {
        upsertDebt(i);
        n++;
      }
    }
    return n;
  };

  const ranked = useMemo(
    () => items.slice().sort((a, b) => priorityScore(b) - priorityScore(a)),
    [items]
  );
  const totalInterestPerSprint = useMemo(
    () => items.filter((i) => !i.resolvedAt).reduce((a, b) => a + (b.interestRate ?? 0), 0),
    [items]
  );

  const hotspotMatrix = useMemo(() => {
    const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 0));
    // Clamp impact/effort into [1,5] before indexing — corrupted persisted
    // values (e.g. 0, 6, NaN) would otherwise reach `grid[-1][...]` or
    // `grid[5][...]` and throw at runtime.
    //
    // ROUND as well as clamp: clamping alone bounds the range but not the
    // domain, so a fractional 2.5 yielded `grid[1.5]` → `undefined[c]++` →
    // TypeError inside a useMemo during render, unmounting the whole Tech
    // Debt route on every mount thereafter (the value is persisted). The
    // UI's Select only ever writes 1-5, but the agent action
    // `workspace.tech_debt` declares `impact: z.number()` with no `.int()`,
    // and "Import from Workspace" copies it verbatim. Mirrors the guard in
    // threat-model-client.tsx.
    const bucket = (v: number) =>
      (Number.isFinite(v) ? Math.min(5, Math.max(1, Math.round(v))) : 3) - 1;
    for (const item of items.filter((x) => !x.resolvedAt)) {
      grid[bucket(item.impact)][bucket(item.effort)]++;
    }
    return grid;
  }, [items]);

  const areas = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) {
      if (!i.area) continue;
      m.set(i.area, (m.get(i.area) ?? 0) + i.impact);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  // ── Tier-2 KM survival on resolution time ────────────────────────────
  // Both the bootstrap CI on the median and the KM curve are derived from
  // the same observation set so any negative-duration filtering or rounding
  // applied by `durationsFromTimeRanges` lines up — otherwise the two
  // medians can disagree on the same data.
  const survivalObservations = useMemo(
    () =>
      durationsFromTimeRanges(
        items.map((i) => ({ raisedAt: i.raisedAt, resolvedAt: i.resolvedAt }))
      ),
    [items]
  );

  const resolvedDurations = useMemo(
    () => survivalObservations.filter((o) => o.event).map((o) => o.duration),
    [survivalObservations]
  );

  const survivalCurve = useMemo(() => {
    if (resolvedDurations.length < 4) return [];
    return kaplanMeier(survivalObservations);
  }, [survivalObservations, resolvedDurations.length]);

  const medianResolutionDays = useMemo(() => medianSurvivalTime(survivalCurve), [survivalCurve]);

  const medianCI = useMemo(() => {
    if (resolvedDurations.length < 3) return null;
    return bootstrapQuantile(resolvedDurations, 0.5);
  }, [resolvedDurations]);

  const survivalChartData = useMemo(
    () => survivalCurve.map((p) => ({ t: p.t, survival: Math.round(p.survival * 1000) / 1000 })),
    [survivalCurve]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Technical Debt Tracker",
      prompts: generateTechDebtPrompts({ items: ranked, totalInterestPerSprint }),
    }),
    [ranked, totalInterestPerSprint]
  );

  return (
    <ToolPageWrapper
      toolId="tech-debt"
      title="Technical Debt Tracker"
      description="Register tech debt with impact × effort, track interest cost per sprint, and find hotspots."
      category="Risk & Governance"
    >
      <ActionRow>
        <WorkspaceSyncButton toolName="Tech Debt" onImport={handleImport} onPush={handlePush} />
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="tech-debt"
          csvData={{
            headers: [
              "Title",
              "Description",
              "Area",
              "Impact",
              "Effort",
              "Interest/Sprint",
              "Age (d)",
              "Score",
            ],
            rows: ranked.map((i) => [
              i.title,
              i.description ?? "",
              i.area ?? "",
              i.impact,
              i.effort,
              i.interestRate ?? 0,
              ageDays(i),
              priorityScore(i).toFixed(1),
            ]),
          }}
          jsonData={items}
        />
        <Button onClick={add} className="gap-2 bg-accent text-bg hover:bg-accent/90">
          <Plus className="w-4 h-4" />
          New Debt
        </Button>
      </ActionRow>

      <KpiGrid cols={3}>
        <StatCard
          variant="compact"
          label="Open Items"
          value={items.filter((i) => !i.resolvedAt).length}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          label="Interest/Sprint"
          value={totalInterestPerSprint.toFixed(1)}
          valueClassName="text-amber-300"
          hint="velocity-units bleed"
        />
        <StatCard
          variant="compact"
          label="Top Hotspot"
          value={areas[0]?.[0] ?? "—"}
          valueClassName="text-lg truncate"
          hint={areas[0] ? `${areas[0][1]} impact points` : "Add areas to items"}
        />
      </KpiGrid>

      <Card className="bg-surface border-border mb-6">
        <CardContent className="p-4">
          <div className="text-sm font-semibold text-text mb-3">Impact × Effort Heatmap</div>
          <div className="grid grid-cols-6 gap-1 text-[10px]">
            <div />
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={`h${i}`} className="text-center text-sub font-data">
                E{i}
              </div>
            ))}
            {[5, 4, 3, 2, 1].map((imp) => (
              <div key={`row${imp}`} style={{ display: "contents" }}>
                <div className="text-sub font-data text-right pr-1">I{imp}</div>
                {[1, 2, 3, 4, 5].map((eff) => {
                  const count = hotspotMatrix[imp - 1][eff - 1];
                  const intensity = Math.min(1, count / 5);
                  return (
                    <div
                      key={`${imp}-${eff}`}
                      className="h-8 rounded flex items-center justify-center font-data text-xs border"
                      style={{
                        background: `rgba(0,240,255,${intensity * 0.5})`,
                        borderColor: `rgba(0,240,255,${intensity * 0.6})`,
                        color: count ? "#00f0ff" : "#555",
                      }}
                    >
                      {count || ""}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="text-xs text-sub mt-2">
            Top-left (high impact, low effort) = best paydown targets.
          </div>
        </CardContent>
      </Card>

      {survivalChartData.length > 1 && (
        <SectionCard
          title="Resolution survival curve"
          icon={Activity}
          titleSuffix={
            medianResolutionDays !== null
              ? `Median ${medianResolutionDays}d${
                  medianCI
                    ? ` · 95% CI [${Math.round(medianCI.lower)}, ${Math.round(medianCI.upper)}]`
                    : ""
                }`
              : undefined
          }
          className="mb-6"
        >
          <div className="h-40 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={survivalChartData}
                margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
                <XAxis
                  dataKey="t"
                  tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
                  axisLine={{ stroke: chartTheme.gridColor }}
                  label={{
                    value: "days",
                    fill: chartTheme.axisColor,
                    fontSize: 10,
                    position: "insideBottom",
                    offset: -2,
                  }}
                />
                <YAxis
                  domain={[0, 1]}
                  tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
                  axisLine={{ stroke: chartTheme.gridColor }}
                  tickFormatter={(v) => `${Math.round(v * 100)}%`}
                />
                <Tooltip
                  contentStyle={chartTheme.tooltipStyle}
                  formatter={(v) => [`${(Number(v) * 100).toFixed(1)}%`, "still open"]}
                  labelFormatter={(v) => `${v}d`}
                />
                <Line
                  type="stepAfter"
                  dataKey="survival"
                  stroke={chartTheme.colors.cyan}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-sub mt-2">
            Kaplan-Meier estimate over {resolvedDurations.length} resolved item
            {resolvedDurations.length === 1 ? "" : "s"}. Y-axis: probability the debt is still open
            after N days.
          </p>
        </SectionCard>
      )}

      <div className="space-y-2">
        {ranked.map((i) => (
          <Card key={i.id} className="bg-surface border-border">
            <CardContent className="p-3 space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_80px_80px_80px_60px_auto] gap-2 items-center">
                <BlurInput
                  value={i.title}
                  onCommit={(v) => update(i.id, { title: v })}
                  placeholder="Debt item"
                  className="bg-bg border-border"
                />
                <BlurInput
                  value={i.area ?? ""}
                  onCommit={(v) => update(i.id, { area: v })}
                  placeholder="Area"
                  className="bg-bg border-border"
                />
                <Select
                  value={String(i.impact)}
                  onValueChange={(v) =>
                    update(i.id, { impact: Number(v) as TechDebtItem["impact"] })
                  }
                >
                  <SelectTrigger className="bg-bg border-border font-data">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        Impact {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(i.effort)}
                  onValueChange={(v) =>
                    update(i.id, { effort: Number(v) as TechDebtItem["effort"] })
                  }
                >
                  <SelectTrigger className="bg-bg border-border font-data">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        Effort {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <InterestRateInput
                  value={i.interestRate}
                  commit={(next) => update(i.id, { interestRate: next })}
                />
                <div className="font-data text-sm text-accent text-center">
                  {priorityScore(i).toFixed(0)}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(i.id)}
                  aria-label="Remove debt item"
                  className="text-sub hover:text-danger min-touch-coarse"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              <DescriptionEditor
                value={i.description ?? ""}
                commit={(next) => update(i.id, { description: next })}
              />
            </CardContent>
          </Card>
        ))}
        {items.length === 0 && (
          <EmptyState icon={Wrench}>
            No debt logged. Click &ldquo;New Debt&rdquo; to start.
          </EmptyState>
        )}
      </div>
    </ToolPageWrapper>
  );
}
