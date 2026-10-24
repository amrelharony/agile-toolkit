"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Calendar,
  CheckCircle2,
  Lightbulb,
  Pencil,
  Search,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ActionRow } from "@/components/shared/action-row";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { ResetButton } from "@/components/shared/reset-button";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { generateDesignSprintPrompts } from "@/lib/ai-prompts/design-sprint";
import { designSprintToday, shownDesignSprintDay } from "@/lib/design-sprint/day";
import { DESIGN_SPRINT_DAY_NAMES, newDesignSprintPlan } from "@/lib/design-sprint/plan";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { DESIGN_SPRINT_ACTIONS } from "@/lib/history/event-actions";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  DesignSprintDayNumber,
  DesignSprintPlan,
  Workspace,
} from "@/lib/stores/workspace-types";
import type { WorkingCalendar } from "@/lib/sprints/calendar";
import { todayLocalISO } from "@/lib/utils/formatters";
import { undoable } from "@/lib/utils/undoable";
import { DayPanel, type RecordEvent } from "./day-panel";
import {
  dateRange,
  dayOutputs,
  findingsSent,
  planDays,
  shortDay,
  sprintToday,
  startsInText,
  statusText,
  taskTotals,
  workingDaysLeft,
} from "./doc";
import { buildExample } from "./example";
import { toMarkdown } from "./markdown";
import {
  DetailsEditor,
  StartSprintForm,
  sameDetails,
  withDetails,
  type DetailsValues,
} from "./start-form";
import { DayTimeline, dayOnDate } from "./timeline";
import { designSprintVerdict } from "./verdict";
import {
  readPlan,
  updatePlan,
  useDesignSprintPlan,
  useTeamCalendar,
  writePlanRaw,
} from "./use-design-sprint";
import { completeSprint, reopenSprint } from "./writes";

const TITLE = "Design Sprint Tracker";
const DESCRIPTION =
  "A five-day Google Ventures design sprint: Map, Sketch, Decide, Prototype and Test. Today's day comes from the start date, each day has a place for what it produces, and Test-day findings go on to hypotheses or the backlog.";
const CATEGORY = "Workshops & Facilitation";

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function DesignSprintClient() {
  const plan = useDesignSprintPlan();
  const calendar = useTeamCalendar();
  const today = todayLocalISO();
  const { log } = useHistoryLogger("design-sprint");
  const announce = useAnnounce();

  // Starting, loading the example, a reset and clearing the example swap the
  // whole view, and the control just pressed goes with it. Focus lands on
  // the new view instead of the page body: a sprint's verdict, which says
  // where it stands, or the start form's name.
  const swapped = useRef(false);
  const verdictRef = useRef<HTMLParagraphElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const hasPlan = plan !== null;
  useEffect(() => {
    if (!swapped.current) return;
    swapped.current = false;
    const target = hasPlan
      ? verdictRef.current
      : startRef.current?.querySelector<HTMLElement>("input");
    target?.focus();
  }, [hasPlan]);
  const focusAfterSwap = () => {
    swapped.current = true;
  };

  function start(values: DetailsValues) {
    // An agent may have started one meanwhile: keep it, the page now shows it.
    if (readPlan()) return;
    const t = designSprintToday(values.startDate, today, calendar);
    const next = newDesignSprintPlan(values, { currentDay: shownDesignSprintDay(t) });
    focusAfterSwap();
    writePlanRaw(next);
    log(DESIGN_SPRINT_ACTIONS.SPRINT_STARTED, {
      sprintId: next.id,
      name: next.name,
      startDate: next.startDate,
      description: next.description,
    });
    announce(`Started the design sprint “${next.name}”.`);
  }

  function loadExample() {
    if (readPlan()) return;
    focusAfterSwap();
    writePlanRaw(buildExample(today, calendar));
  }

  return (
    <ToolPageWrapper
      toolId="design-sprint"
      title={TITLE}
      description={DESCRIPTION}
      category={CATEGORY}
    >
      {plan ? (
        <SprintView
          key={plan.id}
          plan={plan}
          today={today}
          calendar={calendar}
          log={log}
          announce={announce}
          verdictRef={verdictRef}
          onCleared={focusAfterSwap}
        />
      ) : (
        <div className="space-y-4">
          <SectionCard title="Start a design sprint" icon={Sparkles} className="max-w-3xl">
            <div ref={startRef}>
              <StartSprintForm today={today} calendar={calendar} onStart={start} />
            </div>
          </SectionCard>
          <EmptyState
            icon={Lightbulb}
            action={<LoadExampleButton onLoad={loadExample} />}
            className="max-w-3xl"
          >
            No design sprint yet. Start one above with the five days and their usual tasks, or load
            an example to see a sprint on Test day.
          </EmptyState>
        </div>
      )}
    </ToolPageWrapper>
  );
}

