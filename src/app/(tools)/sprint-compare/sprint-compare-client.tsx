"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, FlaskConical, GitCompare, Pin, PinOff, Plus, Sparkles } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { SectionCard } from "@/components/shared/section-card";
import { ChartCard } from "@/components/shared/chart-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, type FieldControlProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NewSprintDialog } from "@/components/sprints/new-sprint-dialog";
import { nextSprintName, sprintLabel } from "@/components/sprints/sprint-picker";
import { generateSprintComparePrompts } from "@/lib/ai-prompts/sprint-compare";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SPRINT_COMPARE_ACTIONS } from "@/lib/history/event-actions";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint } from "@/lib/stores/workspace-types";
import { exampleSprints, isExampleSprintId, type ExampleSprints } from "@/lib/sprints/example";
import { useSprintMigrationStatus } from "@/lib/sprints/migration-status";
import { seriesFor, sprintsNewestFirst, withRatings } from "@/lib/sprints/series";
import { updateSeries } from "@/lib/sprints/store";
import { useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { undoable } from "@/lib/utils/undoable";
import { parseHexOrBlack } from "@/lib/utils";
import {
  MAX_PINS,
  clearPins,
  defaultPins,
  parsePins,
  readPinsRaw,
  useComparePins,
  writePins,
} from "./pins";
import {
  DIMENSIONS,
  MAX_RATING,
  MIN_RATING,
  averageOf,
  buildRows,
  clampRating,
  pointsDone,
  radarData,
  ratingsOf,
  type CompareRow,
  type Dimension,
  type Ratings,
} from "./view";
import { sprintRadarText } from "./chart-text";
import { toMarkdown } from "./markdown";

// Recharts loads with the chart, not the page; ChartCard's fixed-height box
// reserves the space while it does.
const SprintRadarChart = dynamic(() => import("./charts").then((m) => m.SprintRadarChart), {
  ssr: false,
});

/** Colour for a sprint that is being rated but isn't in the comparison. */
const UNPINNED_COLOR = "#94a3b8";

/* -------------------------------------------------------------------------- */
/*  Rating input: commits on blur/Enter, so typing "10" doesn't save "1"      */
/*  first. Empty means not rated.                                              */
/* -------------------------------------------------------------------------- */

function RatingInput({
  value,
  onCommit,
  disabled,
  color,
  ...control
}: FieldControlProps & {
  value: number | undefined;
  onCommit: (n: number | undefined) => void;
  disabled?: boolean;
  color: string;
}) {
  const shown = value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);

  const commit = () => {
    const text = draft.trim();
    if (text === "") {
      if (value !== undefined) onCommit(undefined);
      return;
    }
    const n = Number(text);
    if (!Number.isFinite(n)) {
      setDraft(shown);
      return;
    }
    const next = clampRating(n);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <Input
      {...control}
      type="number"
      inputMode="decimal"
      min={MIN_RATING}
      max={MAX_RATING}
      step={1}
      placeholder="–"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="bg-surface-deep border-border text-text font-data focus:ring-0"
      style={{ borderColor: `${color}40` }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Score cell with colour intensity                                          */
/* -------------------------------------------------------------------------- */

function ScoreCell({ value, color }: { value: number | undefined; color: string }) {
  if (value === undefined) {
    return (
      <td className="px-4 py-2 text-center text-sm font-data text-sub border-b border-border">
        <span aria-hidden="true">–</span>
        <span className="sr-only">Not rated</span>
      </td>
    );
  }
  const intensity = value / 10;
  const { r, g, b } = parseHexOrBlack(color);
  return (
    <td
      className="px-4 py-2 text-center text-sm font-data font-semibold"
      style={{
        background: `rgba(${r},${g},${b},${intensity * 0.25})`,
        color: value >= 7 ? color : "#94a3b8",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      {value}
    </td>
  );
}

/** Points the sprint completed (from the shared sprint, as Velocity records it). */
function VelocityChip({ sprint }: { sprint: Sprint }) {
  const done = pointsDone(sprint);
  if (!done) return null;
  return (
    <Badge variant="outline" className="text-xs font-normal text-sub">
      Velocity: {done}
    </Badge>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                            */
/* -------------------------------------------------------------------------- */

interface EditorRow {
  sprint: Sprint;
  ratings: Ratings;
  color: string;
  pinned: boolean;
}

export function SprintCompareClient() {
  const migration = useSprintMigrationStatus();
  const { sprints, selected, select } = useSelectedSprint();
  const series = useWorkspaceStore((s) => s.sprintSeries);
  const { pins, isDefault } = useComparePins(sprints, series);
  const { log } = useHistoryLogger("sprint-compare");

  /** An in-memory example. Read-only: nothing in it is ever saved. */
  const [preview, setPreview] = useState<ExampleSprints | null>(null);
  const [creating, setCreating] = useState(false);
  const readOnly = preview !== null;

  const previewSprints = useMemo(
    () => (preview ? sprintsNewestFirst(preview.sprints) : []),
    [preview]
  );
  const viewSprints = preview ? previewSprints : sprints;
  const viewSeries = preview ? preview.series : series;
  const viewPins = useMemo(
    () => (preview ? defaultPins(previewSprints, preview.series) : pins),
    [preview, previewSprints, pins]
  );

  const rows = useMemo(
    () => buildRows(viewPins, viewSprints, viewSeries),
    [viewPins, viewSprints, viewSeries]
  );

  // The shared selection opens here too: a sprint chosen in another tool (or
  // with "Rate") can be rated even when it isn't in the comparison.
  const editorRows = useMemo<EditorRow[]>(() => {
    const pinnedRows = rows.map((r) => ({ ...r, pinned: true }));
    if (readOnly || !selected || viewPins.includes(selected.id)) return pinnedRows;
    return [
      {
        sprint: selected,
        ratings: ratingsOf(seriesFor(series, selected.id)),
        color: UNPINNED_COLOR,
        pinned: false,
      },
      ...pinnedRows,
    ];
  }, [rows, readOnly, selected, viewPins, series]);

  /* -- Actions ------------------------------------------------------------- */

  const pin = (sprint: Sprint) => {
    if (readOnly || pins.includes(sprint.id) || pins.length >= MAX_PINS) return;
    writePins([...pins, sprint.id]);
    log(SPRINT_COMPARE_ACTIONS.SPRINT_PINNED, { sprintId: sprint.id, name: sprint.name });
  };

  const unpin = (sprint: Sprint) => {
    if (readOnly || !pins.includes(sprint.id)) return;
    writePins(pins.filter((id) => id !== sprint.id));
    log(SPRINT_COMPARE_ACTIONS.SPRINT_UNPINNED, { sprintId: sprint.id, name: sprint.name });
  };

  const resetPins = () => {
    if (readOnly) return;
    const before = parsePins(readPinsRaw());
    if (before === null) return;
    undoable({
      label: "Showing the newest rated sprints",
      apply: () => clearPins(),
      revert: () => writePins(before),
    });
    log(SPRINT_COMPARE_ACTIONS.COMPARE_RESET, { sprintIds: pins });
  };

  const rate = (sprintId: string, dim: Dimension, value: number | undefined) => {
    if (readOnly || isExampleSprintId(sprintId)) return;
    updateSeries(sprintId, (s) => withRatings(s, { [dim]: value }));
  };

  // "Rate" chooses the sprint in every sprint tool, then moves focus to its
  // first rating box.
  const rowEls = useRef(new Map<string, HTMLElement>());
  const [focusId, setFocusId] = useState<string | null>(null);
  const chooseToRate = (id: string) => {
    if (readOnly) return;
    select(id);
    setFocusId(id);
  };
  useEffect(() => {
    if (!focusId) return;
    rowEls.current.get(focusId)?.querySelector("input")?.focus();
    setFocusId(null);
  }, [focusId, editorRows]);

  const onCreated = (sprint: Sprint) => {
    setPreview(null);
    select(sprint.id);
    // Put a new sprint straight into the comparison when there's room.
    if (!pins.includes(sprint.id) && pins.length < MAX_PINS) {
      writePins([...pins, sprint.id]);
      log(SPRINT_COMPARE_ACTIONS.SPRINT_PINNED, { sprintId: sprint.id, name: sprint.name });
    }
  };

  /* -- Export, AI and chart data -------------------------------------------- */

  const exportRef = useRef<HTMLDivElement>(null);

  const ratedRows = useMemo(() => rows.filter((r) => averageOf(r.ratings) !== null), [rows]);
  const chartData = useMemo(() => radarData(ratedRows), [ratedRows]);
  const chartSeries = useMemo(
    () => ratedRows.map((r) => ({ id: r.id, name: r.name, color: r.color })),
    [ratedRows]
  );
  // The radar in words: a summary sentence and the ratings as a table.
  const chartText = useMemo(
    () => sprintRadarText(chartData, chartSeries),
    [chartData, chartSeries]
  );

  const jsonData = useMemo(
    () => ({
      sprints: rows.map((r) => ({
        id: r.id,
        name: r.name,
        scores: r.ratings,
        pointsCompleted: r.sprint.pointsCompleted,
      })),
    }),
    [rows]
  );
  const markdown = useMemo(() => toMarkdown(rows), [rows]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Sprint Comparison",
      prompts: generateSprintComparePrompts({
        sprints: rows.map((r) => ({
          name: r.name,
          scores: r.ratings,
          pointsCompleted: r.sprint.pointsCompleted,
        })),
      }),
    }),
    [rows]
  );

  /* -- Render -------------------------------------------------------------- */

  const newSprintDialog = (
    <NewSprintDialog
      open={creating}
      onOpenChange={setCreating}
      defaultName={nextSprintName(sprints)}
      onCreated={onCreated}
    />
  );
  const newSprintButton = (
    <Button
      type="button"
      size="sm"
      variant="toolkit"
      onClick={() => setCreating(true)}
      className="gap-1.5"
    >
      <Plus className="w-4 h-4" aria-hidden="true" />
      New sprint
    </Button>
  );

  const wrap = (children: React.ReactNode) => (
    <ToolPageWrapper
      toolId="sprint-compare"
      title="Sprint Comparison"
      description="Compare sprints across 6 key dimensions using a radar chart."
      category="Metrics & Dashboards"
    >
      {children}
      {newSprintDialog}
    </ToolPageWrapper>
  );

  if (migration === "pending") {
    return wrap(<EmptyState icon={GitCompare}>Loading sprints…</EmptyState>);
  }

  if (!preview && sprints.length === 0) {
    return wrap(
      <EmptyState
        icon={GitCompare}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {newSprintButton}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setPreview(exampleSprints())}
            >
              <Sparkles className="w-4 h-4" aria-hidden="true" />
              See an example
            </Button>
          </div>
        }
      >
        No sprints yet. Create one to rate it, or see an example first.
      </EmptyState>
    );
  }

  const full = pins.length >= MAX_PINS;
  const chartActions = (
    <>
      <AiPromptGenerator config={promptConfig} />
      <ExportButton
        filename="sprint-comparison"
        jsonData={jsonData}
        markdown={markdown}
        targetRef={exportRef}
      />
    </>
  );

  return wrap(
    <div ref={exportRef} className="space-y-6">
      {preview && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-info/30 bg-info/10 px-4 py-2.5 text-sm text-text"
        >
          <FlaskConical className="h-4 w-4 shrink-0 text-info" aria-hidden="true" />
          <p className="min-w-0 flex-1">
            <span className="font-medium">Example sprints.</span> A preview only: nothing here is
            saved.
          </p>
          <Button type="button" size="sm" variant="toolkit" onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4" aria-hidden="true" />
            Start your own
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setPreview(null)}>
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Back
          </Button>
        </div>
      )}

      {/* ---- Radar chart ---- */}
      {/* Always mounted at the same height, so rating the first sprint doesn't
          push the rating boxes down the page mid-entry. */}
      <ChartCard
        title="Sprint Radar"
        icon={GitCompare}
        height={400}
        summary={chartText.summary}
        table={chartText.table}
        headerExtras={chartActions}
        footer={
          chartSeries.length === 0 ? (
            <p className="text-center text-sm text-sub">
              {rows.length === 0
                ? "Pin up to five sprints below to compare them."
                : "Rate a pinned sprint to see it here."}
            </p>
          ) : undefined
        }
      >
        <SprintRadarChart data={chartData} series={chartSeries} />
      </ChartCard>

      {/* ---- Ratings ---- */}
      <SectionCard
        title="Ratings"
        titleSize="lg"
        headerClassName="pb-4"
        contentClassName="space-y-6"
        actions={
          readOnly ? undefined : (
            <>
              <Button
                type="button"
                variant="danger-ghost"
                size="sm"
                onClick={resetPins}
                disabled={isDefault}
              >
                Reset comparison
              </Button>
              {newSprintButton}
            </>
          )
        }
      >
        <p className="text-sm text-sub">
          Rate each sprint from 1 to 10. Leave a box empty if you haven&apos;t rated it.
        </p>
        {editorRows.length === 0 && (
          <p className="text-sm text-sub">No sprints pinned. Pin one from the list below.</p>
        )}
        {editorRows.map((row) => (
          <div
            key={row.sprint.id}
            ref={(el) => {
              if (el) rowEls.current.set(row.sprint.id, el);
              else rowEls.current.delete(row.sprint.id);
            }}
            className="space-y-3"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: row.color }}
                aria-hidden="true"
              />
              <p className="min-w-0 text-sm font-medium text-text">{sprintLabel(row.sprint)}</p>
              <VelocityChip sprint={row.sprint} />
              {!row.pinned && (
                <Badge variant="outline" className="text-xs font-normal text-sub">
                  Not in the comparison
                </Badge>
              )}
              {!readOnly && (
                <PinButton
                  sprint={row.sprint}
                  pinned={row.pinned}
                  full={full}
                  onPin={pin}
                  onUnpin={unpin}
                  className="ml-auto"
                />
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {DIMENSIONS.map((dim) => (
                <Field
                  key={dim}
                  label={
                    <>
                      {dim} <span className="sr-only">for {row.sprint.name}</span>
                    </>
                  }
                >
                  {(control) => (
                    <RatingInput
                      {...control}
                      value={row.ratings[dim]}
                      color={row.color}
                      disabled={readOnly}
                      onCommit={(n) => rate(row.sprint.id, dim, n)}
                    />
                  )}
                </Field>
              ))}
            </div>
          </div>
        ))}
      </SectionCard>

      {/* ---- Comparison table ---- */}
      {rows.length > 0 && (
        <SectionCard
          title="Dimension Comparison"
          titleSize="lg"
          headerClassName="pb-4"
          contentClassName="table-wrap-responsive"
        >
          <ComparisonTable rows={rows} />
        </SectionCard>
      )}

      {/* ---- Sprint list: pin and unpin ---- */}
      <SectionCard
        title="Sprints"
        titleSize="lg"
        headerClassName="pb-4"
        titleSuffix={
          <span className="text-sm font-normal text-sub">
            {viewPins.length} of {MAX_PINS} compared
          </span>
        }
      >
        {!readOnly && full && (
          <p className="mb-2 text-sm text-sub">Up to five sprints. Unpin one to add another.</p>
        )}
        <ul className="divide-y divide-border">
          {viewSprints.map((s) => {
            const avg = averageOf(ratingsOf(seriesFor(viewSeries, s.id)));
            const done = pointsDone(s);
            const pinned = viewPins.includes(s.id);
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text">{sprintLabel(s)}</p>
                  <p className="text-xs text-sub">
                    {avg !== null ? `Average rating ${avg.toFixed(1)}` : "Not rated"}
                    {done ? ` · Velocity: ${done}` : ""}
                  </p>
                </div>
                {readOnly ? (
                  pinned && (
                    <Badge variant="outline" className="text-xs font-normal text-sub">
                      Compared
                    </Badge>
                  )
                ) : (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => chooseToRate(s.id)}
                      aria-label={`Rate ${s.name}`}
                    >
                      Rate
                    </Button>
                    <PinButton sprint={s} pinned={pinned} full={full} onPin={pin} onUnpin={unpin} />
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </SectionCard>
    </div>
  );
}

function PinButton({
  sprint,
  pinned,
  full,
  onPin,
  onUnpin,
  className,
}: {
  sprint: Sprint;
  pinned: boolean;
  full: boolean;
  onPin: (s: Sprint) => void;
  onUnpin: (s: Sprint) => void;
  className?: string;
}) {
  return pinned ? (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={() => onUnpin(sprint)}
      aria-label={`Unpin ${sprint.name}`}
      className={className}
    >
      <PinOff className="w-4 h-4" aria-hidden="true" />
      Unpin
    </Button>
  ) : (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => onPin(sprint)}
      disabled={full}
      aria-label={`Pin ${sprint.name}`}
      className={className}
    >
      <Pin className="w-4 h-4" aria-hidden="true" />
      Pin
    </Button>
  );
}

function ComparisonTable({ rows }: { rows: CompareRow[] }) {
  return (
    <table className="min-w-full md:min-w-[640px] text-sm">
      <thead>
        <tr>
          <th className="text-left px-4 py-2 text-sub font-medium text-xs uppercase tracking-wider border-b border-border">
            Dimension
          </th>
          {rows.map((r) => (
            <th
              key={r.id}
              className="px-4 py-2 text-center text-xs font-medium uppercase tracking-wider border-b border-border"
              style={{ color: r.color }}
            >
              {r.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {DIMENSIONS.map((dim) => (
          <tr key={dim} className="hover:bg-card-hover">
            <td className="px-4 py-2 text-sub text-sm border-b border-border">{dim}</td>
            {rows.map((r) => (
              <ScoreCell key={r.id} value={r.ratings[dim]} color={r.color} />
            ))}
          </tr>
        ))}
        <tr className="bg-card-hover">
          <td className="px-4 py-2 text-text font-semibold text-sm">Average</td>
          {rows.map((r) => {
            const avg = averageOf(r.ratings);
            return (
              <td
                key={r.id}
                className="px-4 py-2 text-center text-sm font-data font-bold"
                style={{ color: r.color }}
              >
                {avg !== null ? avg.toFixed(1) : "—"}
              </td>
            );
          })}
        </tr>
        <tr>
          <td className="px-4 py-2 text-sub text-sm">Points done</td>
          {rows.map((r) => (
            <td key={r.id} className="px-4 py-2 text-center text-sm font-data text-sub">
              {typeof r.sprint.pointsCompleted === "number" ? r.sprint.pointsCompleted : "—"}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}
