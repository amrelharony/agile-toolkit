"use client";

/**
 * The frame Burndown and Burnup share around one shared sprint: which sprint
 * (the picker every sprint tool follows), "Loading sprints…" while saved
 * sprints load or old data moves in, the empty state with an in-memory
 * example, the prompt for sprints without real dates, and the sprint
 * settings. Each tool renders its own chart and daily log inside it.
 */

import { useId, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { CalendarDays, FlaskConical, Plus, Settings2, Sparkles } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { SmartInput } from "@/components/shared/smart-input";
import { NewSprintDialog } from "@/components/sprints/new-sprint-dialog";
import { SprintPicker, nextSprintName } from "@/components/sprints/sprint-picker";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import { exampleSprints } from "@/lib/sprints/example";
import { useSprintMigrationStatus } from "@/lib/sprints/migration-status";
import {
  DEFAULT_SPRINT_DAYS,
  dayDate,
  endDateFor,
  hasSyntheticDates,
  seriesFor,
  sprintLengthDays,
  todayIso,
} from "@/lib/sprints/series";
import { useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { setPlannedPoints, setSprintDates, setSprintLength, setSprintStart } from "./series-writes";

export type SprintToolId = "burndown" | "burnup";

const TOOL_NAME: Record<SprintToolId, string> = { burndown: "Burndown", burnup: "Burnup" };
const OTHER_TOOL: Record<SprintToolId, string> = { burndown: "Burnup", burnup: "Burndown" };

/** Longest sprint the length field accepts, in days. */
const MAX_SPRINT_DAYS = 90;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "16 Oct", or "" when `iso` isn't a date. */
export function shortDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "";
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/** One decimal at most: 12, 12.5. */
export function formatPoints(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/* -------------------------------------------------------------------------- */
/*  Inputs                                                                     */
/* -------------------------------------------------------------------------- */

export interface DraftInputProps extends Omit<
  ComponentProps<typeof Input>,
  "value" | "defaultValue" | "onChange"
> {
  value: string;
  /** Called once, on blur or Enter, when the text changed. */
  onCommit: (value: string) => void;
}

/**
 * An input that keeps keystrokes local and saves once, on blur or Enter.
 * Saving every keystroke would write half-typed numbers ("3" on the way to
 * "36") to the shared sprint, log them, and resize nothing for a reason.
 * Escape drops the draft.
 */
export function DraftInput({ value, onCommit, onBlur, onKeyDown, ...rest }: DraftInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft !== value) onCommit(draft);
  };
  return (
    <Input
      {...rest}
      value={draft ?? value}
      onChange={(e) => {
        if (!rest.readOnly) setDraft(e.target.value);
      }}
      onBlur={(e) => {
        commit();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape" && draft !== null) {
          setDraft(null);
        }
      }}
    />
  );
}

/**
 * A number another tool logged (or the plan), shown dimmed under an empty
 * input. Point the input's `aria-describedby` at `id`.
 */
