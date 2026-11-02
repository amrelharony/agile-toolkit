"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { GitCompare, Pin, PinOff, Plus } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { SectionCard } from "@/components/shared/section-card";
import { ChartCard } from "@/components/shared/chart-card";
import { EmptyState } from "@/components/shared/empty-state";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
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
import type { Sprint, Story } from "@/lib/stores/workspace-types";
import {
  averageScore,
  isEditableDimension,
  sourceLabel,
  type DimensionScore,
  type ScoreGap,
  type SprintScores,
} from "@/lib/sprints/compare";
import { isExampleSprintId } from "@/lib/sprints/example";
import { useSprintMigrationStatus } from "@/lib/sprints/migration-status";
import { sprintsNewestFirst, withRatings } from "@/lib/sprints/series";
import { updateSeries } from "@/lib/sprints/store";
import { sprintHref, useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { parseNumber } from "@/lib/utils/form";
import { undoable } from "@/lib/utils/undoable";
import { cn } from "@/lib/utils";
import { buildExample, type CompareExample } from "./example";
import { MAX_PINS, defaultPins, readPins, clearPins, useComparePins, writePins } from "./pins";
import {
  DIMENSIONS,
  MAX_RATING,
  MIN_RATING,
  UNPINNED_COLOR,
  buildRows,
  isFinishedSprint,
  pointsDone,
  radarData,
  scoredValues,
  scoresBySprint,
  type CompareRow,
  type CompareSources,
  type Dimension,
} from "./view";
import { sprintRadarText } from "./chart-text";
import { toMarkdown } from "./markdown";
import { compareVerdict } from "./verdict";

// Recharts loads with the chart, not the page; ChartCard's fixed-height box
// reserves the space while it does.
const SprintRadarChart = dynamic(() => import("./charts").then((m) => m.SprintRadarChart), {
  ssr: false,
});

const NO_STORIES: Story[] = [];
const RATING_ERROR = `Rate ${MIN_RATING} to ${MAX_RATING}.`;

/** A typed rating checked before it's saved: a 1–10 number, blank (clear), or why not. */
export function validateRating(
  text: string
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  const n = parseNumber(text);
  if (n === undefined) return { ok: true, value: undefined };
  if (!Number.isFinite(n) || n < MIN_RATING || n > MAX_RATING)
    return { ok: false, error: RATING_ERROR };
  return { ok: true, value: Math.round(n * 10) / 10 };
}

/** Where to fix what a score is missing. */
function fixLink(
  gap: ScoreGap | undefined,
  sprintId: string
): { href: string; label: string } | null {
  switch (gap) {
    case "points":
      return { href: sprintHref("/sprint", sprintId), label: "Close it with its points" };
    case "commitment":
      return { href: sprintHref("/sprint", sprintId), label: "Set its commitment" };
    case "dates":
      return { href: sprintHref("/sprint", sprintId), label: "Set its dates" };
    case "history":
      return { href: "/velocity", label: "See Velocity" };
    case "goal":
      return {
        href: sprintHref("/sprint-goal", sprintId),
        label: "Answer “Did we meet the goal?”",
      };
    case "scope":
      return { href: sprintHref("/burnup", sprintId), label: "Log scope in Burnup" };
    case "mood":
      return { href: "/mood-tracker", label: "Check in on Mood Tracker" };
    case "health":
      return { href: "/health-check", label: "Run a Squad Health Check" };
    default:
      return null;
  }
}

/** The chip that says where a score came from. */
function SourceChip({ score }: { score: DimensionScore }) {
  return (
    <span
      className={cn(
        "inline-flex rounded border px-1.5 py-px text-xs",
        score.source === "none" ? "border-border text-sub" : "border-accent/40 text-accent"
      )}
    >
      {sourceLabel(score)}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Rating input: Team Happiness and Quality only. Commits on blur/Enter;     */
/*  empty drops the team's rating so the prefill shows again.                 */
/* -------------------------------------------------------------------------- */

function RatingInput({
  value,
  prefill,
  onCommit,
  disabled,
  color,
  error,
  onError,
  ...control
}: FieldControlProps & {
  /** The team's rating, if typed. */
  value: number | undefined;
  /** What Mood Tracker or the Health Check suggests, shown until someone rates it. */
  prefill: number | null;
  onCommit: (n: number | undefined) => void;
  disabled?: boolean;
  color: string;
  error: boolean;
  onError: (message: string | null) => void;
}) {
  const shown = value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);

  const commit = () => {
    const check = validateRating(draft);
    if (!check.ok) {
      onError(check.error);
      return;
    }
    onError(null);
    if (check.value !== value) onCommit(check.value);
    else setDraft(shown);
  };

  return (
    <Input
      {...control}
      type="number"
      inputMode="decimal"
      min={MIN_RATING}
      max={MAX_RATING}
      step={1}
      placeholder={prefill === null ? "–" : String(prefill)}
      value={draft}
      disabled={disabled}
      onChange={(e) => {
        setDraft(e.target.value);
        if (error) onError(null);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(shown);
          onError(null);
        }
      }}
      className="bg-surface-deep text-text font-data focus:ring-0"
      style={{ borderColor: `color-mix(in srgb, ${color} 40%, transparent)` }}
    />
  );
}

/** One dimension of one sprint: its score, where it came from, and how to fix a gap. */
function ScoreField({
  dim,
  score,
  sprint,
  color,
  readOnly,
  onRate,
}: {
  dim: Dimension;
  score: DimensionScore;
  sprint: Sprint;
  color: string;
  readOnly: boolean;
  onRate: (value: number | undefined) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const fix = readOnly ? null : fixLink(score.missing, sprint.id);
  const label = (
    <>
      {dim} <span className="sr-only">for {sprint.name}</span>
    </>
  );
  const details = (
    <div className="space-y-1">
      <SourceChip score={score} />
      <p className="text-xs text-sub">{score.basis}</p>
      {fix && (
        <Link href={fix.href} className="text-xs text-accent underline-offset-2 hover:underline">
          {fix.label}
        </Link>
      )}
    </div>
  );

  if (!score.editable) {
    return (
      <div className="min-w-0 space-y-1.5" data-dimension={dim}>
        <p className="text-sm text-text">{label}</p>
        <p className="font-data text-xl font-semibold text-text">
          {score.value === null ? (
            <>
              <span aria-hidden="true">–</span>
              <span className="sr-only">Not scored</span>
            </>
          ) : (
            score.value
          )}
        </p>
        {details}
      </div>
    );
  }

  const prefill = score.source === "prefilled" ? score.value : null;
  return (
    <div className="min-w-0 space-y-1.5" data-dimension={dim}>
      {/* The suggestion as text too, tied to the box: a placeholder alone is
          faint, and a screen reader announces the box as blank. */}
      <Field
        label={label}
        hint={prefill === null ? undefined : `Suggested: ${prefill}`}
        error={error ?? undefined}
      >
        {(control) => (
          <RatingInput
            {...control}
            value={score.source === "typed" ? (score.typed ?? undefined) : undefined}
            prefill={prefill}
            color={color}
            disabled={readOnly}
            error={error !== null}
            onError={setError}
            onCommit={onRate}
          />
        )}
      </Field>
      {details}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Score cell with colour intensity (theme colours)                          */
/* -------------------------------------------------------------------------- */

function ScoreCell({ score, color }: { score: DimensionScore; color: string }) {
  if (score.value === null) {
    return (
      <td className="border-b border-border px-4 py-2 text-center font-data text-sm text-sub">
        <span aria-hidden="true">–</span>
        <span className="sr-only">Not scored</span>
      </td>
    );
  }
  // The tint is the signal. The number stays in page text: a chart token is only
  // held to 3:1, so on a tint of itself it falls below AA.
  const pct = Math.round((score.value / MAX_RATING) * 25);
  return (
    <td
      className="border-b border-border px-4 py-2 text-center font-data text-sm font-semibold"
      style={{
        background: `color-mix(in srgb, ${color} ${pct}%, transparent)`,
        color: score.value >= 7 ? "var(--text)" : "var(--sub)",
      }}
    >
      {score.value}
      <span className="sr-only"> ({sourceLabel(score)})</span>
    </td>
  );
}

/** Points the sprint completed (from the shared sprint, once it's finished). */
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
  scores: SprintScores;
  color: string;
  pinned: boolean;
}

/**
 * Sprint Comparison: up to five shared sprints side by side on six scores.
 * Four are computed from the sprint's own data and two are prefilled from
 * Mood Tracker and the Squad Health Check, which the team can override by
 * rating them. Each score says where it came from. The example is an
 * in-memory preview that saves nothing.
 */
export function SprintCompareClient() {
  const migration = useSprintMigrationStatus();
  const { sprints, selected, select } = useSelectedSprint();
  const series = useWorkspaceStore((s) => s.sprintSeries);
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const goals = useWorkspaceStore((s) => s.sprintGoals);
  const moodEntries = useWorkspaceStore((s) => s.moodEntries);
  // Anonymous pulse answers count as check-ins, as tool.sprint_compare counts them.
  const moodPulses = useWorkspaceStore((s) => s.moodPulses);
  const healthChecks = useWorkspaceStore((s) => s.healthChecks);
  const { log } = useHistoryLogger("sprint-compare");
  const announce = useAnnounce();

  /** An in-memory example. Read-only: nothing in it is ever saved. */
  const [example, setExample] = useState<CompareExample | null>(null);
  const [creating, setCreating] = useState(false);
  const readOnly = example !== null;

  const exampleSprintsNewest = useMemo(
    () => (example ? sprintsNewestFirst(example.sprints) : []),
    [example]
  );
  const viewSprints = example ? exampleSprintsNewest : sprints;
  const sources = useMemo<CompareSources>(
    () =>
      example
        ? {
            stories: [],
            series: example.series,
            goals: example.goals,
            moodEntries: example.moodEntries,
            healthChecks: example.healthChecks,
          }
        : { stories, series, goals, moodEntries, moodPulses, healthChecks },
    [example, stories, series, goals, moodEntries, moodPulses, healthChecks]
  );
  const scores = useMemo(() => scoresBySprint(viewSprints, sources), [viewSprints, sources]);

  // With nothing pinned, the newest finished sprints: a rating can't change
  // which sprints are compared, so rating one doesn't move its row mid-entry.
  const { pins, isDefault } = useComparePins(sprints, series, isFinishedSprint);
  const viewPins = useMemo(
    () => (example ? defaultPins(exampleSprintsNewest, example.series, isFinishedSprint) : pins),
    [example, exampleSprintsNewest, pins]
  );
  const rows = useMemo(
    () => buildRows(viewPins, viewSprints, scores),
    [viewPins, viewSprints, scores]
  );
  const verdict = compareVerdict(rows);

  // The shared selection opens here too: a sprint chosen in another tool (or
  // with "Rate") can be rated even when it isn't in the comparison.
  const editorRows = useMemo<EditorRow[]>(() => {
    const pinnedRows = rows.map((r) => ({ ...r, pinned: true }));
    const own = selected ? scores.get(selected.id) : undefined;
    if (readOnly || !selected || !own || viewPins.includes(selected.id)) return pinnedRows;
    return [{ sprint: selected, scores: own, color: UNPINNED_COLOR, pinned: false }, ...pinnedRows];
  }, [rows, readOnly, selected, viewPins, scores]);

  /* -- Actions ------------------------------------------------------------- */

  const pin = (sprint: Sprint) => {
    if (readOnly || pins.includes(sprint.id) || pins.length >= MAX_PINS) return;
    writePins([...pins, sprint.id]);
    log(SPRINT_COMPARE_ACTIONS.SPRINT_PINNED, { sprintId: sprint.id, name: sprint.name });
    announce(`${sprint.name} added to the comparison`);
  };

  const unpin = (sprint: Sprint) => {
    if (readOnly || !pins.includes(sprint.id)) return;
    writePins(pins.filter((id) => id !== sprint.id));
    log(SPRINT_COMPARE_ACTIONS.SPRINT_UNPINNED, { sprintId: sprint.id, name: sprint.name });
    announce(`${sprint.name} taken out of the comparison`);
  };

  const resetPins = () => {
    if (readOnly) return;
    const before = readPins();
    if (before === null) return;
    undoable({
      label: "Showing the newest finished sprints",
      apply: () => clearPins(),
      revert: () => writePins(before),
    });
    log(SPRINT_COMPARE_ACTIONS.COMPARE_RESET, { sprintIds: pins });
  };

  // Only the two dimensions the team rates are written; the rest are computed.
  const rate = (sprint: Sprint, dim: Dimension, value: number | undefined) => {
    if (readOnly || isExampleSprintId(sprint.id) || !isEditableDimension(dim)) return;
    updateSeries(sprint.id, (s) => withRatings(s, { [dim]: value }));
    log(SPRINT_COMPARE_ACTIONS.RATING_SET, {
      sprintId: sprint.id,
      dimension: dim,
      value: value ?? null,
    });
    announce(
      value === undefined
        ? `${dim} for ${sprint.name}: back to the suggestion`
        : `${dim} for ${sprint.name}: ${value}`
    );
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
    setExample(null);
    select(sprint.id);
    // Put a new sprint straight into the comparison when there's room.
    if (!pins.includes(sprint.id) && pins.length < MAX_PINS) {
      writePins([...pins, sprint.id]);
      log(SPRINT_COMPARE_ACTIONS.SPRINT_PINNED, { sprintId: sprint.id, name: sprint.name });
    }
  };

  /* -- Export, AI and chart data -------------------------------------------- */

  const exportRef = useRef<HTMLDivElement>(null);

  const scoredRows = useMemo(() => rows.filter((r) => r.average !== null), [rows]);
  const chartData = useMemo(() => radarData(scoredRows), [scoredRows]);
  const chartSeries = useMemo(
    () => scoredRows.map((r) => ({ id: r.id, name: r.name, color: r.color })),
    [scoredRows]
  );
  // The radar in words: a summary sentence and the scores as a table.
  const chartText = useMemo(
    () => sprintRadarText(chartData, chartSeries),
    [chartData, chartSeries]
  );

  const jsonData = useMemo(
    () => ({
      sprints: rows.map((r) => ({
        id: r.id,
        name: r.name,
        scores: Object.fromEntries(
          DIMENSIONS.map((d) => [
            d,
            { value: r.scores[d].value, source: r.scores[d].source, basis: r.scores[d].basis },
          ])
        ),
        average: r.average,
        pointsCompleted: pointsDone(r.sprint) ? r.sprint.pointsCompleted : undefined,
      })),
    }),
    [rows]
  );
  const markdown = useMemo(() => toMarkdown(rows, new Date(), { verdict }), [rows, verdict]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Sprint Comparison",
      prompts: generateSprintComparePrompts({
        sprints: rows.map((r) => ({
          name: r.name,
          scores: scoredValues(r.scores),
          pointsCompleted: pointsDone(r.sprint) ? r.sprint.pointsCompleted : undefined,
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
      <Plus className="h-4 w-4" aria-hidden="true" />
      New sprint
    </Button>
  );

  const wrap = (children: React.ReactNode) => (
    <ToolPageWrapper
      toolId="sprint-compare"
      title="Sprint Comparison"
      description="Compare sprints on six scores read from your data: velocity, predictability, goal, scope stability, happiness and quality."
      category="Metrics & Dashboards"
    >
      {children}
      {newSprintDialog}
    </ToolPageWrapper>
  );

  if (migration === "pending") {
    return wrap(<EmptyState icon={GitCompare}>Loading sprints…</EmptyState>);
  }

  if (!example && sprints.length === 0) {
    return wrap(
      <EmptyState
        icon={GitCompare}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {newSprintButton}
            <LoadExampleButton onLoad={() => setExample(buildExample())} />
          </div>
        }
      >
        No sprints yet. Create one, or load an example to see how each score is read from your data.
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
      {example && (
        <div>
          <ExampleNotice onClear={() => setExample(null)} />
          <div className="-mt-2 flex flex-wrap items-center gap-2 text-xs text-sub">
            <span>
              Example: four finished sprints and one running, with goals, check-ins and health
              checks to score them from. A preview only: nothing in it is saved.
            </span>
            <Button
              type="button"
              size="sm"
              variant="toolkit"
              onClick={() => setCreating(true)}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Start your own
            </Button>
          </div>
        </div>
      )}

      <p className="text-sm font-medium text-text">{verdict}</p>

      {/* ---- Radar chart ---- */}
      {/* Always mounted at the same height, so scoring the first sprint doesn't
          push the score boxes down the page mid-entry. */}
      <ChartCard
        title="Sprint radar"
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
                : "No pinned sprint has a score yet."}
            </p>
          ) : undefined
        }
      >
        <SprintRadarChart data={chartData} series={chartSeries} />
      </ChartCard>

      {/* ---- Scores ---- */}
      <SectionCard
        title="Scores"
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
          Velocity, Scope Stability, Goal Achievement and Predictability are worked out from the
          sprint&apos;s data. Team Happiness and Quality start from Mood Tracker and the Squad
          Health Check; rate them 1 to 10 to override, or clear the box to go back to the
          suggestion.
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
                className="h-3 w-3 flex-shrink-0 rounded-full"
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
            <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-3">
              {DIMENSIONS.map((dim) => (
                <ScoreField
                  key={dim}
                  dim={dim}
                  score={row.scores[dim]}
                  sprint={row.sprint}
                  color={row.color}
                  readOnly={readOnly}
                  onRate={(n) => rate(row.sprint, dim, n)}
                />
              ))}
            </div>
          </div>
        ))}
      </SectionCard>

      {/* ---- Comparison table ---- */}
      {rows.length > 0 && (
        <SectionCard
          title="Dimension comparison"
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
            const sc = scores.get(s.id);
            const avg = sc ? averageScore(sc) : null;
            const done = pointsDone(s);
            const pinned = viewPins.includes(s.id);
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text">{sprintLabel(s)}</p>
                  <p className="text-xs text-sub">
                    {avg !== null ? `Average score ${avg.toFixed(1)}` : "Not scored"}
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
      <PinOff className="h-4 w-4" aria-hidden="true" />
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
      <Pin className="h-4 w-4" aria-hidden="true" />
      Pin
    </Button>
  );
}

function ComparisonTable({ rows }: { rows: CompareRow[] }) {
  return (
    <table className="min-w-full text-sm md:min-w-[640px]">
      <thead>
        <tr>
          <th className="border-b border-border px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-sub">
            Dimension
          </th>
          {rows.map((r) => (
            <th
              key={r.id}
              className="border-b border-border px-4 py-2 text-center text-xs font-medium uppercase tracking-wider"
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
            <td className="border-b border-border px-4 py-2 text-sm text-sub">{dim}</td>
            {rows.map((r) => (
              <ScoreCell key={r.id} score={r.scores[dim]} color={r.color} />
            ))}
          </tr>
        ))}
        <tr className="bg-card-hover">
          <td className="px-4 py-2 text-sm font-semibold text-text">Average</td>
          {rows.map((r) => (
            <td
              key={r.id}
              className="px-4 py-2 text-center font-data text-sm font-bold"
              style={{ color: r.color }}
            >
              {r.average !== null ? r.average.toFixed(1) : "—"}
            </td>
          ))}
        </tr>
        <tr>
          <td className="px-4 py-2 text-sm text-sub">Points done</td>
          {rows.map((r) => (
            <td key={r.id} className="px-4 py-2 text-center font-data text-sm text-sub">
              {pointsDone(r.sprint) ?? "—"}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}
