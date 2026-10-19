"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { SectionCard } from "@/components/shared/section-card";
import { ChartCard } from "@/components/shared/chart-card";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { SmartInput } from "@/components/shared/smart-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Target, AlertTriangle } from "lucide-react";
import type { CausalAnnotationData } from "@/components/charts/causal-annotation";
import { cusum } from "@/lib/analytics/changepoint";
import { mannKendall } from "@/lib/analytics/trend-test";
import {
  forecastBayesianHolt,
  bayesianForecastConfidence,
} from "@/lib/analytics/forecasting-bayesian";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import { generateSloPrompts } from "@/lib/ai-prompts/slo-builder";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { SloDefinition, SloBurn } from "@/lib/stores/workspace-types";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SLO_ACTIONS } from "@/lib/history/event-actions";
import { todayLocalISO } from "@/lib/utils/formatters";

// Recharts loads with the chart, not the page; ChartCard's fixed-height box
// reserves the space while it does.
const CumulativeErrorChart = dynamic(() => import("./charts").then((m) => m.CumulativeErrorChart), {
  ssr: false,
});

interface SloState {
  slos: SloDefinition[];
  burns: SloBurn[];
}

const DEFAULT_STATE: SloState = { slos: [], burns: [] };

const SB_ID = "sloBuilder:current"; // MUST match SB_ID in slo-builder.ts.

// Synced workspace singleton (was isolated usePersisted/localStorage), so MCP
// SLO/burn writes round-trip into the UI. Drop-in [state, setState].
function useSloBuilder(): [SloState, (u: SloState | ((p: SloState) => SloState)) => void] {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.sloBuilders ?? []).find((d) => d.id === SB_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertSloBuilder);
  const state: SloState = doc ? { slos: doc.slos, burns: doc.burns } : DEFAULT_STATE;
  const setState = (u: SloState | ((p: SloState) => SloState)) => {
    const cur = (useWorkspaceStore.getState().sloBuilders ?? []).find((d) => d.id === SB_ID);
    const curState: SloState = cur ? { slos: cur.slos, burns: cur.burns } : DEFAULT_STATE;
    const next = typeof u === "function" ? u(curState) : u;
    upsert({ id: SB_ID, slos: next.slos, burns: next.burns });
  };
  return [state, setState];
}

interface SloDraft {
  name: string;
  sliDescription: string;
  targetPct: string; // user types %, store /100
  windowDays: string;
  description: string;
}
function makeSloDraft(): SloDraft {
  return {
    name: "",
    sliDescription: "",
    targetPct: "99.9",
    windowDays: "30",
    description: "",
  };
}

interface BurnDraft {
  sloId: string;
  date: string;
  errorMinutes: string;
}
function makeBurnDraft(defaultSloId: string): BurnDraft {
  return {
    sloId: defaultSloId,
    date: todayLocalISO(),
    errorMinutes: "",
  };
}

/**
 * Why a draft SLO can't be added yet, one message per problem (empty when
 * it's valid). "Add SLO" used to return silently on any of these, and a
 * blank target parsed as `Number("") === 0`, i.e. a 0 % SLO.
 */
function sloDraftErrors(d: SloDraft): string[] {
  const errors: string[] = [];
  if (!d.name.trim()) errors.push("Name is required.");
  if (!d.sliDescription.trim()) errors.push("SLI description is required.");
  const target = Number(d.targetPct);
  if (!d.targetPct.trim() || !Number.isFinite(target) || target < 0 || target > 100) {
    errors.push("Target must be a percentage from 0 to 100, e.g. 99.9.");
  }
  const windowDays = Number(d.windowDays);
  if (!d.windowDays.trim() || !Number.isFinite(windowDays) || windowDays < 1) {
    errors.push("Window must be at least 1 day.");
  }
  return errors;
}

/**
 * Why a draft burn can't be logged yet. A blank "Error minutes" used to log
 * a 0-minute burn (`Number("") === 0`); invalid values were dropped silently.
 */
function burnDraftErrors(d: BurnDraft): string[] {
  const errors: string[] = [];
  if (!d.sloId) errors.push("Pick an SLO.");
  if (!d.date) errors.push("Pick a date.");
  const minutes = Number(d.errorMinutes);
  if (!d.errorMinutes.trim() || !Number.isFinite(minutes) || minutes < 0) {
    errors.push("Error minutes must be a number of 0 or more, e.g. 4.5.");
  }
  return errors;
}