function SprintView({
  plan,
  today,
  calendar,
  log,
  announce,
  verdictRef,
  onCleared,
}: {
  plan: DesignSprintPlan;
  today: string;
  calendar: WorkingCalendar;
  log: RecordEvent;
  announce: (message: string) => void;
  /** The verdict, where focus lands after the sprint starts or the example loads. */
  verdictRef: RefObject<HTMLParagraphElement>;
  /** Called just before a reset or Clear example removes the plan (and this view). */
  onCleared: () => void;
}) {
  const example = isExampleId(plan.id);
  const t = useMemo(
    () => sprintToday(plan.startDate, today, calendar),
    [plan.startDate, today, calendar]
  );
  // The day on screen: today's until the user opens another. Opening a day
  // never moves the sprint on.
  const [picked, setPicked] = useState<DesignSprintDayNumber | null>(null);
  const viewed = picked ?? shownDesignSprintDay(t);
  const [editingDetails, setEditingDetails] = useState(false);
  const { refFor, returnTo } = useReturnFocus();
  const resetCopy = useRef<DesignSprintPlan | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  const record: RecordEvent = (action, payload) => {
    if (!example) log(action, { sprintId: plan.id, ...payload });
  };

  // What counts as sent is read from the hand-off targets as the page
  // renders (liveSentTo), so a hypothesis deleted meanwhile, by an agent
  // say, re-renders it. Stories are read below for the prompt.
  useWorkspaceStore((s) => s.hypothesisTrackers);

  const days = planDays(plan);
  const totals = taskTotals(days);
  const sent = findingsSent(plan);
  const verdict = designSprintVerdict(plan, t);
  const pct = totals.total === 0 ? 0 : Math.round((totals.done / totals.total) * 100);
  const running = t.status === "running" && t.day !== null;

  function view(day: DesignSprintDayNumber) {
    setPicked(day);
  }

  // From inside a day ("Open Map day"): the panel remounts for the new day
  // and the button goes with it, so focus moves to the new day's heading.
  function openDay(day: DesignSprintDayNumber) {
    setPicked(day);
    returnTo("day-heading");
  }

  function saveDetails(values: DetailsValues) {
    setEditingDetails(false);
    returnTo("details");
    if (sameDetails(plan, values)) return;
    updatePlan((p) => withDetails(p, values));
    // A new start date moves today's day: show that one.
    if (values.startDate !== plan.startDate) setPicked(null);
    announce("Saved the sprint details.");
  }

  function clearExample() {
    const captured = readPlan();
    if (!captured || !isExampleId(captured.id)) return;
    undoable({
      label: "Cleared the example",
      apply: () => {
        onCleared();
        writePlanRaw(null);
      },
      // Never over a sprint started since.
      revert: () => {
        if (!readPlan()) writePlanRaw(captured);
      },
    });
  }

  // Complete and Reopen swap the wrap-up card for the "completed" note and
  // back; focus moves to the button that undoes what was just pressed.
  function complete() {
    completeSprint(plan, (completedAt) =>
      record(DESIGN_SPRINT_ACTIONS.SPRINT_COMPLETED, { name: plan.name, completedAt })
    );
    returnTo("reopen");
    announce(`Completed “${plan.name}”.`);
  }

  function reopen() {
    reopenSprint();
    returnTo("complete");
    announce(`Reopened “${plan.name}”.`);
  }

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
      })
    )
  );

  // The prompt reads the day on screen, and each day's outputs as its artifacts.
  const promptConfig = useMemo(
    () => ({
      toolName: TITLE,
      prompts: generateDesignSprintPrompts(
        {
          sprint: {
            ...plan,
            currentDay: viewed,
            days: planDays(plan).map((d) => ({
              ...d,
              artifacts: dayOutputs(d).map((o) => o.text),
            })),
          },
        },
        workspace
      ),
    }),
    [plan, viewed, workspace]
  );

  const csvData = {
    headers: ["Sprint Description", "Day", "Phase", "Task", "Done", "Owner"],
    rows: days.flatMap((d) =>
      d.tasks.map((task) => [
        (plan.description ?? "").replace(/\r?\n/g, " "),
        `Day ${d.day}`,
        d.dayName,
        task.text,
        task.done ? "Yes" : "No",
        task.owner ?? "",
      ])
    ),
  };

  const daysLeft = plan.completedAt ? 0 : workingDaysLeft(t, today);
  const todayTile = plan.completedAt
    ? { value: "Done", hint: "Completed" }
    : t.dates.length === 0
      ? { value: "—", hint: "No valid start date" }
      : running
        ? {
            value: `Day ${t.day} of 5`,
            // A weekend or holiday mid-sprint: the day shown is the last one worked.
            hint: `${DESIGN_SPRINT_DAY_NAMES[t.day!]}${dayOnDate(t, today) ? "" : " · a day off today"}`,
          }
        : t.status === "over"
          ? { value: "Over", hint: "All five days are past" }
          : { value: "Upcoming", hint: capitalise(startsInText(t.startsIn)) };

  return (
    <div ref={exportRef}>
      {hasExampleItems([plan]) && <ExampleNotice onClear={clearExample} />}

      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename={`design-sprint-${plan.name.replace(/\W+/g, "-")}`}
          csvData={csvData}
          jsonData={{ sprint: plan }}
          markdown={toMarkdown(plan, t)}
          targetRef={exportRef}
        />
        <ResetButton
          title="Reset the design sprint?"
          description={`“${plan.name}” goes, with its tasks, outputs and findings on all five days. Hypotheses and stories already sent from it stay where they are.`}
          confirmLabel="Reset sprint"
          doneLabel="Reset the design sprint"
          variant="outline"
          className="gap-2 text-sub hover:border-danger/40 hover:text-danger"
          onReset={() => {
            resetCopy.current = readPlan();
            onCleared();
            writePlanRaw(null);
            record(DESIGN_SPRINT_ACTIONS.SPRINT_RESET, { name: plan.name });
          }}
          onUndo={() => {
            // Never over a sprint started since.
            if (resetCopy.current && !readPlan()) writePlanRaw(resetCopy.current);
          }}
        />
      </ActionRow>

      <p
        ref={verdictRef}
        tabIndex={-1}
        className="mb-4 text-sm font-medium text-text focus:outline-none"
      >
        {verdict}
      </p>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={Calendar}
          label="Today"
          value={todayTile.value}
          hint={todayTile.hint}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={CheckCircle2}
          label="Tasks done"
          value={`${pct}%`}
          hint={`${totals.done}/${totals.total}`}
        />
        <StatCard
          variant="compact"
          label="Days left"
          value={daysLeft}
          hint={
            plan.completedAt
              ? "completed"
              : t.dates.includes(today)
                ? "working days, incl. today"
                : "working days"
          }
        />
        <StatCard
          variant="compact"
          icon={Search}
          label="Findings"
          value={sent.total}
          hint={`${sent.sent} sent on`}
        />
      </KpiGrid>

      <SectionCard
        title={plan.name}
        icon={Sparkles}
        className="mb-6"
        actions={
          !editingDetails && (
            <IconButton
              ref={refFor("details")}
              label="Edit sprint details"
              icon={<Pencil className="h-4 w-4" />}
              className="text-sub hover:text-text"
              onClick={() => setEditingDetails(true)}
            />
          )
        }
      >
        {editingDetails ? (
          <DetailsEditor
            plan={plan}
            calendar={calendar}
            offerAddToRoster={!example}
            onSave={saveDetails}
            onCancel={() => {
              setEditingDetails(false);
              returnTo("details");
            }}
          />
        ) : (
          <div className="space-y-2">
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-medium text-text">{statusText(plan, t)}</span>
              <span className="text-sub">
                {dateRange(t.dates) || `Starts ${plan.startDate || "on no valid date"}`}
              </span>
            </p>
            {plan.description && (
              <p className="whitespace-pre-wrap break-words text-sm text-sub">{plan.description}</p>
            )}
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-sub">
              <Users className="h-4 w-4" aria-hidden="true" />
              <span>
                Decider: <span className="text-text">{plan.decider || "not named"}</span>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Facilitator: <span className="text-text">{plan.facilitator || "not named"}</span>
              </span>
            </p>
          </div>
        )}
      </SectionCard>

      <DayTimeline days={days} today={t} todayIso={today} viewed={viewed} onView={view} />

      <DayPanel
        key={viewed}
        plan={plan}
        day={viewed}
        date={shortDay(t.dates[viewed - 1])}
        isToday={dayOnDate(t, today) === viewed}
        example={example}
        record={record}
        announce={announce}
        onOpenDay={openDay}
        headingRef={refFor("day-heading")}
      />

      {plan.completedAt ? (
        <CalloutAlert tone="success">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              <strong>Sprint completed</strong> on{" "}
              {shortDay(todayLocalISO(new Date(plan.completedAt))) || plan.completedAt}.
            </span>
            <Button
              ref={refFor("reopen")}
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={reopen}
            >
              Reopen
            </Button>
          </span>
        </CalloutAlert>
      ) : (
        <SectionCard title="Wrap up" icon={Trophy} titleSize="sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-sub">
              When the team has decided what to do with the findings, complete the sprint.
            </p>
            <Button ref={refFor("complete")} type="button" onClick={complete} className="gap-2">
              <Trophy className="h-4 w-4" aria-hidden="true" />
              Complete sprint
            </Button>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