export function DerivedCaption({ id, value, from }: { id: string; value: number; from: string }) {
  return (
    <p id={id} data-derived="" className="mt-1 text-xs italic text-sub">
      {formatPoints(value)} from {from}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sprint settings                                                            */
/* -------------------------------------------------------------------------- */

/** Settings changes as history payload fields (the tools' old config keys). */
export type SprintSettingsChange = {
  totalPoints?: number;
  sprintDays?: number;
  sprintStartDate?: string;
};

/**
 * Planned points, length and start date of the shared sprint. A change here
 * changes the sprint for every tool, which the hint says.
 */
export function SprintSettings({
  tool,
  sprint,
  readOnly,
  onChanged,
}: {
  tool: SprintToolId;
  sprint: Sprint;
  readOnly: boolean;
  onChanged: (change: SprintSettingsChange) => void;
}) {
  const length = sprintLengthDays(sprint);
  const start = sprint.startDate.slice(0, 10);
  // The velocity forecast for the next sprint, offered while the field is
  // empty (Tab accepts it).
  const prediction = usePredictedDefault<number>(
    "velocity",
    "nextSprintPlan",
    sprint.pointsPlanned
  );

  const commitPoints = (raw: string | number) => {
    const n = typeof raw === "number" ? raw : Number(raw);
    if ((typeof raw === "string" && raw.trim() === "") || !Number.isFinite(n) || n < 0) return;
    if (setPlannedPoints(sprint.id, n)) onChanged({ totalPoints: n });
  };
  const commitLength = (raw: string) => {
    const n = Math.round(Number(raw));
    if (raw.trim() === "" || !Number.isFinite(n)) return;
    const days = Math.max(1, Math.min(MAX_SPRINT_DAYS, n));
    if (setSprintLength(sprint.id, days)) onChanged({ sprintDays: days });
  };
  const commitStart = (raw: string) => {
    if (!ISO_DATE.test(raw) || raw === start) return;
    if (setSprintStart(sprint.id, raw)) onChanged({ sprintStartDate: raw });
  };

  const others =
    tool === "burndown"
      ? "Shared with Burnup, Velocity and Sprint Metrics."
      : "Shared with Burndown, Velocity and Sprint Metrics.";

  return (
    <SectionCard title="Sprint settings" icon={Settings2} titleSize="lg" headerClassName="pb-4">
      <p className="mb-4 text-xs text-sub">
        {readOnly
          ? "Example sprint: these can't be changed."
          : `${others} A change here shows there too.`}
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Planned points">
          {(control) =>
            readOnly ? (
              <Input {...control} type="number" readOnly value={String(sprint.pointsPlanned)} />
            ) : (
              <SmartInput<number>
                predicted={prediction}
                onAccept={(v) => commitPoints(Math.max(0, Math.round(v)))}
                render={({ ghost, accept, chip }) => (
                  <>
                    <DraftInput
                      {...control}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      value={String(sprint.pointsPlanned)}
                      placeholder={ghost}
                      onKeyDown={(e) => {
                        // Tab takes the suggestion only while the field is
                        // empty, so it never replaces a typed number.
                        if (e.key === "Tab" && e.currentTarget.value === "" && ghost) {
                          e.preventDefault();
                          accept();
                        }
                      }}
                      onCommit={commitPoints}
                      className="font-data"
                    />
                    {chip}
                  </>
                )}
              />
            )
          }
        </Field>
        <Field label="Length (days)" hint={`Last day: ${shortDate(dayDate(sprint, length))}`}>
          {(control) => (
            <DraftInput
              {...control}
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_SPRINT_DAYS}
              readOnly={readOnly}
              value={String(length)}
              onCommit={commitLength}
              className="font-data"
            />
          )}
        </Field>
        <Field label="First day">
          {(control) => (
            <Input
              {...control}
              type="date"
              readOnly={readOnly}
              value={start}
              onChange={(e) => {
                if (!readOnly) commitStart(e.target.value);
              }}
              className="font-data"
            />
          )}
        </Field>
      </div>
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/*  States around the sprint                                                   */
/* -------------------------------------------------------------------------- */

function LoadingSprints() {
  return (
    <p role="status" className="py-12 text-center text-sm text-sub">
      Loading sprints…
    </p>
  );
}

function EmptySprints({
  tool,
  onCreate,
  onExample,
}: {
  tool: SprintToolId;
  onCreate: () => void;
  onExample: () => void;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-12 text-center"
    >
      <h2 id={titleId} className="font-display text-lg text-text">
        No sprints yet
      </h2>
      <p className="max-w-prose text-sm text-sub">
        {TOOL_NAME[tool]} charts a shared sprint. Create one and {OTHER_TOOL[tool]}, Velocity and
        Sprint Metrics see it too.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" variant="toolkit" onClick={onCreate}>
          <Plus aria-hidden="true" />
          Create your first sprint
        </Button>
        <Button type="button" variant="outline" onClick={onExample}>
          <Sparkles aria-hidden="true" />
          See an example
        </Button>
      </div>
    </section>
  );
}

function PreviewNotice({ onStart, onBack }: { onStart: () => void; onBack: () => void }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-info/30 bg-info/10 px-4 py-2.5 text-sm text-text"
    >
      <FlaskConical className="h-4 w-4 shrink-0 text-info" aria-hidden="true" />
      <p className="min-w-[14rem] flex-1">
        <span className="font-medium">Example sprint.</span> Look around: nothing here is saved, and
        it can&apos;t be changed.
      </p>
      <Button type="button" size="sm" variant="toolkit" onClick={onStart}>
        Start your own
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onBack}>
        Back
      </Button>
    </div>
  );
}

/** For sprints without real dates (the old Velocity tool's placeholder dates). */
function SetSprintDates({
  sprint,
  onSaved,
}: {
  sprint: Sprint;
  onSaved: (change: SprintSettingsChange) => void;
}) {
  const [start, setStart] = useState(() => todayIso());
  const [end, setEnd] = useState(() => endDateFor(todayIso(), DEFAULT_SPRINT_DAYS));
  const [errors, setErrors] = useState<{ start?: string; end?: string }>({});

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: { start?: string; end?: string } = {};
    if (!ISO_DATE.test(start)) next.start = "Pick the first day of the sprint.";
    if (!ISO_DATE.test(end)) next.end = "Pick the last day of the sprint.";
    else if (!next.start && end <= start) next.end = "The last day comes after the first.";
    setErrors(next);
    if (next.start || next.end) return;
    const saved = setSprintDates(sprint.id, start, end);
    if (saved) onSaved({ sprintStartDate: start, sprintDays: sprintLengthDays(saved) });
  };

  return (
    <SectionCard title="Set this sprint's dates to chart it" icon={CalendarDays} titleSize="lg">
      <p className="mb-4 max-w-prose text-sm text-sub">
        {sprint.name} has no start and end dates yet, so its days can&apos;t be placed on the chart.
        The dates are shared with every sprint tool.
      </p>
      <form onSubmit={submit} noValidate className="flex flex-wrap items-start gap-4">
        <Field label="First day" required error={errors.start}>
          {(control) => (
            <Input
              {...control}
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="font-data"
            />
          )}
        </Field>
        <Field label="Last day" required error={errors.end}>
          {(control) => (
            <Input
              {...control}
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="font-data"
            />
          )}
        </Field>
        <Button type="submit" variant="toolkit" className="sm:mt-7">
          Save dates
        </Button>
      </form>
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/*  The shell                                                                  */
/* -------------------------------------------------------------------------- */

export interface SprintToolContext {
  sprint: Sprint;
  series: SprintSeries;
  /** The example preview: show everything, change nothing. */
  readOnly: boolean;
}

export interface SprintToolShellProps {
  tool: SprintToolId;
  /** Log a change to the sprint's dates made from the dates prompt. */
  onSettingsChanged: (sprintId: string, change: SprintSettingsChange) => void;
  children: (ctx: SprintToolContext) => ReactNode;
}

/**
 * Picks the sprint (shared with every sprint tool) and renders the tool for
 * it, or the state around it: loading, no sprints yet (with an example
 * preview that is never saved), or a sprint that needs dates first.
 */
export function SprintToolShell({ tool, onSettingsChanged, children }: SprintToolShellProps) {
  const hydrated = useWorkspaceHydrated();
  const migration = useSprintMigrationStatus();
  const { sprints, selected, select } = useSelectedSprint();
  const allSeries = useWorkspaceStore((s) => s.sprintSeries);
  const [preview, setPreview] = useState(false);
  const [creating, setCreating] = useState(false);
  const headingId = useId();

  // Built in memory each time the preview opens; never written anywhere.
  const example = useMemo(() => (preview ? exampleSprints(todayIso()) : null), [preview]);
  const series = useMemo(
    () => (selected ? seriesFor(allSeries, selected.id) : null),
    [allSeries, selected]
  );

  const dialog = (
    <NewSprintDialog
      open={creating}
      onOpenChange={setCreating}
      defaultName={nextSprintName(sprints)}
      onCreated={(sprint) => {
        select(sprint.id);
        setPreview(false);
      }}
    />
  );

  if (!hydrated || migration === "pending") return <LoadingSprints />;

  if (example) {
    return (
      <div className="space-y-6">
        <PreviewNotice onStart={() => setCreating(true)} onBack={() => setPreview(false)} />
        {children({
          sprint: example.current,
          series: seriesFor(example.series, example.current.id),
          readOnly: true,
        })}
        {dialog}
      </div>
    );
  }

  if (!selected || !series) {
    return (
      <>
        <EmptySprints
          tool={tool}
          onCreate={() => setCreating(true)}
          onExample={() => setPreview(true)}
        />
        {dialog}
      </>
    );
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby={headingId}>
        <h2 id={headingId} className="sr-only">
          Which sprint
        </h2>
        <SprintPicker sprints={sprints} selectedId={selected.id} onSelect={select} />
        {selected.goal && <p className="mt-2 text-sm text-sub">Goal: {selected.goal}</p>}
      </section>
      {hasSyntheticDates(selected) ? (
        <SetSprintDates
          key={selected.id}
          sprint={selected}
          onSaved={(change) => onSettingsChanged(selected.id, change)}
        />
      ) : (
        children({ sprint: selected, series, readOnly: false })
      )}
    </div>
  );
}