/**
 * Total error budget in minutes for a given SLO.
 *
 * Window-minutes × (1 - target). Example: 99.9 % over 30 days =>
 * 30 × 24 × 60 × 0.001 = 43.2 minutes/month.
 */
function budgetMinutes(slo: SloDefinition): number {
  // Defensive against bad inputs that could sneak in via JSON import or
  // a future UI bug: negative window days, NaN target, target >1 or <0.
  // Any of those used to produce nonsensical budgets (negative budget,
  // NaN-laced burn-rate charts).
  const windowMinutes = Math.max(0, slo.windowDays * 24 * 60);
  if (!Number.isFinite(slo.target) || !Number.isFinite(windowMinutes)) return 0;
  const target = Math.max(0, Math.min(1, slo.target));
  const allowable = 1 - target;
  return Math.max(0, windowMinutes * allowable);
}

/**
 * Parse a YYYY-MM-DD string as midnight in the user's *local* timezone.
 * `new Date("2025-04-01")` parses as UTC midnight, so users west of UTC
 * see the burn date shift to the prior local day — which then drops out
 * of the rolling window early.
 */
function parseDateLocal(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return new Date(iso).getTime();
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(y, mo, d).getTime();
}

/**
 * Sum of `errorMinutes` for a given SLO inside its rolling window: the
 * `windowDays` most recent calendar days, ending at (and including) today.
 */
function consumedMinutes(slo: SloDefinition, burns: SloBurn[]): number {
  // BUG-T8-slo-builder-2: anchor the cutoff at LOCAL start-of-today so
  // the window edge is calendar-aligned, not wall-clock-aligned. The
  // prior `Date.now() - N*86_400_000` cutoff drifted across the day — a
  // burn dated exactly N days ago at local midnight intermittently fell
  // in or out of the window depending on what time the page was loaded.
  //
  // The window spans exactly `windowDays` calendar dates: today plus the
  // (windowDays - 1) days before it. Subtracting a full `windowDays`
  // admitted windowDays + 1 dates, so consumption was summed over one
  // more day than the budget denominator assumes — enough to flip a
  // borderline SLO to "BURNED" a day early.
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const cutoff = start.getTime() - (slo.windowDays - 1) * 24 * 60 * 60 * 1000;
  // BUG-T8-slo-builder-3: also bound the upper edge so future-dated
  // burns (typos / wrong-locale imports) don't inflate the window.
  // Allow a small +1d slack (tomorrow only) to tolerate timezone-edge
  // near-midnight entries without rejecting them outright.
  const upper = start.getTime() + 1 * 24 * 60 * 60 * 1000;
  return burns
    .filter((b) => b.sloId === slo.id)
    .filter((b) => {
      const t = parseDateLocal(b.date);
      return Number.isFinite(t) && t >= cutoff && t <= upper;
    })
    .reduce((acc, b) => acc + b.errorMinutes, 0);
}

