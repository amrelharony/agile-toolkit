"use client";

import { useMemo, useRef, useState } from "react";
import {
  ScatterChart,
  Scatter,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  LineChart,
  Line,
  ReferenceLine,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { ChartCard } from "@/components/shared/chart-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, GitPullRequest, Clock, MessageSquare, Layers } from "lucide-react";
import { chartTheme } from "@/components/charts/chart-theme";
import { bootstrapQuantile } from "@/lib/analytics/bootstrap";
import { xmrLimits } from "@/lib/analytics/control-chart";
import { mannKendall } from "@/lib/analytics/trend-test";
import { generateCodeReviewPrompts } from "@/lib/ai-prompts/code-review-metrics";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { CODE_REVIEW_ACTIONS } from "@/lib/history/event-actions";
import { toast } from "@/lib/utils/toast";

/* ── Types ──────────────────────────────────────────────────────────────── */

interface PrSample {
  id: string;
  prNumber?: string;
  author: string;
  openedAt: string; // ISO datetime or YYYY-MM-DD
  mergedAt?: string;
  reviewerCount: number;
  commentCount: number;
  linesChanged: number;
  description?: string;
}

interface CrState {
  samples: PrSample[];
}

const DEFAULT_STATE: CrState = { samples: [] };

/* ── Helpers ────────────────────────────────────────────────────────────── */

/**
 * Hours between an "opened" and "merged" timestamp.
 *
 * Both args may be:
 *   - "datetime-local" form values (e.g. "2026-05-09T14:30") — parsed as local
 *     time by `new Date()`.
 *   - ISO 8601 with explicit Z / offset (e.g. "2026-05-09T14:30:00Z") — parsed
 *     as UTC by `new Date()`.
 *
 * Both yield the same elapsed-hours delta because we subtract the two epoch ms
 * values, so mixing the two formats inside a dataset is safe.
 */
function hoursBetween(opened: string, merged?: string): number | null {
  if (!merged) return null;
  const a = new Date(opened).getTime();
  const b = new Date(merged).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / (1000 * 60 * 60);
}

/**
 * Tiny CSV row parser: handles double-quoted cells with embedded commas /
 * escaped quotes. Not a full RFC-4180 implementation — sufficient for the
 * "paste from spreadsheet" use case the brief describes.
 */
function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else if (ch === '"') {
      inQuotes = true;
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

interface ParseResult {
  samples: PrSample[];
  skipped: number;
}

/**
 * Parse a CSV blob. Supports an optional header row (detected by the presence
 * of a recognizable text header). Required columns:
 *   prNumber, author, openedAt, mergedAt, reviewerCount, commentCount, linesChanged, description
 *
 * When a header row is present, ONLY header indices are used. Missing required
 * columns throw a descriptive error so the caller can surface a toast — no
 * positional fallback, because that silently misroutes data.
 *
 * When no header is present, positional indices are used.
 */
function parseCsv(csv: string): ParseResult {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { samples: [], skipped: 0 };

  const firstCells = parseCsvRow(lines[0]);
  let bodyStart = 0;
  let useHeader = false;
  const headerIndex: Record<string, number> = {};
  if (
    firstCells.length >= 7 &&
    firstCells.some((c) => /author|opened|merged|review/i.test(c))
  ) {
    firstCells.forEach((cell, i) => {
      headerIndex[cell.toLowerCase().replace(/\s+/g, "")] = i;
    });
    bodyStart = 1;
    useHeader = true;
  }

  const REQUIRED = [
    { key: "author", label: "author" },
    { key: "openedat", label: "openedAt" },
    { key: "reviewercount", label: "reviewerCount" },
    { key: "commentcount", label: "commentCount" },
    { key: "lineschanged", label: "linesChanged" },
  ] as const;

  let idxPrNumber: number | undefined;
  let idxAuthor: number;
  let idxOpenedAt: number;
  let idxMergedAt: number | undefined;
  let idxReviewers: number;
  let idxComments: number;
  let idxLines: number;
  let idxDescription: number | undefined;

  if (useHeader) {
    for (const { key, label } of REQUIRED) {
      if (headerIndex[key] === undefined) {
        throw new Error(`CSV header missing required column: ${label}`);
      }
    }
    idxPrNumber = headerIndex.prnumber;
    idxAuthor = headerIndex.author!;
    idxOpenedAt = headerIndex.openedat!;
    idxMergedAt = headerIndex.mergedat;
    idxReviewers = headerIndex.reviewercount!;
    idxComments = headerIndex.commentcount!;
    idxLines = headerIndex.lineschanged!;
    idxDescription = headerIndex.description;
  } else {
    idxPrNumber = 0;
    idxAuthor = 1;
    idxOpenedAt = 2;
    idxMergedAt = 3;
    idxReviewers = 4;
    idxComments = 5;
    idxLines = 6;
    idxDescription = 7;
  }

  const out: PrSample[] = [];
  let skipped = 0;
  for (let i = bodyStart; i < lines.length; i++) {
    const cells = parseCsvRow(lines[i]);
    if (cells.length < 6) {
      skipped++;
      continue;
    }
    const prNumber = (idxPrNumber !== undefined ? cells[idxPrNumber] ?? "" : "").trim();
    const author = (cells[idxAuthor] ?? "").trim();
    const openedAt = (cells[idxOpenedAt] ?? "").trim();
    const mergedAt = (idxMergedAt !== undefined ? cells[idxMergedAt] ?? "" : "").trim();
    const reviewers = Number(cells[idxReviewers] ?? "0");
    const comments = Number(cells[idxComments] ?? "0");
    const lines_ = Number(cells[idxLines] ?? "0");
    const description = (idxDescription !== undefined ? cells[idxDescription] ?? "" : "").trim();
    if (!author || !openedAt) {
      skipped++;
      continue;
    }
    if (!Number.isFinite(reviewers) || !Number.isFinite(comments) || !Number.isFinite(lines_)) {
      skipped++;
      continue;
    }
    out.push({
      id: crypto.randomUUID(),
      prNumber: prNumber || undefined,
      author,
      // openedAt/mergedAt: when entered via the form's <Input type="datetime-local">
      // the value is local-time (no Z suffix) like "2026-05-09T14:30". CSV imports
      // may use ISO 8601 with or without a Z; new Date(...) handles both, treating
      // the no-Z variant as local — matching the form's behavior.
      openedAt,
      mergedAt: mergedAt || undefined,
      reviewerCount: Math.max(0, Math.round(reviewers)),
      commentCount: Math.max(0, Math.round(comments)),
      linesChanged: Math.max(0, Math.round(lines_)),
      description: description || undefined,
    });
  }
  return { samples: out, skipped };
}

/* ── Main client ────────────────────────────────────────────────────────── */

export function CodeReviewMetricsClient() {
  const [state, setState] = usePersisted<CrState>(
    "agile-toolkit:code-review-metrics",
    DEFAULT_STATE
  );
  const { log } = useHistoryLogger("code-review-metrics");
  const scatterRef = useRef<HTMLDivElement>(null);

  // Add-form draft state.
  const [prNumber, setPrNumber] = useState("");
  const [author, setAuthor] = useState("");
  const [openedAt, setOpenedAt] = useState("");
  const [mergedAt, setMergedAt] = useState("");
  const [reviewerDraft, setReviewerDraft] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [linesDraft, setLinesDraft] = useState("");
  const [description, setDescription] = useState("");

  // CSV import draft.
  const [csvDraft, setCsvDraft] = useState("");

  const addSample = () => {
    if (!author.trim() || !openedAt.trim()) return;
    const reviewers = Number(reviewerDraft);
    const comments = Number(commentDraft);
    const lines = Number(linesDraft);
    if (!Number.isFinite(reviewers) || reviewers < 0) return;
    if (!Number.isFinite(comments) || comments < 0) return;
    if (!Number.isFinite(lines) || lines < 0) return;
    const sample: PrSample = {
      id: crypto.randomUUID(),
      prNumber: prNumber.trim() || undefined,
      author: author.trim(),
      openedAt: openedAt.trim(),
      mergedAt: mergedAt.trim() || undefined,
      reviewerCount: Math.round(reviewers),
      commentCount: Math.round(comments),
      linesChanged: Math.round(lines),
      description: description.trim() || undefined,
    };
    setState((s) => ({ samples: [...s.samples, sample] }));
    log(CODE_REVIEW_ACTIONS.PR_LOGGED, {
      sampleId: sample.id,
      prNumber: sample.prNumber,
      author: sample.author,
      reviewerCount: sample.reviewerCount,
      commentCount: sample.commentCount,
      linesChanged: sample.linesChanged,
      description: sample.description,
    });
    setPrNumber("");
    setAuthor("");
    setOpenedAt("");
    setMergedAt("");
    setReviewerDraft("");
    setCommentDraft("");
    setLinesDraft("");
    setDescription("");
  };

  const importCsv = () => {
    if (!csvDraft.trim()) return;
    let result: ParseResult;
    try {
      result = parseCsv(csvDraft);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "CSV parse failed");
      return;
    }
    if (result.samples.length === 0) {
      toast.error("No valid rows parsed — check headers and number columns");
      return;
    }
    setState((s) => ({ samples: [...s.samples, ...result.samples] }));
    log(CODE_REVIEW_ACTIONS.PR_LOGGED, {
      bulk: true,
      count: result.samples.length,
      skipped: result.skipped,
    });
    const skipNote = result.skipped > 0 ? ` (${result.skipped} skipped)` : "";
    toast.success(`Imported ${result.samples.length} PR(s)${skipNote}`);
    setCsvDraft("");
  };

  const remove = (id: string) => {
    const sample = state.samples.find((s) => s.id === id);
    setState((s) => ({ samples: s.samples.filter((x) => x.id !== id) }));
    log(CODE_REVIEW_ACTIONS.PR_REMOVED, {
      sampleId: id,
      prNumber: sample?.prNumber,
      author: sample?.author,
    });
  };

  /* ── Aggregations ───────────────────────────────────────────────────── */

  const merged = useMemo(
    () =>
      state.samples
        .map((s) => ({ ...s, cycleHours: hoursBetween(s.openedAt, s.mergedAt) }))
        .filter((s) => s.cycleHours !== null),
    [state.samples]
  );

  const avgCycleHours = useMemo<number | null>(() => {
    if (merged.length === 0) return null;
    const sum = merged.reduce((acc, s) => acc + (s.cycleHours ?? 0), 0);
    return sum / merged.length;
  }, [merged]);

  const avgReviewDepth = useMemo(() => {
    if (state.samples.length === 0) return 0;
    return (
      state.samples.reduce((acc, s) => acc + s.commentCount, 0) /
      state.samples.length
    );
  }, [state.samples]);

  const avgPrSize = useMemo(() => {
    if (state.samples.length === 0) return 0;
    return (
      state.samples.reduce((acc, s) => acc + s.linesChanged, 0) /
      state.samples.length
    );
  }, [state.samples]);

  const unmerged = state.samples.filter((s) => !s.mergedAt).length;

  const scatterData = useMemo(
    () =>
      merged.map((s) => ({
        linesChanged: s.linesChanged,
        cycleHours: Number((s.cycleHours ?? 0).toFixed(1)),
        prNumber: s.prNumber ?? "",
        author: s.author,
      })),
    [merged]
  );

  // Top reviewers by total comment volume across PRs they touched. We use
  // commentCount as a proxy for "review effort"; the brief only logs total
  // comments per PR (not per reviewer), so we credit each reviewer-on-the-PR
  // with the per-PR comment count averaged by reviewerCount. When
  // reviewerCount is 0 we credit the author's PR to nobody.
  // Practical alternative: bar by author + comments, since author is the only
  // per-row identity. Use that — matches the brief's "top reviewers by
  // comment count" intent without inventing data.
  const topAuthors = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of state.samples) {
      map.set(s.author, (map.get(s.author) ?? 0) + s.commentCount);
    }
    return Array.from(map.entries())
      .map(([author, total]) => ({ author, comments: total }))
      .sort((a, b) => b.comments - a.comments)
      .slice(0, 10);
  }, [state.samples]);

  /* ── Phase-15 analytics ───────────────────────────────────────────────── */
  // Underlying cycle-hours array — drives bootstrap CI brackets and the
  // weekly XmR series.
  const cycleHoursArray = useMemo(
    () => merged.map((s) => s.cycleHours as number),
    [merged]
  );

  // Bootstrap percentile CIs for median + P85. The primitive collapses to a
  // point CI when n<3 — we guard above that to keep the UI honest.
  const cycleP50CI = useMemo(
    () => (cycleHoursArray.length >= 3 ? bootstrapQuantile(cycleHoursArray, 0.5) : null),
    [cycleHoursArray]
  );
  const cycleP85CI = useMemo(
    () => (cycleHoursArray.length >= 3 ? bootstrapQuantile(cycleHoursArray, 0.85) : null),
    [cycleHoursArray]
  );

  // Per-week mean cycle hours, bucketed by ISO week of mergedAt.
  const weeklyCycle = useMemo(() => {
    const buckets = new Map<string, number[]>();
    for (const s of merged) {
      if (!s.mergedAt || s.cycleHours === null) continue;
      const d = new Date(s.mergedAt);
      if (Number.isNaN(d.getTime())) continue;
      // ISO-week key (matches the cycle-time tool's pattern).
      const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      const key = `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
      const arr = buckets.get(key) ?? [];
      arr.push(s.cycleHours);
      buckets.set(key, arr);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekKey, vals]) => ({
        weekKey,
        meanHours: vals.reduce((a, b) => a + b, 0) / vals.length,
      }));
  }, [merged]);

  const weeklyMeanSeries = useMemo(
    () => weeklyCycle.map((w) => w.meanHours),
    [weeklyCycle]
  );

  // XmR control limits on the weekly cycle-time mean.
  const cycleControl = useMemo(
    // Cycle-time hours cannot be negative; clamp LCL at 0.
    () => (weeklyMeanSeries.length >= 4 ? xmrLimits(weeklyMeanSeries, true) : null),
    [weeklyMeanSeries]
  );

  // Mann-Kendall trend on the weekly cycle-time mean.
  const cycleTrend = useMemo(
    () => (weeklyMeanSeries.length >= 5 ? mannKendall(weeklyMeanSeries) : null),
    [weeklyMeanSeries]
  );

  const weeklyChartData = useMemo(
    () => weeklyCycle.map((w) => ({ week: w.weekKey, meanHours: Number(w.meanHours.toFixed(2)) })),
    [weeklyCycle]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Code Review Metrics",
      prompts: generateCodeReviewPrompts({
        samples: state.samples.map((s) => ({
          prNumber: s.prNumber,
          author: s.author,
          cycleHours: hoursBetween(s.openedAt, s.mergedAt),
          reviewerCount: s.reviewerCount,
          commentCount: s.commentCount,
          linesChanged: s.linesChanged,
          description: s.description,
        })),
        avgCycleHours,
        avgReviewDepth,
        avgPrSize,
        unmerged,
      }),
    }),
    [state.samples, avgCycleHours, avgReviewDepth, avgPrSize, unmerged]
  );

  return (
    <ToolPageWrapper
      toolId="code-review-metrics"
      title="Code Review Metrics"
      description="Log PRs by hand or paste CSV — surface cycle time, review depth, PR size, and reviewer load."
      category="Quality Engineering"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="code-review-metrics"
          csvData={{
            headers: [
              "PR Number",
              "Author",
              "Opened At",
              "Merged At",
              "Cycle Hours",
              "Reviewer Count",
              "Comment Count",
              "Lines Changed",
              "Description",
            ],
            rows: state.samples.map((s) => [
              s.prNumber ?? "",
              s.author,
              s.openedAt,
              s.mergedAt ?? "",
              hoursBetween(s.openedAt, s.mergedAt)?.toFixed(2) ?? "",
              s.reviewerCount,
              s.commentCount,
              s.linesChanged,
              s.description ?? "",
            ]),
          }}
          jsonData={state}
          targetRef={scatterRef}
        />
      </ActionRow>

      <KpiGrid cols={4}>
        <StatCard
          variant="compact"
          icon={Clock}
          label="Cycle median"
          value={cycleP50CI ? `${cycleP50CI.point.toFixed(1)}h` : avgCycleHours !== null ? `${avgCycleHours.toFixed(1)}h` : "—"}
          hint={
            cycleP50CI
              ? `± [${cycleP50CI.lower.toFixed(1)}, ${cycleP50CI.upper.toFixed(1)}] 95% CI`
              : "median cycle hours"
          }
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={Clock}
          label="Cycle P85"
          value={cycleP85CI ? `${cycleP85CI.point.toFixed(1)}h` : "—"}
          hint={
            cycleP85CI
              ? `± [${cycleP85CI.lower.toFixed(1)}, ${cycleP85CI.upper.toFixed(1)}] 95% CI`
              : "85th percentile cycle hours"
          }
        />
        <StatCard
          variant="compact"
          icon={MessageSquare}
          label="Avg review depth"
          value={avgReviewDepth.toFixed(1)}
          hint="comments / PR"
        />
        <StatCard
          variant="compact"
          icon={Layers}
          label="Avg PR size"
          value={Math.round(avgPrSize)}
          hint="lines changed"
        />
      </KpiGrid>
      <div className="text-[11px] text-sub mb-4 -mt-2 font-mono">
        {unmerged > 0 ? `${unmerged} PR(s) still open` : ""}
      </div>

      <SectionCard
        title="Log PR sample"
        icon={GitPullRequest}
        className="mb-6 bg-surface border-border"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-sub">PR # (optional)</Label>
            <Input
              value={prNumber}
              onChange={(e) => setPrNumber(e.target.value)}
              placeholder="#1234"
              className="bg-bg border-border font-data"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-sub">Author</Label>
            <Input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="@alice"
              className="bg-bg border-border"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-sub">Opened at</Label>
            <Input
              type="datetime-local"
              value={openedAt}
              onChange={(e) => setOpenedAt(e.target.value)}
              className="bg-bg border-border font-data"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-sub">Merged at (optional)</Label>
            <Input
              type="datetime-local"
              value={mergedAt}
              onChange={(e) => setMergedAt(e.target.value)}
              className="bg-bg border-border font-data"
            />
          </div>
          <NumericTile
            label="Reviewers"
            value={reviewerDraft}
            onChange={setReviewerDraft}
            placeholder="2"
          />
          <NumericTile
            label="Comments"
            value={commentDraft}
            onChange={setCommentDraft}
            placeholder="14"
          />
          <NumericTile
            label="Lines changed"
            value={linesDraft}
            onChange={setLinesDraft}
            placeholder="120"
          />
          <div className="flex items-end">
            <Button
              onClick={addSample}
              disabled={
                !author.trim() ||
                !openedAt.trim() ||
                !reviewerDraft.trim() ||
                !commentDraft.trim() ||
                !linesDraft.trim()
              }
              className="gap-2 w-full bg-accent text-bg hover:bg-accent/90 disabled:opacity-40"
            >
              <Plus className="w-4 h-4" />
              Add PR
            </Button>
          </div>
          <div className="sm:col-span-2 lg:col-span-4 space-y-1">
            <Label className="text-xs text-sub">Description (optional)</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes, link to PR, context..."
              className="bg-bg border-border text-sm"
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Bulk import (CSV)"
        icon={GitPullRequest}
        className="mb-6 bg-surface border-border"
      >
        <div className="text-[11px] text-sub mb-2">
          Paste a CSV with columns: <code>prNumber, author, openedAt, mergedAt, reviewerCount, commentCount, linesChanged, description</code>.
          Header row optional. Dates accept ISO 8601 (e.g. <code>2026-05-09T14:30</code>).
        </div>
        <Textarea
          rows={4}
          value={csvDraft}
          onChange={(e) => setCsvDraft(e.target.value)}
          placeholder="#1234,alice,2026-05-01T09:00,2026-05-01T17:30,2,14,120,Refactor auth"
          className="bg-bg border-border text-xs font-data"
        />
        <div className="flex justify-end mt-2">
          <Button
            onClick={importCsv}
            disabled={!csvDraft.trim()}
            className="gap-2 bg-accent text-bg hover:bg-accent/90 disabled:opacity-40"
          >
            <Plus className="w-4 h-4" />
            Parse &amp; import
          </Button>
        </div>
      </SectionCard>

      {weeklyChartData.length > 0 && (
        <ChartCard
          title="Weekly cycle-time mean (XmR)"
          icon={Clock}
          height={260}
          className="mb-6"
          headerExtras={
            cycleTrend?.significant ? (
              <span
                className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                  // For cycle time, "down" trend is good (faster), "up" is bad.
                  cycleTrend.trend === "down"
                    ? "border-[#00ff88]/40 text-[#00ff88] bg-[#00ff88]/10"
                    : "border-amber-400/40 text-amber-400 bg-amber-400/10"
                }`}
                aria-label={`Weekly cycle-time trend ${cycleTrend.trend} (Mann-Kendall p=${cycleTrend.pValue.toFixed(3)})`}
                title={`Mann-Kendall p=${cycleTrend.pValue.toFixed(3)}`}
              >
                {cycleTrend.trend === "up" ? "↗ trend" : "↘ trend"}
              </span>
            ) : undefined
          }
        >
          <LineChart data={weeklyChartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
            <XAxis
              dataKey="week"
              tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
              axisLine={{ stroke: chartTheme.gridColor }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              label={{ value: "Hours", angle: -90, position: "insideLeft", fill: chartTheme.axisColor, fontSize: 11 }}
            />
            <Tooltip contentStyle={chartTheme.tooltipStyle} />
            <Line type="monotone" dataKey="meanHours" stroke={chartTheme.colors.cyan} strokeWidth={2} dot={{ r: 3 }} name="Mean cycle (h)" />
            {cycleControl && (
              <>
                <ReferenceLine
                  y={cycleControl.centerLine}
                  stroke={chartTheme.colors.cyan}
                  strokeDasharray="2 4"
                  strokeOpacity={0.55}
                  label={{ value: "X̄", fill: chartTheme.colors.cyan, fontSize: 10, position: "right" }}
                  ifOverflow="extendDomain"
                />
                <ReferenceLine
                  y={cycleControl.ucl}
                  stroke={chartTheme.colors.red}
                  strokeDasharray="2 4"
                  strokeOpacity={0.55}
                  label={{ value: "UCL", fill: chartTheme.colors.red, fontSize: 10, position: "right" }}
                  ifOverflow="extendDomain"
                />
                <ReferenceLine
                  y={cycleControl.lcl}
                  stroke={chartTheme.colors.green}
                  strokeDasharray="2 4"
                  strokeOpacity={0.55}
                  label={{ value: "LCL", fill: chartTheme.colors.green, fontSize: 10, position: "right" }}
                  ifOverflow="extendDomain"
                />
              </>
            )}
          </LineChart>
        </ChartCard>
      )}

      {scatterData.length > 0 && (
        <ChartCard
          title="PR size vs. cycle hours"
          icon={Clock}
          height={300}
          chartContainerRef={scatterRef}
          className="mb-6"
        >
          <ScatterChart margin={{ top: 10, right: 16, left: 0, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
            <XAxis
              type="number"
              dataKey="linesChanged"
              name="Lines changed"
              tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
              axisLine={{ stroke: chartTheme.gridColor }}
              tickLine={false}
            />
            <YAxis
              type="number"
              dataKey="cycleHours"
              name="Cycle hours"
              tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              contentStyle={chartTheme.tooltipStyle}
            />
            <Scatter data={scatterData} fill="#00f0ff" />
          </ScatterChart>
        </ChartCard>
      )}

      {topAuthors.length > 0 && (
        <ChartCard
          title="Top PR authors by comments received"
          icon={MessageSquare}
          height={260}
          className="mb-6"
        >
          <div className="text-[11px] text-sub px-1 mb-2">
            Measures comments left on each author&apos;s PRs — not reviews-given.
            Reviewer-level credit isn&apos;t available because comments are
            logged at the PR level only.
          </div>
          <BarChart
            data={topAuthors}
            margin={{ top: 10, right: 16, left: 0, bottom: 10 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={chartTheme.gridColor}
              vertical={false}
            />
            <XAxis
              dataKey="author"
              tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
              axisLine={{ stroke: chartTheme.gridColor }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip contentStyle={chartTheme.tooltipStyle} />
            <Bar dataKey="comments" fill="#ff00aa" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>
      )}

      <SectionCard
        title="Logged PRs"
        icon={GitPullRequest}
        className="mb-2 bg-surface border-border"
      >
        {state.samples.length === 0 ? (
          <EmptyState icon={GitPullRequest}>
            No PR samples logged. Add one above or paste a CSV to start.
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {state.samples
              .slice()
              .reverse()
              .map((s) => {
                const cycle = hoursBetween(s.openedAt, s.mergedAt);
                return (
                  <Card key={s.id} className="bg-bg border-border">
                    <CardContent className="p-3 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {s.prNumber && (
                          <Badge variant="outline" className="font-data text-[10px]">
                            {s.prNumber}
                          </Badge>
                        )}
                        <span className="text-text font-medium">@{s.author}</span>
                        <span className="text-sub">
                          {cycle !== null ? `${cycle.toFixed(1)}h` : "open"}
                        </span>
                        <span className="text-sub">·</span>
                        <span className="text-sub font-data">
                          {s.linesChanged}L
                        </span>
                        <span className="text-sub">·</span>
                        <span className="text-sub font-data">
                          {s.commentCount} comments
                        </span>
                        <span className="text-sub">·</span>
                        <span className="text-sub font-data">
                          {s.reviewerCount} reviewers
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => remove(s.id)}
                          className="ml-auto text-sub hover:text-danger"
                          aria-label="Remove PR sample"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      {s.description && (
                        <div className="text-xs text-sub whitespace-pre-wrap break-words">
                          {s.description}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        )}
      </SectionCard>
    </ToolPageWrapper>
  );
}

/* ── Numeric input tile ─────────────────────────────────────────────────── */

function NumericTile({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-sub">{label}</Label>
      <Input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const n = Number(value);
          if (!Number.isFinite(n) || n < 0) {
            onChange("");
          } else {
            onChange(String(Math.max(0, Math.round(n))));
          }
        }}
        placeholder={placeholder}
        className="bg-bg border-border font-data"
      />
    </div>
  );
}
