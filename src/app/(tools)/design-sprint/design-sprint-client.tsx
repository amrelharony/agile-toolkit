"use client";

import { useEffect, useMemo, useState } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  Lightbulb,
  CheckCircle2,
  Calendar,
  Users,
  Sparkles,
  Trophy,
} from "lucide-react";
import { generateDesignSprintPrompts } from "@/lib/ai-prompts/design-sprint";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { DESIGN_SPRINT_ACTIONS } from "@/lib/history/event-actions";
import { todayLocalISO } from "@/lib/utils/formatters";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";

type DayNumber = 1 | 2 | 3 | 4 | 5;

interface Task {
  id: string;
  text: string;
  done: boolean;
  owner?: string;
}

interface DaySection {
  day: DayNumber;
  dayName: "Map" | "Sketch" | "Decide" | "Prototype" | "Test";
  tasks: Task[];
  artifacts: string[];
}

interface Sprint {
  id: string;
  name: string;
  startDate: string;
  currentDay: DayNumber;
  days: DaySection[];
  description?: string;
  decider?: string;
  facilitator?: string;
  completedAt?: string;
}

interface State {
  sprint: Sprint | null;
}

const DEFAULT_STATE: State = { sprint: null };

const DEFAULT_TASKS: Record<DayNumber, string[]> = {
  1: [
    "Set the long-term goal",
    "List sprint questions",
    "Map the problem (user journey)",
    "Lightning talks from experts",
    "Capture How Might We notes",
    "Pick a target on the map",
  ],
  2: [
    "Lightning Demos for inspiration",
    "Individual sketching warm-up (notes, ideas, crazy 8s)",
    "Solution sketches (3-panel)",
    "Recruit users for Friday's test",
  ],
  3: [
    "Art museum: post all sketches on the wall",
    "Heat map: silent dot voting",
    "Speed critique of top sketches",
    "Straw poll then Decider's supervote",
    "Storyboard the chosen solution",
  ],
  4: [
    "Pick the right tools for prototype fidelity",
    "Divide and conquer (Maker, Stitcher, Writer, Asset Collector, Interviewer)",
    "Build the prototype",
    "Trial run with one teammate before close of day",
  ],
  5: [
    "Run 5 user interviews (1 hour each)",
    "Take notes in the Test Room",
    "Look for patterns across all 5 interviews",
    "Decide what to do next based on findings",
  ],
};

const DAY_NAMES: Record<DayNumber, DaySection["dayName"]> = {
  1: "Map",
  2: "Sketch",
  3: "Decide",
  4: "Prototype",
  5: "Test",
};

function newId(): string {
  return crypto.randomUUID();
}

function buildDays(): DaySection[] {
  return ([1, 2, 3, 4, 5] as DayNumber[]).map((d) => ({
    day: d,
    dayName: DAY_NAMES[d],
    tasks: DEFAULT_TASKS[d].map((t) => ({ id: newId(), text: t, done: false })),
    artifacts: [],
  }));
}

/** Local-time YYYY-MM-DD; replaces the prior `new Date().toISOString().slice(0,10)`
 * which silently rolled to the *next* day after ~16:00 in west-of-UTC zones. */
function todayISO(): string {
  return todayLocalISO();
}

