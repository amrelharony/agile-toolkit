"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import dynamic from "next/dynamic";
import { CircleDollarSign, Plus, Trash2, AlertTriangle, Sparkles } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TokenSpend, Workspace } from "@/lib/stores/workspace-types";
import { generateTokenCostPrompts } from "@/lib/ai-prompts/token-cost-tracker";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { TOKEN_COST_ACTIONS } from "@/lib/history/event-actions";
import { todayLocalISO } from "@/lib/utils/formatters";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
import { MODELS_BY_PROVIDER, estimateCostUsd } from "@/lib/llm/pricing";
import type { ProviderId } from "@/lib/llm/types";

// Recharts loads with the chart, not the page; the placeholder fills the
// chart's fixed-height box while it does.
const DailySpendChart = dynamic(() => import("./charts").then((m) => m.DailySpendChart), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

/**
 * BUG-T9-token-cost-tracker-1: look up a model by its id across every
 * provider in the price table. Returns the (provider, model.id) pair
 * needed by `estimateCostUsd`. Case-insensitive exact match first,
 * substring fallback only when EXACTLY ONE model id contains the
 * needle.
 *
 * BUG-RD3-token-cost-tracker-1: previously the substring fallback
 * iterated providers in `Object.entries` order and returned the FIRST
 * `.includes(want)` hit. Typing "gpt-4" would silently lock onto
 * "gpt-4o" (or whichever id contained "gpt-4" first), applying that
 * model's pricing without warning. Require exactly one match —
 * otherwise return null and let the user pick the precise id.
 */
function findModelEverywhere(needle: string): { provider: ProviderId; modelId: string } | null {
  if (!needle.trim()) return null;
  const want = needle.trim().toLowerCase();
  for (const [provider, models] of Object.entries(MODELS_BY_PROVIDER) as Array<
    [ProviderId, ReadonlyArray<{ id: string }>]
  >) {
    for (const m of models) {
      if (m.id.toLowerCase() === want) return { provider, modelId: m.id };
    }
  }
  // Substring fallback — only accept when unambiguous.
  const matches: Array<{ provider: ProviderId; modelId: string }> = [];
  for (const [provider, models] of Object.entries(MODELS_BY_PROVIDER) as Array<
    [ProviderId, ReadonlyArray<{ id: string }>]
  >) {
    for (const m of models) {
      if (m.id.toLowerCase().includes(want)) matches.push({ provider, modelId: m.id });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

/** The spend log table shows this many of the most recent entries. */
const SPEND_LOG_ROWS = 50;

interface Cfg {
  monthlyBudgetUsd: number;
}
const useCfg = create<Cfg & { setBudget: (v: number) => void }>()(
  persist((set) => ({ monthlyBudgetUsd: 1000, setBudget: (v) => set({ monthlyBudgetUsd: v }) }), {
    name: "agile-toolkit:token-cost-cfg",
    storage: safeJSONStorage("token-cost-cfg"),
  })
);

/**
 * Local-draft budget input. BUG-RD3-token-cost-tracker-4: the prior
 * code wrote to the persisted cfg store on every keystroke, so typing
 * "1500" momentarily set the budget to 1 → 15 → 150 → 1500 and
 * flickered the over-budget banner / alert badge in between (one
 * localStorage write per character). Hold a string draft, commit on
 * blur / Enter only.
 */
function BudgetInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = parseFloat(draft);
    if (Number.isFinite(n) && n >= 0 && n !== value) {
      onCommit(n);
    } else if (!Number.isFinite(n)) {
      // Invalid input — revert the draft to the live value.
      setDraft(String(value));
    }
  };
  return (
    <Input
      type="number"
      min="0"
      step="50"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="max-w-[160px]"
      aria-label="Monthly budget USD"
    />
  );
}

export function TokenCostTrackerClient() {
  const list = useWorkspaceStore((s) => s.tokenSpend ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertTokenSpend);
  const removeOne = useWorkspaceStore((s) => s.removeTokenSpend);
  const cfg = useCfg();
  const { log } = useHistoryLogger("token-cost-tracker");
  const exportRef = useRef<HTMLDivElement>(null);

  const [feature, setFeature] = useState("");
  const [model, setModel] = useState("");
  // R5: `new Date().toISOString().slice(0, 10)` is the UTC date. In
  // non-UTC zones near midnight it produced "tomorrow" or "yesterday"
  // relative to the user's local day. Use the local-day helper.
  const [date, setDate] = useState(todayLocalISO());
  const [inputTokens, setInputTokens] = useState("");
  const [outputTokens, setOutputTokens] = useState("");
  const [costUsd, setCostUsd] = useState("");

  // Log used to do nothing, with no message, when an entry couldn't be
  // costed. After a failed attempt the reason shows under the form and
  // updates as the fields change.
  const [attempted, setAttempted] = useState(false);
  const logErrorId = useId();

  /** The entry's cost, or why it can't be logged yet. */
  function resolveEntry(): { cost: number; error?: undefined } | { error: string } {
    const it = parseFloat(inputTokens),
      ot = parseFloat(outputTokens);
    let c = parseFloat(costUsd);
    if (!feature.trim()) return { error: "Enter the feature this spend belongs to." };
    if (!model.trim()) return { error: "Enter the model that was used." };
    // Reject obviously-bad inputs at the entry point: negative tokens / cost
    // would otherwise sneak into totals and the projection (which is the
    // budget signal), where a single typo turns the alert green forever.
    if (Number.isFinite(c) && c < 0) return { error: "Cost can't be negative." };
    // BUG-T9-token-cost-tracker-1: if the user left `costUsd` blank but
    // typed token counts AND a known model, derive cost from the price
    // table instead of forcing them to type it. Keeps the user-typed
    // override when present (CSV-imported rows, custom-model pricing).
    if (!Number.isFinite(c) || c <= 0) {
      const hit = findModelEverywhere(model);
      const tokensOk = Number.isFinite(it) && it >= 0 && Number.isFinite(ot) && ot >= 0;
      if (hit && tokensOk) c = estimateCostUsd(hit.provider, hit.modelId, it, ot);
      else if (!Number.isFinite(c)) {
        return {
          error: hit
            ? "Enter the input and output tokens so the cost can be worked out from the price table, or type the Cost in USD."
            : `“${model.trim()}” isn't in the price table, so the cost can't be worked out. Type the Cost in USD.`,
        };
      }
    }
    return { cost: c };
  }
  const logError = attempted ? resolveEntry().error : undefined;

  function add() {
    const resolved = resolveEntry();
    if (resolved.error !== undefined) {
      setAttempted(true);
      return;
    }
    const it = parseFloat(inputTokens),
      ot = parseFloat(outputTokens);
    const c = resolved.cost;
    const item: TokenSpend = {
      id: crypto.randomUUID(),
      feature: feature.trim(),
      model: model.trim(),
      date,
      inputTokens: Number.isFinite(it) && it >= 0 ? it : 0,
      outputTokens: Number.isFinite(ot) && ot >= 0 ? ot : 0,
      costUsd: c,
    };
    upsert(item);
    log(TOKEN_COST_ACTIONS.SPEND_LOGGED, { feature: item.feature, costUsd: item.costUsd });
    setInputTokens("");
    setOutputTokens("");
    setCostUsd("");
    setAttempted(false);
  }

  // Live preview of the auto-derived cost so the user knows when leaving
  // costUsd blank will be filled in.
  const previewCost: number | null = useMemo(() => {
    const it = parseFloat(inputTokens);
    const ot = parseFloat(outputTokens);
    if (!Number.isFinite(it) || !Number.isFinite(ot) || it < 0 || ot < 0) return null;
    const hit = findModelEverywhere(model);
    if (!hit) return null;
    return estimateCostUsd(hit.provider, hit.modelId, it, ot);
  }, [model, inputTokens, outputTokens]);

  function remove(id: string) {
    removeOne(id);
    log(TOKEN_COST_ACTIONS.SPEND_REMOVED, { id });
  }

  // Roll up to daily totals for chart
  const dailyData = useMemo(() => {
    const byDay: Record<string, { date: string; cost: number; tokens: number }> = {};
    for (const x of list) {
      if (!byDay[x.date]) byDay[x.date] = { date: x.date, cost: 0, tokens: 0 };
      byDay[x.date].cost += x.costUsd;
      byDay[x.date].tokens += x.inputTokens + x.outputTokens;
    }
    return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
  }, [list]);

  const featureBreakdown = useMemo(() => {
    const m: Record<string, number> = {};
    for (const x of list) m[x.feature] = (m[x.feature] ?? 0) + x.costUsd;
    return Object.entries(m)
      .map(([feature, cost]) => ({ feature, cost }))
      .sort((a, b) => b.cost - a.cost);
  }, [list]);

  // Guard against NaN in totals: a corrupted persisted entry with non-finite
  // costUsd would otherwise poison every downstream KPI and the budget badge.
  const totalSpend = list.reduce((s, x) => s + (Number.isFinite(x.costUsd) ? x.costUsd : 0), 0);
  const last30Spend = useMemo(() => {
    // R5: previously mixed UTC date strings with local-time entries from
    // the user input. Use local-day strings consistently so an entry
    // logged at 11pm local on day-of-cutoff isn't silently filtered out.
    // BUG-RD3-token-cost-tracker-2: cutoff was `today - 30 days`, which
    // makes the inclusive `>= cutoff && <= today` filter cover 31 days,
    // not 30 — the headline "Last 30d" KPI was 1/31 too low. Use 29 so
    // the inclusive window is exactly 30 calendar days.
    const today = todayLocalISO();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 29);
    const cutoff = todayLocalISO(cutoffDate);
    // Bound the window on BOTH sides — without an upper bound, future-dated
    // entries (typos like 2099-01-01, or imports from a wrong-locale ISO
    // export) would inflate the "last 30 days" projection used by the budget
    // alert. The CSV import path doesn't validate dates, so this is reachable.
    return list
      .filter((x) => x.date >= cutoff && x.date <= today)
      .reduce((s, x) => s + (Number.isFinite(x.costUsd) ? x.costUsd : 0), 0);
  }, [list]);
  // BUG-T9-token-cost-tracker-5: scale `projected` to a full 30-day
  // window. The prior `projected = last30Spend` reported raw observed
  // spend, so a user tracking for only 5 days at $50/day saw projected
  // = $250 — comfortably under a $1000 monthly budget — even though
  // the actual annualised burn would be ~$1500. Compute days-observed
  // from the earliest entry in the window (capped at 30), and
  // extrapolate per-day-rate × 30.
  const projected = useMemo(() => {
    if (last30Spend === 0) return 0;
    // BUG-RD3-token-cost-tracker-3a: use the SAME local-day string
    // filter as `last30Spend` above. The prior code switched to
    // `Date.parse(x.date)` UTC milliseconds vs `cutoffDate.getTime()`
    // (a local-now-minus-30d ms), so the two filters disagreed near
    // the boundary — `dates.length===0` could be true while
    // `last30Spend>0`, silently returning the un-annualised fallback
    // and under-reporting projected burn.
    // BUG-RD3-token-cost-tracker-3b: replace `Math.min(...dates)` with
    // a reduce. Spreading a large array hits the V8 arg-count cap and
    // throws `RangeError`, killing the projection memo (and the whole
    // page) once the user accumulates a few thousand auto-logged rows.
    const today = todayLocalISO();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 29);
    const cutoff = todayLocalISO(cutoffDate);
    const dateStrings = list
      .filter((x) => Number.isFinite(x.costUsd) && x.date >= cutoff && x.date <= today)
      .map((x) => x.date);
    if (dateStrings.length === 0) return last30Spend;
    const earliestStr = dateStrings.reduce((min, d) => (d < min ? d : min), dateStrings[0]);
    // Parse the earliest local date string as a local Date (not UTC), then
    // compare against local "today" so the day-count is in the user's wall
    // clock.
    const [ey, em, ed] = earliestStr.split("-").map(Number);
    const earliestMs = new Date(ey, em - 1, ed).getTime();
    // `earliestMs` is local MIDNIGHT of the earliest entry, so the elapsed
    // span is already a partial day. `Math.ceil` rounded that partial up to 1
    // and the `+ 1` then added a second day, overstating days-observed by one
    // at every moment except exactly midnight — which HALVES the projection on
    // day one. A user who logs $50 today against a $1000 budget should project
    // $1500 and trip the over-budget banner; instead they saw $750 and no
    // warning. Inclusive day count is `floor(elapsed) + 1`.
    const daysObserved = Math.min(
      30,
      Math.max(1, Math.floor((Date.now() - earliestMs) / (1000 * 60 * 60 * 24)) + 1)
    );
    return (last30Spend / daysObserved) * 30;
  }, [last30Spend, list]);
  const overBudget = projected > cfg.monthlyBudgetUsd;

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
        tokenSpend: s.tokenSpend,
        models: s.models,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Token-Cost Tracker",
      prompts: generateTokenCostPrompts(
        { items: list, monthlyBudgetUsd: cfg.monthlyBudgetUsd },
        workspace
      ),
    }),
    [list, cfg.monthlyBudgetUsd, workspace]
  );

  const csvData = {
    headers: ["Date", "Feature", "Model", "Input tokens", "Output tokens", "Cost USD"],
    rows: list.map((x) => [x.date, x.feature, x.model, x.inputTokens, x.outputTokens, x.costUsd]),
  };

  return (
    <ToolPageWrapper
      toolId="token-cost-tracker"
      title="Token-Cost Tracker"
      description="Per-feature token spend with daily rollup, projection, and budget alerts."
    >
      <div ref={exportRef} className="space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KPI label="Total spend" value={`$${totalSpend.toFixed(2)}`} />
          <KPI label="Last 30d" value={`$${last30Spend.toFixed(2)}`} />
          <KPI
            label="Projected next 30d"
            value={`$${projected.toFixed(2)}`}
            tone={overBudget ? "danger" : "default"}
          />
          <KPI label="Monthly budget" value={`$${cfg.monthlyBudgetUsd.toFixed(0)}`} tone="ok" />
        </div>

        {overBudget && (
          <div className="rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Projected spend ${projected.toFixed(2)} exceeds monthly budget $
            {cfg.monthlyBudgetUsd.toFixed(0)}.
          </div>
        )}

        {/* Auto-tracking notice — explains where the "BYOK: ..." rows come
            from. Static, not gated on whether the user has configured a
            provider, because the row pattern is consistent regardless of
            current state (rows persist after a key is removed). */}
        <div className="rounded border border-accent/20 bg-accent/5 p-3 text-sm text-text flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-accent shrink-0 mt-0.5" />
          <span>
            <strong>Live auto-tracking is on.</strong> Every BYOK run anywhere in the toolkit
            appends a <span className="font-mono text-xs">BYOK: …</span> row here automatically —
            using the provider&apos;s actual usage payload, not an estimate. Remove individual rows
            below to exclude specific runs from your totals.
          </span>
        </div>

        <SectionCard title="Log spend" icon={Plus}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Input
              placeholder="Feature"
              aria-label="Feature"
              value={feature}
              onChange={(e) => setFeature(e.target.value)}
            />
            <Input
              placeholder="Model"
              aria-label="Model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <Input
              type="date"
              aria-label="Date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Input tokens"
              aria-label="Input tokens"
              value={inputTokens}
              onChange={(e) => setInputTokens(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Output tokens"
              aria-label="Output tokens"
              value={outputTokens}
              onChange={(e) => setOutputTokens(e.target.value)}
            />
            <Input
              type="number"
              step="0.01"
              placeholder={
                previewCost !== null ? `Cost USD (auto ≈ $${previewCost.toFixed(4)})` : "Cost USD"
              }
              aria-label="Cost USD"
              value={costUsd}
              onChange={(e) => setCostUsd(e.target.value)}
              aria-describedby={logError ? logErrorId : undefined}
            />
          </div>
          {previewCost !== null && (
            <p className="mt-2 text-xs text-sub">
              Price-table match: leave Cost blank to auto-fill with ${previewCost.toFixed(4)}. Type
              a value to override (e.g. for custom-priced model variants).
            </p>
          )}
          {logError && (
            <p id={logErrorId} role="alert" className="mt-2 text-xs text-danger">
              {logError}
            </p>
          )}
          <Button onClick={add} className="mt-3 gap-1">
            <Plus className="w-4 h-4" />
            Log
          </Button>
        </SectionCard>

        <SectionCard title="Monthly budget">
          <div className="flex items-center gap-3">
            <span className="text-sm text-sub">USD/month</span>
            <BudgetInput value={cfg.monthlyBudgetUsd} onCommit={cfg.setBudget} />
          </div>
        </SectionCard>

        {dailyData.length > 0 && (
          <SectionCard
            title="Daily spend"
            icon={CircleDollarSign}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="token-cost"
                  csvData={csvData}
                  jsonData={list}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <div className="-mx-2 h-72">
              <DailySpendChart data={dailyData} dailyBudgetUsd={cfg.monthlyBudgetUsd / 30} />
            </div>
          </SectionCard>
        )}

        {featureBreakdown.length > 0 && (
          <SectionCard title="By feature" icon={CircleDollarSign}>
            <ul className="space-y-1 text-sm">
              {featureBreakdown.map((f) => (
                <li key={f.feature} className="flex justify-between">
                  <span>{f.feature}</span>
                  <span className="font-mono">${f.cost.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}

        {list.length > 0 && (
          <SectionCard title={`Spend log (${list.length})`} icon={CircleDollarSign}>
            {list.length > SPEND_LOG_ROWS && (
              <p className="mb-2 text-xs text-sub">
                Showing the latest {SPEND_LOG_ROWS} of {list.length} entries. Totals, charts and the
                export include them all.
              </p>
            )}
            <div className="table-wrap-responsive">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-sub uppercase">
                    <th className="p-2">Date</th>
                    <th className="p-2">Feature</th>
                    <th className="p-2">Model</th>
                    <th className="p-2 text-right">Tokens</th>
                    <th className="p-2 text-right">Cost</th>
                    <th className="p-2 w-10">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...list]
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .slice(0, SPEND_LOG_ROWS)
                    .map((x) => (
                      <tr key={x.id} className="border-t border-border">
                        <td className="p-2 font-mono text-xs">{x.date}</td>
                        <td className="p-2">{x.feature}</td>
                        <td className="p-2 text-sub">{x.model}</td>
                        {/* R11-fix: NaN-guard. The add() path validates
                          inputs, but a persisted entry from an older
                          schema or corrupted localStorage can carry
                          NaN that crashes `.toLocaleString()` /
                          `.toFixed(2)` cleanly to "NaN" — but the
                          totals row uses Number.isFinite, so a corrupt
                          row mis-matches the cell vs totals readout
                          and hides the corruption from users. Render
                          a clear "—" when values aren't finite. */}
                        <td className="p-2 text-right font-mono text-xs">
                          {Number.isFinite(x.inputTokens + x.outputTokens)
                            ? (x.inputTokens + x.outputTokens).toLocaleString()
                            : "—"}
                        </td>
                        <td className="p-2 text-right font-mono">
                          {Number.isFinite(x.costUsd) ? `$${x.costUsd.toFixed(2)}` : "—"}
                        </td>
                        <td className="p-2">
                          <button
                            type="button"
                            onClick={() => remove(x.id)}
                            aria-label={`Remove spend entry: ${x.feature} on ${x.date}`}
                            className="min-touch-coarse -m-1 p-1 text-sub hover:text-danger"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
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
