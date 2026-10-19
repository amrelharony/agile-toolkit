"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useMemo, useState, useRef } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
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
import { Plus, Trash2, BarChart as BarIcon } from "lucide-react";
import type { CausalAnnotationData } from "@/components/charts/causal-annotation";
import { zScoreAnomalies } from "@/lib/analytics/anomaly";
import { cusum } from "@/lib/analytics/changepoint";
import { mannKendall } from "@/lib/analytics/trend-test";
import { generateNpsCsatPrompts } from "@/lib/ai-prompts/nps-csat";
import { emit as sonify } from "@/lib/sonification/emit";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { NpsResponse } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { NPS_CSAT_ACTIONS } from "@/lib/history/event-actions";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { ChartFigure } from "@/components/shared/chart-card";
import { scoreTrendText } from "./chart-text";
import { buildScoreTrend } from "./trend";

// Recharts loads with the score trend chart, not the page. The placeholder
// matches the chart's fixed 240px height so the card doesn't jump.
const ScoreTrendChart = dynamic(() => import("./charts").then((m) => m.ScoreTrendChart), {
  ssr: false,
  loading: () => (
    <div className="h-[240px] w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

type Kind = "nps" | "csat";

interface Entry {
  id: string;
  kind: Kind;
  date: string;
  score: number;
  respondent?: string;
  verbatim?: string;
}

function npsCategory(score: number): "promoter" | "passive" | "detractor" {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

function npsScore(entries: Entry[]): number {
  const nps = entries.filter((e) => e.kind === "nps");
  if (nps.length === 0) return 0;
  const promoters = nps.filter((e) => e.score >= 9).length;
  const detractors = nps.filter((e) => e.score <= 6).length;
  return Math.round(((promoters - detractors) / nps.length) * 100);
}

function csatAvg(entries: Entry[]): number {
  const csat = entries.filter((e) => e.kind === "csat");
  if (csat.length === 0) return 0;
  return csat.reduce((a, b) => a + b.score, 0) / csat.length;
}

// The persisted draft skeleton — note that `id` is intentionally NOT generated
// here. Generating an id at draft-init time means rapid back-to-back submits
// could share an id (and thus collapse to a single entry). We assign the id
// inside `add()` instead.
type Draft = Omit<Entry, "id">;

export function NpsCsatClient() {
  // Synced workspace collection (was isolated localStorage), so MCP-recorded
  // responses round-trip into the UI. setEntries mirrors the old [value,
  // setter] API (value or updater) over the slice. NpsResponse is structurally
  // identical to the local Entry type.
  const entries = useWorkspaceStore(useShallow((s) => (s.npsResponses ?? []) as Entry[]));
  const setEntries = (updater: Entry[] | ((prev: Entry[]) => Entry[])) => {
    const cur = (useWorkspaceStore.getState().npsResponses ?? []) as Entry[];
    const next = typeof updater === "function" ? updater(cur) : updater;
    useWorkspaceStore.setState({ npsResponses: next as NpsResponse[] });
  };
  const [draft, setDraft] = useState<Draft>(() => ({
    kind: "nps",
    date: todayLocalISO(),
    score: 8,
  }));
  // String-backed score input so typing 1-5 inside an NPS field doesn't snap
  // back to a clamped value mid-edit. We commit on blur (or Enter).
  const [scoreDraft, setScoreDraft] = useState<string>(String(8));
  useEffect(() => setScoreDraft(String(draft.score)), [draft.score]);
  const chartRef = useRef<HTMLDivElement>(null);
  const { log } = useHistoryLogger("nps-csat");

  const commitScore = () => {
    const n = Number(scoreDraft);
    if (Number.isFinite(n)) {
      const min = draft.kind === "nps" ? 0 : 1;
      const max = draft.kind === "nps" ? 10 : 5;
      const clamped = Math.max(min, Math.min(max, n));
      setDraft((d) => ({ ...d, score: clamped }));
      setScoreDraft(String(clamped));
    } else {
      // Reject non-numeric input — fall back to whatever was committed last.
      setScoreDraft(String(draft.score));
    }
  };

  const add = () => {
    if (draft.kind === "nps") {
      if (draft.score >= 9) sonify("nps-csat", "score-promoter");
      else if (draft.score >= 7) sonify("nps-csat", "score-passive");
      else sonify("nps-csat", "score-detractor");
    } else {
      if (draft.score >= 4) sonify("nps-csat", "score-promoter");
      else if (draft.score >= 3) sonify("nps-csat", "score-passive");
      else sonify("nps-csat", "score-detractor");
    }
    // Generate the id at submit time so two rapid clicks can never share it.
    const entry: Entry = { ...draft, id: nanoid(6) };
    setEntries((e) => [...e, entry]);
    log(NPS_CSAT_ACTIONS.SURVEY_ADDED, {
      kind: entry.kind,
      score: entry.score,
      date: entry.date,
    });
    setDraft({
      kind: draft.kind,
      date: todayLocalISO(),
      score: draft.kind === "nps" ? 8 : 4,
    });
  };
  const remove = (id: string) => {
    const removed = entries.find((e) => e.id === id);
    setEntries((e) => e.filter((x) => x.id !== id));
    log(NPS_CSAT_ACTIONS.SURVEY_REMOVED, {
      kind: removed?.kind,
      score: removed?.score,
    });
  };

  const nps = useMemo(() => npsScore(entries), [entries]);
  const csat = useMemo(() => csatAvg(entries), [entries]);
  const npsCount = useMemo(() => entries.filter((e) => e.kind === "nps").length, [entries]);
  const csatCount = useMemo(() => entries.filter((e) => e.kind === "csat").length, [entries]);

  // Per-date NPS (% promoters − % detractors) and average CSAT.
  const trendData = useMemo(() => buildScoreTrend(entries), [entries]);
  // The trend chart in words: a summary sentence and the scores as a table.
  const trendText = useMemo(() => scoreTrendText(trendData), [trendData]);
  const trendTitleId = useId();

  const anomalies = useMemo(() => {
    const scores = entries.filter((e) => e.kind === "nps").map((e) => e.score);
    return zScoreAnomalies(scores, 2);
  }, [entries]);

  /* ── Phase-15 analytics ───────────────────────────────────────────────── */
  // Per-date NPS / CSAT series used by CUSUM and the Mann-Kendall trend
  // chips. Built from trendData so the markers align with the line chart.
  const npsSeries = useMemo(
    () =>
      trendData
        .filter((d): d is typeof d & { nps: number } => typeof d.nps === "number")
        .map((d) => ({ date: d.date, value: d.nps })),
    [trendData]
  );
  const csatSeries = useMemo(
    () =>
      trendData
        .filter((d): d is typeof d & { csat: number } => typeof d.csat === "number")
        .map((d) => ({ date: d.date, value: d.csat })),
    [trendData]
  );

  const npsValues = useMemo(() => npsSeries.map((d) => d.value), [npsSeries]);
  const csatValues = useMemo(() => csatSeries.map((d) => d.value), [csatSeries]);

  const npsChangepoints = useMemo<CausalAnnotationData[]>(() => {
    if (npsValues.length < 4) return [];
    return cusum(npsValues).map((cp) => ({
      x: npsSeries[cp.index]?.date ?? String(cp.index),
      label: `NPS ${cp.direction === "up" ? "↑ regime" : "↓ regime"}`,
      detail: `CUSUM detected a sustained ${cp.direction === "up" ? "lift" : "drop"} in NPS at ${npsSeries[cp.index]?.date}.`,
      confidence: cp.cumulativeStat >= 6 ? "strong" : "moderate",
    }));
  }, [npsValues, npsSeries]);

  const csatChangepoints = useMemo<CausalAnnotationData[]>(() => {
    if (csatValues.length < 4) return [];
    return cusum(csatValues).map((cp) => ({
      x: csatSeries[cp.index]?.date ?? String(cp.index),
      label: `CSAT ${cp.direction === "up" ? "↑ regime" : "↓ regime"}`,
      detail: `CUSUM detected a sustained ${cp.direction === "up" ? "lift" : "drop"} in CSAT at ${csatSeries[cp.index]?.date}.`,
      confidence: cp.cumulativeStat >= 6 ? "strong" : "moderate",
    }));
  }, [csatValues, csatSeries]);

  const npsTrend = useMemo(
    () => (npsValues.length >= 5 ? mannKendall(npsValues) : null),
    [npsValues]
  );
  const csatTrend = useMemo(
    () => (csatValues.length >= 5 ? mannKendall(csatValues) : null),
    [csatValues]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "NPS/CSAT Tracker",
      prompts: generateNpsCsatPrompts({ entries, nps, csat }),
    }),
    [entries, nps, csat]
  );

  return (
    <ToolPageWrapper
      toolId="nps-csat"
      title="NPS / CSAT Tracker"
      description="Collect Net Promoter Scores and Customer Satisfaction over time with anomaly detection."
      category="Outcomes & Pulse"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="nps-csat"
          csvData={{
            headers: ["Date", "Kind", "Score", "Respondent", "Verbatim"],
            rows: entries.map((e) => [
              e.date,
              e.kind,
              e.score,
              e.respondent ?? "",
              e.verbatim ?? "",
            ]),
          }}
          jsonData={entries}
          // Only expose PNG export when the chart is actually rendered. The
          // ExportButton shows the PNG menu item whenever `targetRef` is
          // truthy, so dropping it to `undefined` (rather than passing a ref
          // that points at nothing) is what hides the button cleanly.
          targetRef={trendData.length > 0 ? chartRef : undefined}
        />
      </ActionRow>

      <KpiGrid cols={3} gap="lg">
        <StatCard
          variant="compact"
          label="NPS"
          // Show "—" when there are no NPS entries — `0` is a valid score, so
          // a literal `0` here would look indistinguishable from "no data".
          value={npsCount > 0 ? nps : "—"}
          valueClassName="text-4xl text-accent"
          hint={`${npsCount} responses`}
        />
        <StatCard
          variant="compact"
          label="CSAT"
          value={csatCount > 0 ? csat.toFixed(1) : "—"}
          valueClassName="text-4xl text-accent"
          hint={`${csatCount} responses (1-5)`}
        />
        <StatCard
          variant="compact"
          label="Anomalies"
          value={anomalies.length}
          valueClassName="text-4xl text-text"
          hint="z-score > 2 in NPS scores"
        />
      </KpiGrid>

      <Card className="bg-surface border-border mb-6">
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-semibold text-text flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Add response
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[minmax(100px,1fr)_minmax(120px,1fr)_minmax(100px,1fr)_2fr_auto] gap-2">
            <Select
              value={draft.kind}
              // Re-clamp on kind change: clamping otherwise only happens in
              // `commitScore` (score input blur/Enter). Switching to CSAT and
              // hitting Add without ever focusing the score field would save
              // the NPS default of 8 as a CSAT score, rendering "8.0" under a
              // "(1-5)" hint. The [draft.score] effect resyncs `scoreDraft`.
              onValueChange={(v) =>
                setDraft((d) => {
                  const kind = v as Kind;
                  const min = kind === "nps" ? 0 : 1;
                  const max = kind === "nps" ? 10 : 5;
                  return { ...d, kind, score: Math.max(min, Math.min(max, d.score)) };
                })
              }
            >
              <SelectTrigger className="bg-bg border-border" aria-label="Survey type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nps">NPS (0-10)</SelectItem>
                <SelectItem value="csat">CSAT (1-5)</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={draft.date}
              onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
              className="bg-bg border-border"
              aria-label="Response date"
            />
            <Input
              type="number"
              min={draft.kind === "nps" ? 0 : 1}
              max={draft.kind === "nps" ? 10 : 5}
              value={scoreDraft}
              onChange={(e) => setScoreDraft(e.target.value)}
              onBlur={commitScore}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="bg-bg border-border font-data"
              aria-label={draft.kind === "nps" ? "Score (0–10)" : "Score (1–5)"}
            />
            <Input
              value={draft.respondent ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, respondent: e.target.value }))}
              placeholder="Respondent (optional)"
              className="bg-bg border-border"
              aria-label="Respondent (optional)"
            />
            <Button onClick={add} className="gap-2 bg-accent text-bg hover:bg-accent/90">
              <Plus className="w-4 h-4" />
              Add
            </Button>
          </div>
          <Textarea
            rows={2}
            value={draft.verbatim ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, verbatim: e.target.value }))}
            placeholder="Verbatim comment (optional)"
            className="bg-bg border-border"
            aria-label="Verbatim comment (optional)"
          />
        </CardContent>
      </Card>

      {trendData.length > 0 && (
        <Card className="bg-surface border-border mb-6">
          <CardContent className="p-4" ref={chartRef as React.RefObject<HTMLDivElement>}>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <BarIcon className="w-4 h-4 text-accent" />
              <h3 id={trendTitleId} className="text-sm font-semibold text-text">
                Score Trend
              </h3>
              {npsTrend?.significant && (
                <span
                  className={`text-xs font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                    // For NPS, "up" trend is good, "down" is bad.
                    npsTrend.trend === "up"
                      ? "border-accent-green/40 text-accent-green bg-accent-green/10"
                      : "border-warning/40 text-warning bg-warning/10"
                  }`}
                  aria-label={`NPS trend ${npsTrend.trend} (Mann-Kendall p=${npsTrend.pValue.toFixed(3)})`}
                  title={`Mann-Kendall p=${npsTrend.pValue.toFixed(3)}`}
                >
                  NPS {npsTrend.trend === "up" ? "↗" : "↘"}
                </span>
              )}
              {csatTrend?.significant && (
                <span
                  className={`text-xs font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                    csatTrend.trend === "up"
                      ? "border-accent-green/40 text-accent-green bg-accent-green/10"
                      : "border-warning/40 text-warning bg-warning/10"
                  }`}
                  aria-label={`CSAT trend ${csatTrend.trend} (Mann-Kendall p=${csatTrend.pValue.toFixed(3)})`}
                  title={`Mann-Kendall p=${csatTrend.pValue.toFixed(3)}`}
                >
                  CSAT {csatTrend.trend === "up" ? "↗" : "↘"}
                </span>
              )}
            </div>
            <ChartFigure
              labelledBy={trendTitleId}
              summary={trendText.summary}
              table={trendText.table}
            >
              <ScoreTrendChart
                data={trendData}
                npsChangepoints={npsChangepoints}
                csatChangepoints={csatChangepoints}
              />
            </ChartFigure>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {entries
          .slice()
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((e) => (
            <div
              key={e.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3"
            >
              <span className="text-xs text-sub font-data w-24">{e.date}</span>
              <span className="text-xs uppercase tracking-wider w-14 text-accent">{e.kind}</span>
              <span className="font-data text-text w-10">{e.score}</span>
              {e.kind === "nps" && (
                <span
                  className={`text-xs uppercase tracking-wider w-20 ${
                    npsCategory(e.score) === "promoter"
                      ? "text-success"
                      : npsCategory(e.score) === "passive"
                        ? "text-warning"
                        : "text-danger"
                  }`}
                >
                  {npsCategory(e.score)}
                </span>
              )}
              <span className="text-sm text-text/80 flex-1 truncate">
                {e.verbatim || e.respondent || "—"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove(e.id)}
                className="text-sub hover:text-danger"
                aria-label={`Remove ${e.kind.toUpperCase()} response from ${e.date}`}
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </Button>
            </div>
          ))}
      </div>
    </ToolPageWrapper>
  );
}
