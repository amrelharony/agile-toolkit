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

/**
 * Parse a CSV blob. Supports an optional header row (detected by checking if
 * the first row's "linesChanged" cell is non-numeric). Required columns:
 *   prNumber, author, openedAt, mergedAt, reviewerCount, commentCount, linesChanged, description
 */
function parseCsv(csv: string): PrSample[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  // If first row has any non-numeric in numeric columns, treat as header.
  const firstCells = parseCsvRow(lines[0]);
  const headerIndex: Record<string, number> = {};
  let bodyStart = 0;
  if (
    firstCells.length >= 7 &&
    firstCells.some((c) => /author|opened|merged|review/i.test(c))
  ) {
    firstCells.forEach((cell, i) => {
      headerIndex[cell.toLowerCase().replace(/\s+/g, "")] = i;
    });
    bodyStart = 1;
  }

  const idxOr = (
    name: string,
    defaultIdx: number
  ): number => {
    const k = name.toLowerCase();
    return headerIndex[k] ?? defaultIdx;
  };

  const out: PrSample[] = [];
  for (let i = bodyStart; i < lines.length; i++) {
    const cells = parseCsvRow(lines[i]);
    if (cells.length < 6) continue;
    const prNumber = (cells[idxOr("prnumber", 0)] ?? "").trim();
    const author = (cells[idxOr("author", 1)] ?? "").trim();
    const openedAt = (cells[idxOr("openedat", 2)] ?? "").trim();
    const mergedAt = (cells[idxOr("mergedat", 3)] ?? "").trim();
    const reviewers = Number(cells[idxOr("reviewercount", 4)] ?? "0");
    const comments = Number(cells[idxOr("commentcount", 5)] ?? "0");
    const lines_ = Number(cells[idxOr("lineschanged", 6)] ?? "0");
    const description = (cells[idxOr("description", 7)] ?? "").trim();
    if (!author || !openedAt) continue;
    if (!Number.isFinite(reviewers) || !Number.isFinite(comments) || !Number.isFinite(lines_)) {
      continue;
    }
    out.push({
      id: crypto.randomUUID(),
      prNumber: prNumber || undefined,
      author,
      openedAt,
      mergedAt: mergedAt || undefined,
      reviewerCount: Math.max(0, Math.round(reviewers)),
      commentCount: Math.max(0, Math.round(comments)),
      linesChanged: Math.max(0, Math.round(lines_)),
      description: description || undefined,
    });
  }
  return out;
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
    const parsed = parseCsv(csvDraft);
    if (parsed.length === 0) {
      toast.error("No valid rows parsed — check headers and number columns");
      return;
    }
    setState((s) => ({ samples: [...s.samples, ...parsed] }));
    log(CODE_REVIEW_ACTIONS.PR_LOGGED, {
      bulk: true,
      count: parsed.length,
    });
    toast.success(`Imported ${parsed.length} PR(s)`);
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
          label="Avg cycle time"
          value={avgCycleHours !== null ? `${avgCycleHours.toFixed(1)}h` : "—"}
          valueClassName="text-accent"
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
        <StatCard
          variant="compact"
          icon={GitPullRequest}
          label="Unmerged"
          value={unmerged}
          tone={unmerged > 0 ? "warning" : "default"}
        />
      </KpiGrid>

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
          title="Top contributors by comment volume"
          icon={MessageSquare}
          height={260}
          className="mb-6"
        >
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
