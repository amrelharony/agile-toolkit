"use client";

/**
 * Tab 4 — Velocity Summary. Committed and completed points and say/do,
 * read from the sprint's stories; the typed fields are the labelled
 * fallback for a team without pointed stories (and for the draft). Then
 * what wasn't finished, and how far through its backlog the product is.
 */

import { useId } from "react";
import { BarChart3, CircleDashed, Layers } from "lucide-react";
import { ChartFigure } from "@/components/shared/chart-card";
import { SectionCard } from "@/components/shared/section-card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { SAY_DO_GRADE_LABEL, completionPct, type SayDoGrade } from "@/lib/sprints/metrics";
import { storyPoints, totalStoryPoints } from "@/lib/sprints/plan";
import { fmt } from "@/lib/charts/chart-text";
import { cn } from "@/lib/utils";
import type { SprintReview } from "@/lib/stores/workspace-types";
import { STORY_STATUS_LABEL } from "../markdown";
import { numbersChartText, sourceNote, type BacklogProgress, type ReviewNumbers } from "../numbers";
import type { ReviewSource } from "../types";
import { NumCell } from "./form-fields";

const GRADE_TONE: Record<SayDoGrade, string> = {
  met: "text-success",
  over: "text-info",
  close: "text-warning",
  missed: "text-danger",
};

type TypedKey = "committed" | "completed" | "totalBacklog" | "backlogDone";

const FIELD = "bg-surface-deep border-border text-text font-data focus:border-accent/50";

