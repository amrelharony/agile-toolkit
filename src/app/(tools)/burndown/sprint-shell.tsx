"use client";

/**
 * The frame Burndown and Burnup share around one shared sprint: which sprint
 * (the picker every sprint tool follows), "Loading sprints…" while saved
 * sprints load or old data moves in, the first run with an in-memory example
 * (each tool renders its own empty state and example notice), the prompt
 * for sprints without real dates, and the sprint settings. Each tool renders
 * its own chart and daily log inside it, from the sprint, its log, the
 * workspace's stories and the team's working days.
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { CalendarDays, Settings2 } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { SmartInput } from "@/components/shared/smart-input";
import { NewSprintDialog } from "@/components/sprints/new-sprint-dialog";
import { SprintPicker, nextSprintName } from "@/components/sprints/sprint-picker";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import { cadenceCalendar, MAX_SPRINT_LENGTH_DAYS } from "@/lib/sprints/cadence";
import type { WorkingCalendar } from "@/lib/sprints/calendar";
import { useSprintMigrationStatus } from "@/lib/sprints/migration-status";
import {
  dayDate,
  endDateFor,
  hasSyntheticDates,
  seriesFor,
  sprintLengthDays,
  sprintWorkingDays,
  todayIso,
} from "@/lib/sprints/series";
import { useCeremonyCadence } from "@/lib/sprints/use-ceremony-cadence";
import { useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries, Story } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { cn } from "@/lib/utils";
import type { BurnExample } from "./example";
import { setPlannedPoints, setSprintDates, setSprintLength, setSprintStart } from "./series-writes";
import { validateLength, validatePlannedPoints, validateStartDate } from "./validate";

export type SprintToolId = "burndown" | "burnup";

const NO_STORIES: Story[] = [];

/** "16 Oct", or "" when `iso` isn't a date. */
export function shortDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "";
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/** "Sat", "Mon", or "" when `iso` isn't a date. */
export function weekdayShort(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "";
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-GB", {
    weekday: "short",
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
  /**
   * Called once, on blur or Enter, when the text changed. Return a message
   * to refuse it: the text stays, the message shows under the field and the
   * input is marked invalid, and nothing is saved.
   */
  onCommit: (value: string) => string | null | void;
  /** Classes for the wrapper (grid placement); `className` styles the input. */
  wrapperClassName?: string;
  /** The refusal for text a number field can't read ("5-", "1e"). */
  badInputMessage?: string;
}

/**
 * An input that keeps keystrokes local and saves once, on blur or Enter.
 * Saving every keystroke would write half-typed numbers ("3" on the way to
 * "36") to the shared sprint, log them, and resize nothing for a reason.
 * Escape drops the draft (and its error). A number field reports text it
 * can't read as "" (validity.badInput), which would clear the saved day:
 * that is refused instead, and the refusal is announced, as Field's is.
 */