export function SloBuilderClient() {
  const [state, setState] = useSloBuilder();
  const [sloDraft, setSloDraft] = useState<SloDraft>(makeSloDraft);
  const [burnDraft, setBurnDraft] = useState<BurnDraft>(() => makeBurnDraft(""));
  // Validation shows after the first failed submit, then tracks the draft
  // live so each message clears as soon as its field is fixed.
  const [sloTried, setSloTried] = useState(false);
  const [burnTried, setBurnTried] = useState(false);
  const sloErrors = sloTried ? sloDraftErrors(sloDraft) : [];
  const burnErrors = burnTried ? burnDraftErrors(burnDraft) : [];
  const { log } = useHistoryLogger("slo-builder");

  // When the SLO list changes (or starts empty), make sure the burn-draft has
  // a valid sloId selected — otherwise the Select renders unbound.
  // Functional setState reads `b.sloId` synchronously so we don't need to
  // depend on it here (depending on it just churns the effect on every typing-
  // induced re-render that doesn't change the SLO list).
  useEffect(() => {
    setBurnDraft((b) => {
      if (state.slos.length === 0) {
        return b.sloId === "" ? b : { ...b, sloId: "" };
      }
      if (state.slos.some((s) => s.id === b.sloId)) return b;
      return { ...b, sloId: state.slos[0].id };
    });
  }, [state.slos]);

  const addSlo = () => {
    const name = sloDraft.name.trim();
    const sli = sloDraft.sliDescription.trim();
    const targetPctNum = Number(sloDraft.targetPct);
    const windowDaysNum = Number(sloDraft.windowDays);
    if (sloDraftErrors(sloDraft).length > 0) {
      setSloTried(true);
      return;
    }
    const slo: SloDefinition = {
      id: crypto.randomUUID(),
      name,
      sliDescription: sli,
      target: Math.min(1, Math.max(0, targetPctNum / 100)),
      windowDays: Math.floor(windowDaysNum),
      description: sloDraft.description.trim() || undefined,
    };
    setState((s) => ({ ...s, slos: [...s.slos, slo] }));
    log(SLO_ACTIONS.SLO_ADDED, {
      sloId: slo.id,
      name: slo.name,
      target: slo.target,
      windowDays: slo.windowDays,
      sliDescription: slo.sliDescription,
      description: slo.description,
    });
    setSloDraft(makeSloDraft());
    setSloTried(false);
  };

  const removeSlo = (id: string) => {
    const removed = state.slos.find((s) => s.id === id);
    setState((s) => ({
      slos: s.slos.filter((x) => x.id !== id),
      // Cascade: drop any burn entries for the removed SLO.
      burns: s.burns.filter((b) => b.sloId !== id),
    }));
    log(SLO_ACTIONS.SLO_REMOVED, {
      sloId: id,
      name: removed?.name,
      description: removed?.description,
    });
  };

  const addBurn = () => {
    if (burnDraftErrors(burnDraft).length > 0) {
      setBurnTried(true);
      return;
    }
    const minutes = Number(burnDraft.errorMinutes);
    const burn: SloBurn = {
      id: crypto.randomUUID(),
      sloId: burnDraft.sloId,
      date: burnDraft.date,
      errorMinutes: minutes,
    };
    setState((s) => ({ ...s, burns: [...s.burns, burn] }));
    const slo = state.slos.find((s) => s.id === burn.sloId);
    log(SLO_ACTIONS.BURN_LOGGED, {
      burnId: burn.id,
      sloId: burn.sloId,
      sloName: slo?.name,
      date: burn.date,
      errorMinutes: burn.errorMinutes,
    });
    setBurnDraft((b) => ({ ...b, errorMinutes: "" }));
    setBurnTried(false);
  };

  // Per-SLO snapshot: budget, consumed, remaining %.
  const sloRows = useMemo(
    () =>
      state.slos.map((slo) => {
        const budget = budgetMinutes(slo);
        const consumed = consumedMinutes(slo, state.burns);
        const remainingPct = budget === 0 ? 0 : Math.max(0, ((budget - consumed) / budget) * 100);
        return {
          slo,
          budget,
          consumed,
          remainingPct,
          atRisk: remainingPct < 50 && remainingPct > 0,
          burned: remainingPct === 0 && budget > 0,
        };
      }),
    [state.slos, state.burns]
  );

  // Cumulative consumption per SLO over time, for the area chart.
  const chartData = useMemo(() => {
    if (state.slos.length === 0 || state.burns.length === 0) return [];
    // Collect all unique dates across all SLOs' burns, sorted ascending.
    const dateSet = new Set<string>();
    for (const b of state.burns) dateSet.add(b.date);
    const dates = Array.from(dateSet).sort();
    // Per-SLO running total — keyed by sloId.
    const running: Record<string, number> = {};
    for (const s of state.slos) running[s.id] = 0;
    return dates.map((date) => {
      // Add this date's burns for each SLO to the running total.
      for (const b of state.burns) {
        if (b.date !== date) continue;
        running[b.sloId] = (running[b.sloId] ?? 0) + b.errorMinutes;
      }
      const row: Record<string, string | number> = { date };
      for (const s of state.slos) {
        // BUG-T8-slo-builder-4: key by `s.id`, not `s.name`. Two SLOs
        // sharing a name (which the schema permits) would collapse into
        // a single dataKey, dropping one series entirely.
        row[s.id] = Number((running[s.id] ?? 0).toFixed(2));
      }
      return row;
    });
  }, [state.slos, state.burns]);

  // ── Per-SLO daily-burn series (not cumulative) used for analytics. ─────
  // Pick the SLO with the longest series for analytics; the rest stay
  // visualised but uninstrumented to keep the UI focused.
  const burnAnalytics = useMemo(() => {
    if (state.slos.length === 0 || state.burns.length === 0) return null;
    // Build per-SLO date→errorMinutes map, then pick the longest one.
    type Series = { sloId: string; name: string; dates: string[]; values: number[] };
    let best: Series | null = null;
    for (const slo of state.slos) {
      const burns = state.burns
        .filter((b) => b.sloId === slo.id)
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date));
      if (burns.length < 4) continue;
      const dates = burns.map((b) => b.date);
      const values = burns.map((b) => b.errorMinutes);
      if (!best || values.length > best.values.length) {
        best = { sloId: slo.id, name: slo.name, dates, values };
      }
    }
    if (!best) return null;

    // CUSUM regime shifts on the per-burn series. Filter out indexes that
    // would land outside the chart's x-domain — `ifOverflow="extendDomain"`
    // would otherwise distort the axis. The chart's x-axis is dates from
    // ALL SLOs combined, so best.dates is always a subset, but we still
    // filter for safety.
    const cps = cusum(best.values);
    const annotations: CausalAnnotationData[] = cps
      .map((cp): CausalAnnotationData | null => {
        const date = best!.dates[cp.index];
        if (!date) return null;
        return {
          x: date,
          label: `Burn regime ${cp.direction === "up" ? "↑" : "↓"}`,
          detail: `CUSUM detected a ${cp.direction === "up" ? "spike" : "drop"} in burn rate for ${best!.name} on ${date}.`,
          confidence: "moderate",
        };
      })
      .filter((a): a is CausalAnnotationData => a !== null);

    // Mann-Kendall trend.
    const mk = mannKendall(best.values);

    // Bayesian projection of remaining budget at end of window.
    const slo = state.slos.find((s) => s.id === best!.sloId);
    let projection: {
      remainingMin: number;
      ciLowMin: number;
      ciHighMin: number;
      horizonDays: number;
      confidence: "low" | "medium" | "high";
    } | null = null;
    if (slo && best.values.length >= 2) {
      // Days from first burn date to today; horizon = remaining window days.
      const firstTs = parseDateLocal(best.dates[0]);
      const elapsedDays = Math.max(1, Math.round((Date.now() - firstTs) / (24 * 60 * 60 * 1000)));
      const horizon = Math.max(0, slo.windowDays - elapsedDays);
      if (horizon > 0) {
        const fc = forecastBayesianHolt(best.values, horizon, { priorWeight: 1 });
        // Sum of projected daily burns over the horizon.
        const projectedSum = fc.reduce((acc, p) => acc + Math.max(0, p.yHat), 0);
        const projectedLow = fc.reduce((acc, p) => acc + Math.max(0, p.lower80), 0);
        const projectedHigh = fc.reduce((acc, p) => acc + Math.max(0, p.upper80), 0);
        const budget = budgetMinutes(slo);
        const consumed = consumedMinutes(slo, state.burns);
        projection = {
          remainingMin: Math.max(0, budget - consumed - projectedSum),
          // Note: lower projected burn → MORE remaining, so we swap.
          ciLowMin: Math.max(0, budget - consumed - projectedHigh),
          ciHighMin: Math.max(0, budget - consumed - projectedLow),
          horizonDays: horizon,
          confidence: bayesianForecastConfidence(best.values),
        };
      }
    }

    return {
      sloName: best.name,
      annotations,
      mk,
      projection,
    };
  }, [state.slos, state.burns]);

  // ── Smart-default predictor for the suggested error budget ──────────────
  // Predictor returns a target budget (minutes) for a 99.9% / 30d SLO.
  // Accepting fills both target % and window days that produce that budget.
  const budgetPrediction = usePredictedDefault<number>("slo-builder", "errorBudgetMinutes", 0);

  const promptConfig = useMemo(
    () => ({
      toolName: "SLO & Error Budget Builder",
      prompts: generateSloPrompts({
        slos: sloRows.map(({ slo, budget, consumed, remainingPct }) => ({
          name: slo.name,
          target: slo.target,
          windowDays: slo.windowDays,
          errorBudgetMinutes: budget,
          consumedMinutes: consumed,
          remainingPct,
          sliDescription: slo.sliDescription,
          description: slo.description,
        })),
      }),
    }),
    [sloRows]
  );

  const atRiskSlos = sloRows.filter((r) => r.atRisk || r.burned);

  return (
    <ToolPageWrapper
      toolId="slo-builder"
      title="SLO & Error Budget Builder"
      description="Define SLO targets, log burn events, and watch the rolling error-budget consumption per service-level objective."
      category="Engineering Excellence"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="slo-builder"
          csvData={{
            headers: [
              "SLO",
              "Target",
              "Window (days)",
              "SLI",
              "Budget (min)",
              "Consumed (min)",
              "Remaining %",
              "Description",
            ],
            rows: sloRows.map(({ slo, budget, consumed, remainingPct }) => [
              slo.name,
              slo.target,
              slo.windowDays,
              slo.sliDescription,
              budget.toFixed(2),
              consumed.toFixed(2),
              remainingPct.toFixed(2),
              slo.description ?? "",
            ]),
          }}
          jsonData={state}
        />
      </ActionRow>

      {atRiskSlos.length > 0 && (
        <CalloutAlert tone="danger" className="mb-4">
          <strong>Error budget alert:</strong>{" "}
          {atRiskSlos
            .map(({ slo, remainingPct, burned }) =>
              burned
                ? `${slo.name} (BURNED)`
                : `${slo.name} (${remainingPct.toFixed(0)}% remaining)`
            )
            .join(", ")}
        </CalloutAlert>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <SectionCard title="Define an SLO" icon={Plus} titleSize="lg">
          <div className="space-y-3">
            <div>
              <Label htmlFor="slo-name" className="text-xs text-sub">
                Name
              </Label>
              <Input
                id="slo-name"
                value={sloDraft.name}
                onChange={(e) => setSloDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="checkout-availability"
                className="bg-surface border-border"
              />
            </div>
            <div>
              <Label htmlFor="slo-sli" className="text-xs text-sub">
                SLI description
              </Label>
              <Input
                id="slo-sli"
                value={sloDraft.sliDescription}
                onChange={(e) => setSloDraft((d) => ({ ...d, sliDescription: e.target.value }))}
                placeholder="Successful HTTP 2xx responses to /checkout"
                className="bg-surface border-border"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <NumericField
                id="slo-target"
                label="Target (%)"
                value={sloDraft.targetPct}
                onChange={(v) => setSloDraft((d) => ({ ...d, targetPct: v }))}
                placeholder="99.9"
              />
              <NumericField
                id="slo-window"
                label="Window (days)"
                value={sloDraft.windowDays}
                onChange={(v) => setSloDraft((d) => ({ ...d, windowDays: v }))}
                placeholder="30"
              />
            </div>
            {/* Suggested error budget chip — translates the predicted budget
                (in minutes) into the matching target%/window-days pair.
                Window is fixed at 30 days here because the default predictor
                returns ~43min for 99.9 % over 30d; we derive target% from the
                budget to keep the trio internally consistent. */}
            <SmartInput<number>
              predicted={budgetPrediction}
              onAccept={(budgetMinutes) => {
                // BUG-T8-slo-builder-1: honour the user's typed
                // windowDays. The previous hard-coded `30` silently
                // overwrote what the user had typed (e.g., a 7-day
                // window) and back-derived targetPct against the wrong
                // denominator. Fall back to 30 only when the field is
                // blank/invalid.
                const typedWindow = parseInt(sloDraft.windowDays, 10);
                const windowDays =
                  Number.isFinite(typedWindow) && typedWindow > 0 ? typedWindow : 30;
                const totalMinutes = windowDays * 24 * 60;
                const targetPct =
                  totalMinutes > 0 ? (1 - budgetMinutes / totalMinutes) * 100 : 99.9;
                setSloDraft((d) => ({
                  ...d,
                  // Round to one decimal so 99.9 stays 99.9, not 99.90046…
                  targetPct: (Math.round(targetPct * 10) / 10).toString(),
                  windowDays: windowDays.toString(),
                }));
              }}
              render={({ chip }) => <div>{chip}</div>}
            />
            <div>
              <Label htmlFor="slo-desc" className="text-xs text-sub">
                Description (optional)
              </Label>
              <Textarea
                id="slo-desc"
                value={sloDraft.description}
                onChange={(e) => setSloDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Why this SLO matters / who owns it..."
                rows={2}
                className="bg-surface border-border resize-none text-xs"
              />
            </div>
            <FormErrors id="slo-errors" errors={sloErrors} />
            <Button
              onClick={addSlo}
              aria-describedby={sloErrors.length > 0 ? "slo-errors" : undefined}
              className="gap-2 bg-accent text-bg hover:bg-accent/90 w-full"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Add SLO
            </Button>
          </div>
        </SectionCard>

        <SectionCard title="Log a burn event" icon={AlertTriangle} titleSize="lg">
          {state.slos.length === 0 ? (
            <p className="text-sm text-sub">Define an SLO first to start logging burn events.</p>
          ) : (
            <div className="space-y-3">
              <div>
                <Label htmlFor="burn-slo" className="text-xs text-sub">
                  SLO
                </Label>
                <Select
                  value={burnDraft.sloId}
                  onValueChange={(v) => setBurnDraft((b) => ({ ...b, sloId: v }))}
                >
                  <SelectTrigger id="burn-slo" className="bg-surface border-border">
                    <SelectValue placeholder="Select an SLO" />
                  </SelectTrigger>
                  <SelectContent>
                    {state.slos.map((slo) => (
                      <SelectItem key={slo.id} value={slo.id}>
                        {slo.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="burn-date" className="text-xs text-sub">
                    Date
                  </Label>
                  <Input
                    id="burn-date"
                    type="date"
                    value={burnDraft.date}
                    onChange={(e) => setBurnDraft((b) => ({ ...b, date: e.target.value }))}
                    className="bg-surface border-border"
                  />
                </div>
                <NumericField
                  id="burn-minutes"
                  label="Error minutes"
                  value={burnDraft.errorMinutes}
                  onChange={(v) => setBurnDraft((b) => ({ ...b, errorMinutes: v }))}
                  placeholder="e.g. 4.5"
                />
              </div>
              <FormErrors id="burn-errors" errors={burnErrors} />
              <Button
                onClick={addBurn}
                aria-describedby={burnErrors.length > 0 ? "burn-errors" : undefined}
                className="gap-2 bg-accent text-bg hover:bg-accent/90 w-full"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                Log burn
              </Button>
            </div>
          )}
        </SectionCard>
      </div>

      {sloRows.length > 0 && (
        <SectionCard title="SLO snapshot" icon={Target} titleSize="lg" className="mt-6">
          <div className="space-y-3">
            {sloRows.map(({ slo, budget, consumed, remainingPct, atRisk, burned }) => {
              const tone: "danger" | "warning" | "default" = burned
                ? "danger"
                : atRisk
                  ? "warning"
                  : "default";
              const cardCls =
                tone === "danger"
                  ? "border-danger/40 bg-danger/5"
                  : tone === "warning"
                    ? "border-warning/40 bg-warning/5"
                    : "border-border bg-surface";
              return (
                <div key={slo.id} className={`rounded-lg border p-3 ${cardCls}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-text">{slo.name}</div>
                      <div className="text-xs text-sub mt-0.5">SLI: {slo.sliDescription}</div>
                      {slo.description && (
                        <div className="text-xs text-sub mt-1 italic break-words whitespace-pre-wrap">
                          {slo.description}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeSlo(slo.id)}
                      aria-label={`Remove ${slo.name}`}
                      className="h-7 w-7 p-0 text-sub hover:text-danger"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                    <div>
                      <div className="text-sub uppercase tracking-wider">Target</div>
                      <div className="font-data text-text">{(slo.target * 100).toFixed(2)}%</div>
                      <div className="text-sub">{slo.windowDays}-day window</div>
                    </div>
                    <div>
                      <div className="text-sub uppercase tracking-wider">Budget</div>
                      <div className="font-data text-text">{budget.toFixed(1)} min</div>
                      <div className="text-sub">{consumed.toFixed(1)} consumed</div>
                    </div>
                    <div>
                      <div className="text-sub uppercase tracking-wider">Remaining</div>
                      <div
                        className={`font-data ${
                          burned ? "text-danger" : atRisk ? "text-warning" : "text-success"
                        }`}
                      >
                        {remainingPct.toFixed(1)}%
                      </div>
                      <div className="text-sub">
                        {burned ? "Budget burned" : atRisk ? "At risk" : "Healthy"}
                      </div>
                    </div>
                  </div>
                  {/* Progress bar for visual scan. */}
                  <div className="mt-3 h-1.5 rounded-full bg-bg overflow-hidden">
                    <div
                      className={`h-full ${
                        burned ? "bg-danger" : atRisk ? "bg-amber-400" : "bg-emerald-400"
                      }`}
                      style={{ width: `${Math.max(0, Math.min(100, 100 - remainingPct))}%` }}
                      aria-hidden="true"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {chartData.length > 0 && (
        <>
          <ChartCard title="Cumulative error consumption" height={320} className="mt-6">
            <CumulativeErrorChart
              data={chartData}
              series={state.slos}
              annotations={burnAnalytics?.annotations}
            />
          </ChartCard>

          {burnAnalytics && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {/* Mann-Kendall trend chip on the burn series. */}
              <Badge
                variant="outline"
                className={`font-mono text-xs tracking-wider uppercase ${
                  !burnAnalytics.mk.significant || burnAnalytics.mk.trend === "none"
                    ? "text-sub border-border"
                    : burnAnalytics.mk.trend === "up"
                      ? "border-warning/40 text-warning bg-warning/10"
                      : "border-success/40 text-success bg-success/10"
                }`}
              >
                {burnAnalytics.sloName} burn{" "}
                {!burnAnalytics.mk.significant || burnAnalytics.mk.trend === "none"
                  ? "flat"
                  : burnAnalytics.mk.trend === "up"
                    ? "↗ significant"
                    : "↘ significant"}
              </Badge>
              {burnAnalytics.projection && (
                <CalloutAlert tone="info" className="m-0 flex-1 min-w-[260px]">
                  <span className="text-xs">
                    <strong>Projected end-of-window remaining ({burnAnalytics.sloName}):</strong>{" "}
                    {burnAnalytics.projection.remainingMin.toFixed(1)} min{" "}
                    <span className="text-sub">
                      (80% CI {burnAnalytics.projection.ciLowMin.toFixed(1)}–
                      {burnAnalytics.projection.ciHighMin.toFixed(1)},{" "}
                      {burnAnalytics.projection.horizonDays}d horizon, confidence{" "}
                      {burnAnalytics.projection.confidence})
                    </span>
                  </span>
                </CalloutAlert>
              )}
            </div>
          )}
        </>
      )}
    </ToolPageWrapper>
  );
}

/** Why the form above can't be submitted yet; renders nothing when valid. */
function FormErrors({ id, errors }: { id: string; errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <div id={id} role="alert" className="text-xs text-danger space-y-0.5">
      {errors.map((e) => (
        <p key={e}>{e}</p>
      ))}
    </div>
  );
}

/**
 * String-draft numeric field (commit on blur / Enter). Keeps the cursor
 * stable while users type — no mid-edit clamp.
 */
function NumericField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  // R-DRAFT: track the last value we synced from props. A parent re-render
  // that ships the same `value` would otherwise clobber the user's in-flight
  // typing — both because of the effect and because focused inputs should
  // never be reset under the cursor.
  const lastCommittedRef = useRef(value);
  useEffect(() => {
    if (document.activeElement === inputRef.current) return;
    if (value === lastCommittedRef.current) return;
    setDraft(value);
    lastCommittedRef.current = value;
  }, [value]);
  return (
    <div>
      <Label htmlFor={id} className="text-xs text-sub">
        {label}
      </Label>
      <Input
        id={id}
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          lastCommittedRef.current = draft;
          onChange(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            lastCommittedRef.current = draft;
            onChange(draft);
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={placeholder}
        className="bg-surface border-border font-data"
      />
    </div>
  );
}