export function VelocitySummaryTab({
  source,
  numbers,
  backlog,
}: {
  source: ReviewSource;
  numbers: ReviewNumbers;
  /** All stories' points; null when the numbers don't come from stories. */
  backlog: BacklogProgress | null;
}) {
  const { doc, writer, facts, sprint } = source;
  const uid = useId();
  const chart = numbersChartText(numbers, sprint?.name);
  const typed = numbers.source !== "stories";

  // NumCell commits on every blur; tabbing through a field mustn't create
  // the review of a sprint that has none.
  const setTyped = (key: TypedKey, value: number) => {
    if (writer.read()[key] === value) return;
    writer.update((d) => ({ ...d, [key]: value }) as SprintReview);
  };

  const max = Math.max(numbers.committed, numbers.completed ?? 0);
  const bars = [
    { label: "Committed", value: numbers.committed, tone: "bg-accent/40" },
    { label: "Completed", value: numbers.completed ?? 0, tone: "bg-accent" },
  ];
  const backlogPct = backlog ? completionPct(backlog.done, backlog.total) : null;
  const releasePct = completionPct(doc.backlogDone, doc.totalBacklog);

  return (
    <div className="space-y-6">
      <SectionCard title="Points" icon={BarChart3} contentClassName="space-y-4">
        <p className="text-xs text-sub">{sourceNote(numbers, sprint?.name)}</p>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Committed" value={`${fmt(numbers.committed)} pts`} />
          <Stat
            label="Completed"
            value={numbers.completed === null ? "Not recorded" : `${fmt(numbers.completed)} pts`}
          />
          <Stat
            label="Say/do"
            value={numbers.sayDo ? `${numbers.sayDo.pct}%` : "—"}
            note={numbers.sayDo ? SAY_DO_GRADE_LABEL[numbers.sayDo.grade] : undefined}
            tone={numbers.sayDo ? GRADE_TONE[numbers.sayDo.grade] : undefined}
          />
        </dl>
        {max > 0 && (
          <ChartFigure
            label="Committed and completed points"
            summary={chart.summary}
            table={chart.table}
          >
            <ul className="space-y-2">
              {bars.map((b) => (
                <li
                  key={b.label}
                  className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-xs"
                >
                  <span className="text-text">{b.label}</span>
                  <span className="h-3 overflow-hidden rounded-full bg-sub/15">
                    <span
                      className={cn("block h-full rounded-full", b.tone)}
                      style={{ width: `${Math.round((b.value / max) * 100)}%` }}
                    />
                  </span>
                  <span className="font-mono text-text">{fmt(b.value)}</span>
                </li>
              ))}
            </ul>
          </ChartFigure>
        )}
        {numbers.storyCount > 0 && (
          <p className="text-sm text-text">
            {numbers.doneCount} of {numbers.storyCount}{" "}
            {numbers.storyCount === 1 ? "story" : "stories"} done.
            {facts && facts.unestimatedDone > 0 && (
              <span className="text-sub">
                {" "}
                {facts.unestimatedDone} done{" "}
                {facts.unestimatedDone === 1 ? "story has" : "stories have"} no points, so{" "}
                {facts.unestimatedDone === 1 ? "it counts" : "they count"} 0.
              </span>
            )}
          </p>
        )}
      </SectionCard>

      {typed && (
        <SectionCard
          title={sprint ? "Typed numbers" : "Sprint velocity"}
          icon={BarChart3}
          contentClassName="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <NumberField
            id={`${uid}-committed`}
            label="Committed points"
            value={doc.committed}
            onCommit={(v) => setTyped("committed", v)}
          />
          <NumberField
            id={`${uid}-completed`}
            label="Completed points"
            value={doc.completed}
            onCommit={(v) => setTyped("completed", v)}
          />
        </SectionCard>
      )}

      {facts && facts.notDone.length > 0 && (
        <SectionCard
          title={`Not done: ${facts.notDone.length} ${facts.notDone.length === 1 ? "story" : "stories"}, ${fmt(totalStoryPoints(facts.notDone))} points`}
          icon={CircleDashed}
          iconClassName="text-warning"
        >
          <ul className="divide-y divide-border" aria-label="Stories not done">
            {facts.notDone.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 flex-1 basis-48 break-words text-sm text-text">
                  {s.title}
                </span>
                <span className="text-xs text-sub">{STORY_STATUS_LABEL[s.status] ?? s.status}</span>
                <span className="font-data text-xs text-sub">
                  {typeof s.points === "number" ? `${fmt(storyPoints(s))} pts` : "Not estimated"}
                </span>
              </li>
            ))}
          </ul>
          {sprint?.status === "active" && (
            <p className="mt-2 text-xs text-sub">
              Close the sprint from the Sprint Cockpit to carry these over to the next sprint or
              back to the backlog.
            </p>
          )}
        </SectionCard>
      )}

      {backlog && backlog.total > 0 ? (
        <SectionCard title="Product backlog" icon={Layers} iconClassName="text-accent-green">
          <p className="mb-2 text-sm text-text">
            {fmt(backlog.done)} of {fmt(backlog.total)} points done across all stories
            {backlogPct !== null && ` (${backlogPct}%)`}.
          </p>
          <Progress
            value={backlogPct ?? 0}
            className="h-2 bg-card"
            aria-label="Product backlog done"
          />
        </SectionCard>
      ) : (
        typed && (
          <SectionCard
            title="Release progress"
            icon={Layers}
            iconClassName="text-accent-green"
            contentClassName="space-y-4"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <NumberField
                id={`${uid}-total`}
                label="Total backlog points"
                value={doc.totalBacklog}
                onCommit={(v) => setTyped("totalBacklog", v)}
              />
              <NumberField
                id={`${uid}-done`}
                label="Done to date"
                value={doc.backlogDone}
                onCommit={(v) => setTyped("backlogDone", v)}
              />
            </div>
            {releasePct !== null && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-sub">
                  <span>Release progress</span>
                  <span className="font-data font-bold text-text">{releasePct}%</span>
                </div>
                <Progress
                  value={releasePct}
                  className="h-2 bg-card"
                  aria-label="Release progress"
                />
              </div>
            )}
          </SectionCard>
        )
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-deep/50 p-3">
      <dt className="text-xs text-sub">{label}</dt>
      <dd className={cn("font-data text-lg font-semibold text-text", tone)}>{value}</dd>
      {note && <dd className="text-xs text-sub">{note}</dd>}
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-sub">
        {label}
      </Label>
      <NumCell id={id} value={value} onCommit={onCommit} min={0} className={FIELD} />
    </div>
  );
}
