"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Crosshair, Pencil, Plus, Target, Trash2, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Progress } from "@/components/ui/progress";
import { InkMoment } from "@/components/ink/ink-moment";
import { ChartFigure } from "@/components/shared/chart-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import type { KeyResultCheckIn, Okr, Sprint, SprintGoal } from "@/lib/stores/workspace-types";
import {
  confidenceTrend,
  objectiveConfidence,
  objectivePercent,
  objectiveProgress,
  okrVerdict,
  progressTrend,
  sprintGoalsFor,
} from "@/lib/okrs/progress";
import { enoughData, MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { mannKendall } from "@/lib/analytics/trend-test";
import { GOAL_OUTCOME_LABEL } from "@/lib/sprints/goal-doc";
import { sprintHref } from "@/lib/sprints/use-selected-sprint";
import { focusAfterRemoval } from "@/app/(tools)/sprint-goal/focus";
import { CHART_MIN_DAYS, confidenceTrendText, progressTrendText } from "./chart-text";
import {
  EMPTY_KEY_RESULT,
  objectiveDraft,
  type KeyResultValues,
  type ObjectiveValues,
} from "./forms";
import { KeyResultForm } from "./key-result-form";
import { ConfidenceBadge, KR_DELETE_SELECTOR, KeyResultRow } from "./key-result-row";
import { ObjectiveForm } from "./objective-form";
import { quarterKey } from "./view";

// Recharts loads with the chart, not the page; the fixed-height box
// reserves the space while it does.
const ConfidenceTrendChart = dynamic(() => import("./charts").then((m) => m.ConfidenceTrendChart), {
  ssr: false,
  loading: () => <div className="h-[200px]" aria-hidden="true" />,
});
const ProgressTrendChart = dynamic(() => import("./charts").then((m) => m.ProgressTrendChart), {
  ssr: false,
  loading: () => <div className="h-[200px]" aria-hidden="true" />,
});

const OUTCOME_TONE = {
  met: "border-success/40 text-success",
  partly: "border-warning/40 text-warning",
  "not-met": "border-danger/40 text-danger",
} as const;

export interface ObjectiveHandlers {
  onEdit: (values: ObjectiveValues) => void;
  onDelete: () => void;
  onAddKr: (values: KeyResultValues) => void;
  onEditKr: (krId: string, values: KeyResultValues) => void;
  onDeleteKr: (krId: string) => void;
  onCheckIn: (krId: string, values: Omit<KeyResultCheckIn, "id">) => void;
  onRemoveCheckIn: (krId: string, checkIn: KeyResultCheckIn) => void;
}

/** An objective card's delete button, where the page moves focus after a delete (the next card's). */
export const OBJECTIVE_DELETE_SELECTOR = "[data-objective-delete]";

/** The "Add key result" button of the card for objective `okrId`. */
export const addKrSelector = (okrId: string) => `[data-okr-id="${okrId}"] [data-add-kr]`;

/**
 * One objective: its progress (the mean of its key results', lib/okrs;
 * "Not measured yet" with none, never 0%), confidence, verdict, key results
 * with their check-ins, the progress and confidence trends from those
 * check-ins, and the sprint goals that link it (Sprint Goal writes those
 * links; this card only reads them).
 */
export function ObjectiveCard({
  okr,
  now,
  today,
  quarters,
  goals,
  sprints,
  example,
  handlers,
}: {
  okr: Okr;
  now: Date;
  today: string;
  quarters: readonly string[];
  goals: readonly SprintGoal[];
  sprints: readonly Sprint[];
  /** An example objective: no "Add to the team" for its owner. */
  example: boolean;
  handlers: ObjectiveHandlers;
}) {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<"edit" | "add" | null>(null);
  useEffect(() => {
    if (editing || adding || !returnTo.current) return;
    (returnTo.current === "edit" ? editRef : addRef).current?.focus();
    returnTo.current = null;
  }, [editing, adding]);
  const krListRef = useRef<HTMLUListElement>(null);
  const headingId = useId();
  const chartId = useId();
  const progressChartId = useId();

  const measured = okr.keyResults.length > 0;
  const pct = objectivePercent(okr);
  // Every key result at its target: the same test the verdict and the
  // "okr-achieved" sound use, so a 99.6% that rounds to 100% gets no star.
  const achieved = measured && objectiveProgress(okr) >= 1;
  const confidence = objectiveConfidence(okr);
  const verdict = okrVerdict(okr, now);
  const progress = useMemo(() => progressTrend(okr), [okr]);
  const progressText = useMemo(() => progressTrendText(progress), [progress]);
  const trend = useMemo(() => confidenceTrend(okr), [okr]);
  const trendText = useMemo(() => confidenceTrendText(trend), [trend]);
  const mk = enoughData(trend.length, "trend") ? mannKendall(trend.map((p) => p.confidence)) : null;
  const links = sprintGoalsFor(okr.id, goals, sprints);
  const name = okr.objective.trim() || "Untitled objective";

  /** Delete a key result; focus moves to the next one's delete, or to "Add key result". */
  const deleteKr = (krId: string) => {
    const index = okr.keyResults.findIndex((k) => k.id === krId);
    handlers.onDeleteKr(krId);
    focusAfterRemoval(krListRef, KR_DELETE_SELECTOR, Math.max(0, index), () => addRef.current);
  };

  if (editing) {
    return (
      <article
        className="rounded-lg border border-accent/40 bg-surface p-4"
        aria-label={`Edit ${name}`}
        data-okr-id={okr.id}
      >
        <ObjectiveForm
          initial={objectiveDraft(okr)}
          quarters={quarters}
          offerAddToRoster={!example}
          autoFocus
          submitLabel="Save objective"
          onSave={(values) => {
            handlers.onEdit(values);
            returnTo.current = "edit";
            setEditing(false);
          }}
          onCancel={() => {
            returnTo.current = "edit";
            setEditing(false);
          }}
        />
      </article>
    );
  }

  return (
    <article
      className="space-y-4 rounded-lg border border-border bg-surface p-4"
      aria-labelledby={headingId}
      data-okr-id={okr.id}
    >
      <header className="space-y-2">
        <div className="flex items-start gap-3">
          <Target className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1.5">
              <h2 id={headingId} className="min-w-0 break-words text-base font-semibold text-text">
                {name}
              </h2>
              {/* An ink moment: a star drawn once when the objective reaches 100%. */}
              {achieved && <InkMoment mark="star" className="mt-0.5" />}
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-sub">
              <span className="font-data">{quarterKey(okr.quarter)}</span>
              <span className="inline-flex items-center gap-1">
                <User className="h-3 w-3" aria-hidden="true" />
                {okr.owner?.trim() || "No owner"}
              </span>
            </p>
            {okr.description && (
              <p className="mt-1 break-words text-sm text-sub">{okr.description}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              ref={editRef}
              label={`Edit objective: ${name}`}
              icon={<Pencil className="h-3.5 w-3.5" />}
              onClick={() => setEditing(true)}
              className="text-sub hover:text-text"
            />
            <IconButton
              label={`Delete objective: ${okr.objective.trim() || "untitled"}`}
              icon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={handlers.onDelete}
              className="text-sub hover:text-danger"
              data-objective-delete=""
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {measured ? (
            <>
              <Progress
                value={pct}
                className="h-2 min-w-[120px] flex-1"
                aria-label={`${name}: ${pct}% of the way`}
              />
              <Badge variant="outline" className="font-data">
                {pct}%
              </Badge>
            </>
          ) : (
            // With no key result nothing is measured: no bar at 0%.
            <Badge variant="outline" className="text-sub">
              Not measured yet
            </Badge>
          )}
          <ConfidenceBadge confidence={confidence} />
        </div>
        <p className="text-sm text-text">{verdict}</p>
      </header>

      <section aria-label={`Key results of ${name}`} className="space-y-2">
        {okr.keyResults.length > 0 && (
          <ul ref={krListRef} className="space-y-2">
            {okr.keyResults.map((kr) => (
              <KeyResultRow
                key={kr.id}
                kr={kr}
                today={today}
                onEdit={(values) => handlers.onEditKr(kr.id, values)}
                onDelete={() => deleteKr(kr.id)}
                onCheckIn={(values) => handlers.onCheckIn(kr.id, values)}
                onRemoveCheckIn={(c) => handlers.onRemoveCheckIn(kr.id, c)}
              />
            ))}
          </ul>
        )}
        {adding ? (
          <div className="rounded-md border border-accent/40 bg-bg p-3">
            <KeyResultForm
              initial={EMPTY_KEY_RESULT}
              autoFocus
              submitLabel="Add key result"
              onSave={(values) => {
                handlers.onAddKr(values);
                returnTo.current = "add";
                setAdding(false);
              }}
              onCancel={() => {
                returnTo.current = "add";
                setAdding(false);
              }}
            />
          </div>
        ) : (
          <Button
            ref={addRef}
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setAdding(true)}
            aria-label={`Add key result to ${name}`}
            data-add-kr=""
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add key result
          </Button>
        )}
      </section>

      {measured && (
        <section aria-labelledby={progressChartId} className="space-y-2">
          <h3 id={progressChartId} className="text-sm font-semibold text-text">
            Progress over time
          </h3>
          {progress.length >= CHART_MIN_DAYS ? (
            <ChartFigure
              labelledBy={progressChartId}
              summary={progressText.summary}
              table={progressText.table}
              plotClassName="h-[200px]"
            >
              <ProgressTrendChart data={progress} />
            </ChartFigure>
          ) : (
            // Every scored check-in is a check-in day, so this covers confidence too.
            <NotEnoughData
              have={progress.length}
              need={CHART_MIN_DAYS}
              unit={["day", "days"]}
              action="Check in on"
              what="how progress and confidence move"
            />
          )}
        </section>
      )}

      {measured && progress.length >= CHART_MIN_DAYS && (
        <section aria-labelledby={chartId} className="space-y-2">
          <h3 id={chartId} className="text-sm font-semibold text-text">
            Confidence over time
          </h3>
          {trend.length >= CHART_MIN_DAYS ? (
            <ChartFigure
              labelledBy={chartId}
              summary={trendText.summary}
              table={trendText.table}
              plotClassName="h-[200px]"
            >
              <ConfidenceTrendChart data={trend} />
            </ChartFigure>
          ) : (
            <NotEnoughData
              have={trend.length}
              need={CHART_MIN_DAYS}
              unit={["day with a scored check-in", "days with a scored check-in"]}
              action="Check in on"
              what="how confidence moves"
            />
          )}
          {mk && (
            <AdvancedAnalysis summary="Advanced analysis: is confidence trending?">
              <p className="text-sm text-text">
                {mk.significant && mk.trend !== "none"
                  ? `Confidence is trending ${mk.trend === "up" ? "up" : "down"} across ${trend.length} check-in days (Mann-Kendall, p = ${mk.pValue.toFixed(3)}).`
                  : `No clear trend across ${trend.length} check-in days (Mann-Kendall, p = ${mk.pValue.toFixed(3)}): the moves so far could be noise.`}
              </p>
              <p className="text-xs text-sub">
                Run from {MIN_SAMPLE.trend} check-in days; a rank test on the mean confidence per
                day, so one odd reading can&apos;t decide it.
              </p>
            </AdvancedAnalysis>
          )}
        </section>
      )}

      <section aria-label={`Sprint goals that move ${name}`} className="space-y-1.5">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
          <Crosshair className="h-4 w-4 text-sub" aria-hidden="true" />
          Moves these sprint goals
        </h3>
        {links.length === 0 ? (
          <p className="text-xs text-sub">
            No sprint goal moves this objective yet.{" "}
            <Link href="/sprint-goal" className="font-medium text-accent hover:underline">
              Link it from Sprint Goal
            </Link>
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {links.map((g) => (
              <li key={g.goalId}>
                <Link
                  href={g.sprintId ? sprintHref("/sprint-goal", g.sprintId) : "/sprint-goal"}
                  className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1 text-xs text-text hover:border-accent/40 hover:text-accent"
                >
                  <span className="font-medium">{g.sprintName}</span>
                  {g.goal && <span className="min-w-0 truncate text-sub">{g.goal}</span>}
                  {g.met && (
                    <Badge variant="outline" className={OUTCOME_TONE[g.met]}>
                      {GOAL_OUTCOME_LABEL[g.met]}
                    </Badge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