export function DesignSprintClient() {
  const [state, setState] = usePersisted<State>("agile-toolkit:design-sprint", DEFAULT_STATE);
  const [newSprintName, setNewSprintName] = useState("");
  const [newSprintDate, setNewSprintDate] = useState(todayISO());
  const [newSprintDesc, setNewSprintDesc] = useState("");
  const [newTaskText, setNewTaskText] = useState<Record<DayNumber, string>>({
    1: "",
    2: "",
    3: "",
    4: "",
    5: "",
  });
  const [newArtifact, setNewArtifact] = useState<Record<DayNumber, string>>({
    1: "",
    2: "",
    3: "",
    4: "",
    5: "",
  });
  const [deciderDraft, setDeciderDraft] = useState("");
  const [facilitatorDraft, setFacilitatorDraft] = useState("");
  const { log } = useHistoryLogger("design-sprint");

  // Mirror persisted role names into local drafts (commit-on-blur).
  useEffect(() => {
    setDeciderDraft(state.sprint?.decider ?? "");
  }, [state.sprint?.decider]);
  useEffect(() => {
    setFacilitatorDraft(state.sprint?.facilitator ?? "");
  }, [state.sprint?.facilitator]);

  const startSprint = () => {
    const name = newSprintName.trim().slice(0, 200);
    if (!name) return;
    const description = newSprintDesc.trim().slice(0, 4000) || undefined;
    // Validate the start date — type="date" accepts an empty string when the
    // user clears the field, and a hand-crafted shared link could push an
    // out-of-format string straight into the persisted store.
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(newSprintDate) ? newSprintDate : todayISO();
    const sprint: Sprint = {
      id: newId(),
      name,
      startDate,
      currentDay: 1,
      days: buildDays(),
      description,
    };
    setState({ sprint });
    log(DESIGN_SPRINT_ACTIONS.SPRINT_STARTED, {
      sprintId: sprint.id,
      name: sprint.name,
      startDate: sprint.startDate,
      description,
    });
    setNewSprintName("");
    setNewSprintDesc("");
  };

  const completeSprint = () => {
    if (!state.sprint) return;
    const completedAt = new Date().toISOString();
    setState((s) => (s.sprint ? { sprint: { ...s.sprint, completedAt } } : s));
    log(DESIGN_SPRINT_ACTIONS.SPRINT_COMPLETED, {
      sprintId: state.sprint.id,
      name: state.sprint.name,
      completedAt,
    });
  };

  const resetSprint = () => {
    if (!state.sprint) return;
    log(DESIGN_SPRINT_ACTIONS.SPRINT_RESET, {
      sprintId: state.sprint.id,
      name: state.sprint.name,
    });
    setState({ sprint: null });
  };

  const setCurrentDay = (d: DayNumber) => {
    setState((s) => (s.sprint ? { sprint: { ...s.sprint, currentDay: d } } : s));
  };

  const toggleTask = (dayNum: DayNumber, taskId: string) => {
    if (!state.sprint) return;
    const day = state.sprint.days.find((x) => x.day === dayNum);
    const task = day?.tasks.find((t) => t.id === taskId);
    if (!day || !task) return;
    // R11-fix: compute nextDone INSIDE the updater so rapid clicks each
    // toggle relative to the current state, not the closure-captured
    // snapshot at the start of the click. Previously: 3 fast clicks on
    // a done task all read `task.done=true`, each computed `!true=false`,
    // and all wrote `false` — net effect 1 toggle, not 3. Now: each
    // click flips against the value at write-time. Also captures the
    // final `nextDone` for the log call so the history event matches
    // the actual stored value.
    let finalDone = !task.done;
    setState((s) => {
      if (!s.sprint) return s;
      return {
        sprint: {
          ...s.sprint,
          days: s.sprint.days.map((d) =>
            d.day !== dayNum
              ? d
              : {
                  ...d,
                  tasks: d.tasks.map((t) => {
                    if (t.id !== taskId) return t;
                    finalDone = !t.done;
                    return { ...t, done: finalDone };
                  }),
                }
          ),
        },
      };
    });
    log(DESIGN_SPRINT_ACTIONS.TASK_TOGGLED, {
      sprintId: state.sprint.id,
      day: dayNum,
      taskId,
      text: task.text,
      done: finalDone,
    });
  };

  const setTaskOwner = (dayNum: DayNumber, taskId: string, ownerRaw: string) => {
    const owner = ownerRaw.trim() || undefined;
    if (!state.sprint) return;
    const day = state.sprint.days.find((x) => x.day === dayNum);
    const task = day?.tasks.find((t) => t.id === taskId);
    if (task && task.owner === owner) return;
    setState((s) =>
      s.sprint
        ? {
            sprint: {
              ...s.sprint,
              days: s.sprint.days.map((d) =>
                d.day !== dayNum
                  ? d
                  : {
                      ...d,
                      tasks: d.tasks.map((t) => (t.id !== taskId ? t : { ...t, owner })),
                    }
              ),
            },
          }
        : s
    );
    log(DESIGN_SPRINT_ACTIONS.TASK_OWNER_ASSIGNED, {
      sprintId: state.sprint.id,
      day: dayNum,
      taskId,
      text: task?.text,
      owner: owner ?? null,
    });
  };

  const addTask = (dayNum: DayNumber) => {
    // Cap user-entered task text to keep persisted state bounded; a single
    // paste-bomb otherwise breaks the line-clamp UI and bloats the export.
    const text = newTaskText[dayNum].trim().slice(0, 500);
    if (!text || !state.sprint) return;
    const id = newId();
    setState((s) =>
      s.sprint
        ? {
            sprint: {
              ...s.sprint,
              days: s.sprint.days.map((d) =>
                d.day !== dayNum ? d : { ...d, tasks: [...d.tasks, { id, text, done: false }] }
              ),
            },
          }
        : s
    );
    setNewTaskText((p) => ({ ...p, [dayNum]: "" }));
  };

  const removeTask = (dayNum: DayNumber, taskId: string) => {
    setState((s) =>
      s.sprint
        ? {
            sprint: {
              ...s.sprint,
              days: s.sprint.days.map((d) =>
                d.day !== dayNum ? d : { ...d, tasks: d.tasks.filter((t) => t.id !== taskId) }
              ),
            },
          }
        : s
    );
  };

  const addArtifact = (dayNum: DayNumber) => {
    // Cap artifact URLs / notes — design-sprint artifacts are usually short
    // links, and the export collapses newlines so very long entries make the
    // CSV unreadable.
    const a = newArtifact[dayNum].trim().slice(0, 1000);
    if (!a || !state.sprint) return;
    setState((s) =>
      s.sprint
        ? {
            sprint: {
              ...s.sprint,
              days: s.sprint.days.map((d) =>
                d.day !== dayNum ? d : { ...d, artifacts: [...d.artifacts, a] }
              ),
            },
          }
        : s
    );
    log(DESIGN_SPRINT_ACTIONS.ARTIFACT_LOGGED, {
      sprintId: state.sprint.id,
      day: dayNum,
      artifact: a,
    });
    setNewArtifact((p) => ({ ...p, [dayNum]: "" }));
  };

  const removeArtifact = (dayNum: DayNumber, idx: number) => {
    setState((s) =>
      s.sprint
        ? {
            sprint: {
              ...s.sprint,
              days: s.sprint.days.map((d) =>
                d.day !== dayNum
                  ? d
                  : {
                      ...d,
                      artifacts: d.artifacts.filter((_, i) => i !== idx),
                    }
              ),
            },
          }
        : s
    );
  };

  const commitDecider = () => {
    const decider = deciderDraft.trim() || undefined;
    if (!state.sprint || decider === state.sprint.decider) return;
    setState((s) => (s.sprint ? { sprint: { ...s.sprint, decider } } : s));
  };
  const commitFacilitator = () => {
    const facilitator = facilitatorDraft.trim() || undefined;
    if (!state.sprint || facilitator === state.sprint.facilitator) return;
    setState((s) => (s.sprint ? { sprint: { ...s.sprint, facilitator } } : s));
  };

  const stats = useMemo(() => {
    if (!state.sprint) {
      return { total: 0, done: 0, pct: 0, daysLeft: 0 };
    }
    const total = state.sprint.days.reduce((acc, d) => acc + d.tasks.length, 0);
    const done = state.sprint.days.reduce(
      (acc, d) => acc + d.tasks.filter((t) => t.done).length,
      0
    );
    const pct = total === 0 ? 0 : (done / total) * 100;
    const daysLeft = 5 - state.sprint.currentDay + 1;
    return { total, done, pct, daysLeft };
  }, [state.sprint]);

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

  const promptConfig = useMemo(
    () => ({
      toolName: "Design Sprint Tracker",
      prompts: generateDesignSprintPrompts({ sprint: state.sprint }, workspace),
    }),
    [state.sprint, workspace]
  );

  if (!state.sprint) {
    return (
      <ToolPageWrapper
        toolId="design-sprint"
        title="Design Sprint Tracker"
        description="A 5-day Google Ventures-style design sprint, scaffolded with default tasks for Map / Sketch / Decide / Prototype / Test."
        category="Workshops & Facilitation"
      >
        <Card className="bg-surface border-border max-w-xl">
          <CardContent className="p-5 space-y-3">
            <div className="text-sm font-semibold text-text flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-accent" />
              Start a new sprint
            </div>
            <div className="space-y-2">
              <Input
                value={newSprintName}
                onChange={(e) => setNewSprintName(e.target.value)}
                placeholder="Sprint name (e.g. Onboarding redesign)"
                className="bg-bg border-border"
                aria-label="Sprint name"
              />
              <Input
                type="date"
                value={newSprintDate}
                onChange={(e) => setNewSprintDate(e.target.value)}
                className="bg-bg border-border font-data"
                aria-label="Start date"
              />
              <Textarea
                value={newSprintDesc}
                onChange={(e) => setNewSprintDesc(e.target.value)}
                placeholder="Description (optional)..."
                rows={2}
                className="bg-bg border-border resize-none text-xs"
                aria-label="Sprint description"
              />
            </div>
            <Button
              onClick={startSprint}
              disabled={!newSprintName.trim()}
              className="gap-2 bg-accent text-bg hover:bg-accent/90 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Start sprint
            </Button>
          </CardContent>
        </Card>
      </ToolPageWrapper>
    );
  }

  return (
    <ToolPageWrapper
      toolId="design-sprint"
      title="Design Sprint Tracker"
      description="A 5-day Google Ventures-style design sprint, scaffolded with default tasks for each day."
      category="Workshops & Facilitation"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename={`design-sprint-${state.sprint.name.replace(/\W+/g, "-")}`}
          csvData={{
            headers: ["Sprint Description", "Day", "Phase", "Task", "Done", "Owner"],
            rows: state.sprint.days.flatMap((d) =>
              d.tasks.map((t) => [
                (state.sprint?.description ?? "").replace(/\r?\n/g, " "),
                `Day ${d.day}`,
                d.dayName,
                t.text,
                t.done ? "Yes" : "No",
                t.owner ?? "",
              ])
            ),
          }}
          jsonData={state}
        />
        <Button
          onClick={resetSprint}
          variant="outline"
          size="sm"
          className="gap-2 border-border text-sub hover:text-danger hover:border-danger/40"
        >
          <Trash2 className="w-4 h-4" />
          Reset
        </Button>
      </ActionRow>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={Calendar}
          label="Current day"
          value={`${state.sprint.currentDay} / 5`}
          hint={DAY_NAMES[state.sprint.currentDay]}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={CheckCircle2}
          label="Tasks done"
          value={`${stats.pct.toFixed(0)}%`}
          hint={`${stats.done}/${stats.total}`}
        />
        <StatCard
          variant="compact"
          label="Days remaining"
          value={state.sprint.completedAt ? "0" : stats.daysLeft}
          hint={state.sprint.completedAt ? "completed" : "incl. today"}
        />
        <StatCard
          variant="compact"
          icon={Trophy}
          label="Status"
          value={state.sprint.completedAt ? "Done" : "Active"}
          tone={state.sprint.completedAt ? "success" : "default"}
        />
      </KpiGrid>

      {/* Sprint header — name, dates, roles */}
      <Card className="bg-surface border-border mb-6">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <div className="text-base font-semibold text-text">{state.sprint.name}</div>
            <Badge variant="outline" className="text-[10px] bg-bg border-border text-sub">
              Started {state.sprint.startDate}
            </Badge>
          </div>
          {state.sprint.description && (
            <div className="text-xs text-sub whitespace-pre-wrap">{state.sprint.description}</div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Input
              value={deciderDraft}
              onChange={(e) => setDeciderDraft(e.target.value)}
              onBlur={commitDecider}
              placeholder="Decider (single accountable role-holder)..."
              className="bg-bg border-border text-sm"
              aria-label="Decider name"
            />
            <Input
              value={facilitatorDraft}
              onChange={(e) => setFacilitatorDraft(e.target.value)}
              onBlur={commitFacilitator}
              placeholder="Facilitator..."
              className="bg-bg border-border text-sm"
              aria-label="Facilitator name"
            />
          </div>
        </CardContent>
      </Card>

      {/* Day timeline */}
      <div className="scroll-x-snap items-center mb-6 pb-2">
        {state.sprint.days.map((d) => {
          const isCurrent = state.sprint!.currentDay === d.day;
          const taskPct =
            d.tasks.length === 0
              ? 0
              : Math.round((d.tasks.filter((t) => t.done).length / d.tasks.length) * 100);
          return (
            <button
              key={d.day}
              type="button"
              onClick={() => setCurrentDay(d.day)}
              className={`min-w-[120px] md:flex-1 rounded-lg border p-2 transition text-left ${
                isCurrent
                  ? "border-accent/60 bg-accent/10"
                  : "border-border bg-surface hover:border-accent/30"
              }`}
            >
              <div className="text-[10px] uppercase tracking-wider text-sub">Day {d.day}</div>
              <div className="text-sm font-semibold text-text">{d.dayName}</div>
              <div className="text-xs text-sub font-data">{taskPct}% done</div>
            </button>
          );
        })}
      </div>

      {state.sprint.completedAt && (
        <CalloutAlert tone="success" className="mb-4">
          <strong>Sprint completed</strong> on {new Date(state.sprint.completedAt).toLocaleString()}
          .
        </CalloutAlert>
      )}

      {/* Per-day section */}
      {state.sprint.days
        .filter((d) => d.day === state.sprint!.currentDay)
        .map((day) => (
          <Card key={day.day} className="bg-surface border-border mb-4">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-accent" />
                <div className="text-sm font-semibold text-text">
                  Day {day.day} — {day.dayName}
                </div>
              </div>

              {/* Task list */}
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wider text-sub font-semibold">Tasks</div>
                {day.tasks.length === 0 ? (
                  <div className="text-xs text-sub italic">No tasks yet.</div>
                ) : (
                  day.tasks.map((t) => (
                    <div
                      key={t.id}
                      className="flex flex-col xs:flex-row xs:items-center gap-2 rounded border border-border bg-bg p-2"
                    >
                      <button
                        type="button"
                        onClick={() => toggleTask(day.day, t.id)}
                        className={`shrink-0 w-5 h-5 rounded border flex items-center justify-center transition ${
                          t.done
                            ? "bg-accent border-accent"
                            : "border-border hover:border-accent/40"
                        }`}
                        aria-label={t.done ? "Mark not done" : "Mark done"}
                      >
                        {t.done && <CheckCircle2 className="w-3 h-3 text-bg" />}
                      </button>
                      <div
                        className={`flex-1 text-sm ${
                          t.done ? "line-through text-sub" : "text-text"
                        }`}
                      >
                        {t.text}
                      </div>
                      <Select
                        value={t.owner ?? "__OWNER_NONE__"}
                        onValueChange={(v) =>
                          setTaskOwner(day.day, t.id, v === "__OWNER_NONE__" ? "" : v)
                        }
                      >
                        <SelectTrigger
                          className="h-8 text-xs bg-surface border-border w-32"
                          aria-label="Task owner"
                        >
                          <SelectValue placeholder="Owner" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__OWNER_NONE__">No owner</SelectItem>
                          {/* BUG-T2-daci-2: dedupe so decider == facilitator
                              doesn't render two SelectItems with the same key
                              (Radix silently drops the dup; React also warns). */}
                          {Array.from(
                            new Set(
                              [state.sprint!.decider, state.sprint!.facilitator].filter(
                                (n): n is string => Boolean(n)
                              )
                            )
                          ).map((n) => (
                            <SelectItem key={n} value={n}>
                              {n}
                            </SelectItem>
                          ))}
                          {/* BUG-T2-design-sprint-2: surface orphaned
                              owners — task owner stored as a name that
                              no longer matches decider/facilitator
                              after rename. Render the orphan name as
                              a selectable item with a "(orphaned)"
                              tag so the user can see + reassign. */}
                          {t.owner &&
                            t.owner !== state.sprint!.decider &&
                            t.owner !== state.sprint!.facilitator && (
                              <SelectItem key={`__orphan__${t.owner}`} value={t.owner}>
                                {t.owner} (no longer on team)
                              </SelectItem>
                            )}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeTask(day.day, t.id)}
                        className="text-sub hover:text-danger"
                        aria-label="Remove task"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))
                )}
                <div className="flex gap-2 pt-1">
                  <Input
                    value={newTaskText[day.day]}
                    onChange={(e) => setNewTaskText((p) => ({ ...p, [day.day]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && addTask(day.day)}
                    placeholder="Add task..."
                    className="bg-bg border-border text-sm"
                    aria-label="New task"
                  />
                  <Button
                    onClick={() => addTask(day.day)}
                    className="gap-2 bg-accent text-bg hover:bg-accent/90"
                  >
                    <Plus className="w-4 h-4" />
                    Add
                  </Button>
                </div>
              </div>

              {/* Artifacts */}
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wider text-sub font-semibold">
                  Artifacts
                </div>
                {day.artifacts.length === 0 ? (
                  <div className="text-xs text-sub italic">No artifacts logged yet.</div>
                ) : (
                  <ul className="space-y-1">
                    {day.artifacts.map((a, i) => (
                      <li key={`${day.day}-art-${i}`} className="flex items-center gap-2 text-xs">
                        <span className="flex-1 text-text break-all">{a}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeArtifact(day.day, i)}
                          className="text-sub hover:text-danger h-6 w-6 p-0"
                          aria-label="Remove artifact"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-2">
                  <Input
                    value={newArtifact[day.day]}
                    onChange={(e) =>
                      setNewArtifact((p) => ({
                        ...p,
                        [day.day]: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => e.key === "Enter" && addArtifact(day.day)}
                    placeholder="URL or note..."
                    className="bg-bg border-border text-sm"
                    aria-label="New artifact"
                  />
                  <Button
                    onClick={() => addArtifact(day.day)}
                    variant="outline"
                    className="gap-2 border-border"
                  >
                    <Plus className="w-4 h-4" />
                    Log
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

      {/* Roles + complete */}
      {!state.sprint.completedAt && (
        <Card className="bg-surface border-border">
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-sub">
              <Users className="w-4 h-4" />
              Decider: <span className="text-text">{state.sprint.decider ?? "—"}</span>
              <span className="opacity-50">·</span>
              Facilitator: <span className="text-text">{state.sprint.facilitator ?? "—"}</span>
            </div>
            <Button onClick={completeSprint} className="gap-2 bg-accent text-bg hover:bg-accent/90">
              <Trophy className="w-4 h-4" />
              Complete sprint
            </Button>
          </CardContent>
        </Card>
      )}
    </ToolPageWrapper>
  );
}