export function DraftInput({
  value,
  onCommit,
  onBlur,
  onKeyDown,
  wrapperClassName,
  badInputMessage = "Enter a number.",
  ...rest
}: DraftInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [badInput, setBadInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const commit = () => {
    if (draft === null) return;
    if (badInput) {
      setError(badInputMessage);
      return;
    }
    if (draft === value) {
      setDraft(null);
      setError(null);
      return;
    }
    const refused = onCommit(draft);
    if (typeof refused === "string") {
      setError(refused);
      return;
    }
    setDraft(null);
    setError(null);
  };
  const describedBy =
    [rest["aria-describedby"], error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("min-w-0", wrapperClassName)}>
      <Input
        {...rest}
        aria-describedby={describedBy}
        aria-invalid={error ? true : rest["aria-invalid"]}
        value={draft ?? value}
        onChange={(e) => {
          if (rest.readOnly) return;
          setDraft(e.target.value);
          setBadInput(e.currentTarget.validity?.badInput === true);
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
            setBadInput(false);
            setError(null);
          }
        }}
      />
      {error && (
        <p id={errorId} className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
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
 * changes the sprint for every tool, which the hint says. Each field saves
 * on blur or Enter, and refuses (with a message) what it can't save.
 */
export function SprintSettings({
  tool,
  sprint,
  calendar,
  readOnly,
  onChanged,
}: {
  tool: SprintToolId;
  sprint: Sprint;
  calendar: WorkingCalendar;
  readOnly: boolean;
  onChanged: (change: SprintSettingsChange) => void;
}) {
  const length = sprintLengthDays(sprint);
  const working = sprintWorkingDays(sprint, calendar);
  const start = sprint.startDate.slice(0, 10);
  // The velocity forecast for the next sprint, offered while the field is
  // empty (Tab accepts it).
  const prediction = usePredictedDefault<number>(
    "velocity",
    "nextSprintPlan",
    sprint.pointsPlanned
  );

  const commitPoints = (raw: string | number) => {
    const r = validatePlannedPoints(String(raw));
    if (!r.ok) return r.error;
    if (setPlannedPoints(sprint.id, r.value)) onChanged({ totalPoints: r.value });
    return null;
  };
  const commitLength = (raw: string) => {
    const r = validateLength(raw);
    if (!r.ok) return r.error;
    if (setSprintLength(sprint.id, r.value)) onChanged({ sprintDays: r.value });
    return null;
  };
  const commitStart = (raw: string) => {
    const r = validateStartDate(raw);
    if (!r.ok) return r.error;
    if (r.value !== start && setSprintStart(sprint.id, r.value)) {
      onChanged({ sprintStartDate: r.value });
    }
    return null;
  };

  const others =
    tool === "burndown"
      ? "Shared with Burnup, Velocity, Sprint Metrics and the Sprint cockpit."
      : "Shared with Burndown, Velocity, Sprint Metrics and the Sprint cockpit.";

  return (
    <SectionCard title="Sprint settings" icon={Settings2} titleSize="lg" headerClassName="pb-4">
      <p className="mb-4 text-xs text-sub">
        {readOnly
          ? "Example sprint: these can't be changed."
          : `${others} A change here shows there too.`}
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Planned points" hint="The sprint's commitment (set in Sprint Planning)">
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
        <Field
          label="Length (days)"
          hint={`Last day: ${shortDate(dayDate(sprint, length))} · ${working} working ${
            working === 1 ? "day" : "days"
          }`}
        >
          {(control) => (
            <DraftInput
              {...control}
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_SPRINT_LENGTH_DAYS}
              readOnly={readOnly}
              value={String(length)}
              onCommit={commitLength}
              className="font-data"
            />
          )}
        </Field>
        <Field label="First day">
          {(control) => (
            <DraftInput
              {...control}
              type="date"
              readOnly={readOnly}
              value={start}
              onCommit={commitStart}
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

/** For sprints without real dates (the old Velocity tool's placeholder dates). */
function SetSprintDates({
  sprint,
  lengthDays,
  onSaved,
}: {
  sprint: Sprint;
  lengthDays: number;
  onSaved: (change: SprintSettingsChange) => void;
}) {
  const [start, setStart] = useState(() => todayIso());
  const [end, setEnd] = useState(() => endDateFor(todayIso(), lengthDays));
  const [errors, setErrors] = useState<{ start?: string; end?: string }>({});

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: { start?: string; end?: string } = {};
    const first = validateStartDate(start);
    const last = validateStartDate(end);
    if (!first.ok) next.start = "Pick the first day of the sprint.";
    if (!last.ok) next.end = "Pick the last day of the sprint.";
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
  /** Every story in the workspace (or the example's): the burn picks the sprint's. */
  stories: readonly Story[];
  /** The team's working days and holidays, from the cadence. */
  calendar: WorkingCalendar;
  /** Today, YYYY-MM-DD, as the page opened. */
  today: string;
  /** The example preview: show everything, change nothing. */
  readOnly: boolean;
}

export interface SprintToolShellProps {
  tool: SprintToolId;
  /** The tool's example (its example.ts), built in memory when the preview opens. */
  example: (today: string) => BurnExample;
  /** The first run: no sprints yet. Each tool renders its own EmptyState. */
  renderEmpty: (actions: { onCreate: () => void; onLoadExample: () => void }) => ReactNode;
  /** Over the example preview. Each tool renders its own ExampleNotice. */
  renderNotice: (actions: { onStart: () => void; onClear: () => void }) => ReactNode;
  /** Log a change to the sprint's dates made from the dates prompt. */
  onSettingsChanged: (sprintId: string, change: SprintSettingsChange) => void;
  children: (ctx: SprintToolContext) => ReactNode;
}

/**
 * Picks the sprint (shared with every sprint tool) and renders the tool for
 * it, or the state around it: loading, no sprints yet (with an example
 * preview that is never saved), or a sprint that needs dates first.
 */
export function SprintToolShell({
  example: buildExample,
  renderEmpty,
  renderNotice,
  onSettingsChanged,
  children,
}: SprintToolShellProps) {
  const hydrated = useWorkspaceHydrated();
  const migration = useSprintMigrationStatus();
  const { sprints, selected, select } = useSelectedSprint();
  const allSeries = useWorkspaceStore((s) => s.sprintSeries);
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const [cadence] = useCeremonyCadence();
  const calendar = useMemo(() => cadenceCalendar(cadence), [cadence]);
  const [today] = useState(() => todayIso());
  const [preview, setPreview] = useState(false);
  const [creating, setCreating] = useState(false);
  const headingId = useId();
  // Loading or clearing the example, and starting a sprint, swap out the
  // view the focused control was in: focus moves to the view that replaced
  // it (the example's notice, the empty state, the sprint), not the page top.
  const viewRef = useRef<HTMLDivElement>(null);
  const focusView = useRef(false);
  useEffect(() => {
    if (!focusView.current) return;
    focusView.current = false;
    viewRef.current?.focus();
  });
  const showPreview = (on: boolean) => {
    focusView.current = true;
    setPreview(on);
  };

  // Built in memory each time the preview opens; never written anywhere.
  const example = useMemo(
    () => (preview ? buildExample(today) : null),
    [preview, buildExample, today]
  );
  const series = useMemo(
    () => (selected ? seriesFor(allSeries, selected.id) : null),
    [allSeries, selected]
  );

  const dialog = (
    <NewSprintDialog
      open={creating}
      onOpenChange={setCreating}
      defaultName={nextSprintName(sprints)}
      defaultLengthDays={cadence.sprintLengthDays}
      onCreated={(sprint) => {
        select(sprint.id);
        showPreview(false);
      }}
    />
  );

  if (!hydrated || migration === "pending") return <LoadingSprints />;

  if (example) {
    return (
      <div className="space-y-6">
        <div ref={viewRef} tabIndex={-1} className="outline-none">
          {renderNotice({ onStart: () => setCreating(true), onClear: () => showPreview(false) })}
        </div>
        {children({
          sprint: example.current,
          series: seriesFor(example.series, example.current.id),
          stories: example.stories,
          calendar,
          today,
          readOnly: true,
        })}
        {dialog}
      </div>
    );
  }

  if (!selected || !series) {
    return (
      <>
        <div ref={viewRef} tabIndex={-1} className="outline-none">
          {renderEmpty({
            onCreate: () => setCreating(true),
            onLoadExample: () => showPreview(true),
          })}
        </div>
        {dialog}
      </>
    );
  }

  return (
    <div className="space-y-6">
      <section ref={viewRef} tabIndex={-1} aria-labelledby={headingId} className="outline-none">
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
          lengthDays={cadence.sprintLengthDays}
          onSaved={(change) => onSettingsChanged(selected.id, change)}
        />
      ) : (
        children({ sprint: selected, series, stories, calendar, today, readOnly: false })
      )}
    </div>
  );
}
