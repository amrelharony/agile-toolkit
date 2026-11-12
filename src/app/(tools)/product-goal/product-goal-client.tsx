"use client";

/**
 * Product Goal: the one long-term goal the team's sprints work towards.
 * Write it with why it matters, how you'll know and a target date; keep
 * one active (a new goal closes the current one as achieved or abandoned);
 * and keep the earlier goals as the team's record. Sprint Goal, Sprint
 * Planning and the team charter show the active goal.
 *
 * The goals are workspace records (`productGoals`), so Amr and the other
 * pages read the same ones; the vision is this tool's own setting. The
 * example is held in memory and never reaches the workspace.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { nanoid } from "nanoid";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { CalendarClock, Goal, History, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { SectionCard } from "@/components/shared/section-card";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ProductGoal, Story } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { PRODUCT_GOAL_ACTIONS } from "@/lib/history/event-actions";
import { cheer } from "@/lib/celebrate/cheer";
import { undoable } from "@/lib/utils/undoable";
import { isExampleId } from "@/lib/utils/example-id";
import { todayIso } from "@/lib/sprints/series";
import { backlogForHealth } from "@/lib/backlog/health";
import {
  EMPTY_GOAL_DRAFT,
  GOAL_STATUS_LABEL,
  activationWrites,
  activeGoal,
  closedGoal,
  daysToTarget,
  extraActiveGoals,
  goalChecks,
  goalDraftFor,
  goalHistory,
  newGoal,
  reopenedGoal,
  targetText,
  validateNote,
  withGoalValues,
  type GoalOutcome,
} from "@/lib/product-goal/model";
import { EXAMPLE_VISION, buildExample } from "./example";
import { toMarkdown } from "./markdown";
import { CheckList } from "./check-list";
import { GoalForm, type GoalFormValues } from "./goal-form";
import { VISION_MAX, normalizeVision, useProductGoalPrefs } from "./store";

export const TOOL_ID = "product-goal";

const NO_GOALS: ProductGoal[] = [];
const NO_STORIES: Story[] = [];

/** Where the page's goal writes go: the workspace, or the example in memory. */
export interface GoalWriter {
  all(): ProductGoal[];
  put(goals: readonly ProductGoal[]): void;
  remove(id: string): void;
}

export const liveWriter: GoalWriter = {
  all: () => useWorkspaceStore.getState().productGoals ?? [],
  put: (goals) => {
    const ws = useWorkspaceStore.getState();
    for (const g of goals) ws.upsertProductGoal(g);
  },
  remove: (id) => useWorkspaceStore.getState().removeProductGoal(id),
};

type ExampleStore = StoreApi<{ goals: ProductGoal[]; vision: string }>;

function exampleWriter(store: ExampleStore): GoalWriter {
  const replace = (list: ProductGoal[], g: ProductGoal) =>
    list.some((x) => x.id === g.id) ? list.map((x) => (x.id === g.id ? g : x)) : [...list, g];
  return {
    all: () => store.getState().goals,
    put: (goals) =>
      store.setState((s) => ({ goals: goals.reduce((list, g) => replace(list, g), s.goals) })),
    remove: (id) => store.setState((s) => ({ goals: s.goals.filter((g) => g.id !== id) })),
  };
}

const short = (t: string, max = 50) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

export function ProductGoalClient() {
  const hydrated = useWorkspaceHydrated();
  const stored = useWorkspaceStore((s) => s.productGoals) ?? NO_GOALS;
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const backlogItems = useWorkspaceStore((s) => s.backlogItems);
  const storedVision = useProductGoalPrefs((s) => s.vision);
  const [prefsReady, setPrefsReady] = useState(false);
  useEffect(() => {
    void Promise.resolve(useProductGoalPrefs.persist.rehydrate()).then(() => setPrefsReady(true));
  }, []);
  const { log } = useHistoryLogger(TOOL_ID);
  const [example, setExample] = useState<ExampleStore | null>(null);

  const storyTitles = useMemo(
    () => backlogForHealth(stories, backlogItems).map((s) => s.title),
    [stories, backlogItems]
  );

  const content = !hydrated ? (
    <p className="text-sm text-sub" role="status">
      Loading your goals…
    </p>
  ) : example ? (
    <ExampleBoard store={example} storyTitles={storyTitles} onExit={() => setExample(null)} />
  ) : (
    <GoalBoard
      goals={stored}
      writer={liveWriter}
      vision={prefsReady ? normalizeVision(storedVision) : ""}
      onVision={(v) => useProductGoalPrefs.setState({ vision: v.slice(0, VISION_MAX) })}
      storyTitles={storyTitles}
      log={log}
      onLoadExample={() =>
        setExample(createStore(() => ({ goals: buildExample(), vision: EXAMPLE_VISION })))
      }
    />
  );

  return (
    <ToolPageWrapper
      toolId="product-goal"
      title="Product Goal"
      description="The Product Goal your sprints work towards, and how you'll know."
      category="Strategic Planning"
    >
      {content}
    </ToolPageWrapper>
  );
}

function ExampleBoard({
  store,
  storyTitles,
  onExit,
}: {
  store: ExampleStore;
  storyTitles: readonly string[];
  onExit: () => void;
}) {
  const goals = useStore(store, (s) => s.goals);
  const vision = useStore(store, (s) => s.vision);
  const writer = useMemo(() => exampleWriter(store), [store]);
  return (
    <div>
      <ExampleNotice onClear={onExit} />
      <p className="-mt-2 mb-4 text-xs text-sub">
        The example stays on this page: Sprint Goal, Sprint Planning and the team charter don&apos;t
        see it, and nothing is saved.
      </p>
      <GoalBoard
        goals={goals}
        writer={writer}
        vision={vision}
        onVision={(v) => store.setState({ vision: v.slice(0, VISION_MAX) })}
        storyTitles={storyTitles}
        log={() => {}}
        example
      />
    </div>
  );
}

type Editing =
  | { kind: "new" }
  | { kind: "edit"; id: string }
  | { kind: "close"; outcome: GoalOutcome }
  | null;

/** The page itself, over `goals`, writing through `writer`. */
export function GoalBoard({
  goals,
  writer,
  vision,
  onVision,
  storyTitles,
  log,
  example = false,
  onLoadExample,
}: {
  goals: readonly ProductGoal[];
  writer: GoalWriter;
  vision: string;
  onVision: (vision: string) => void;
  storyTitles: readonly string[];
  log: (action: string, payload?: Record<string, unknown>) => void;
  example?: boolean;
  onLoadExample?: () => void;
}) {
  const withExamples = example;
  const active = activeGoal(goals, { withExamples });
  const history = goalHistory(goals, { withExamples });
  const extras = extraActiveGoals(goals).filter((g) => withExamples || !isExampleId(g.id));
  const [editing, setEditing] = useState<Editing>(null);
  const [today] = useState(() => todayIso());
  const [status, setStatus] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  const done = (message: string) => {
    setEditing(null);
    setStatus(message);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const markdown = useMemo(
    () => toMarkdown({ active, history, vision, today }),
    [active, history, vision, today]
  );

  /** A new goal, made active; the current one (and any extra) closed first, all with one Undo. */
  const saveNew = (values: GoalFormValues) => {
    const now = new Date().toISOString();
    const id = `${example ? "example-" : ""}goal_${nanoid(8)}`;
    const next = newGoal(id, values, now);
    const before = writer.all();
    const writes = activationWrites(before, next, values.closeAs, now, values.note);
    const closing = writes.filter((g) => g.id !== id);
    const previous = closing
      .map((g) => before.find((b) => b.id === g.id))
      .filter(Boolean) as ProductGoal[];
    const apply = () => writer.put(writes);
    if (previous.length === 0) {
      apply();
    } else {
      undoable({
        label: `New Product Goal set; “${short(previous[0].statement)}” marked ${values.closeAs}`,
        apply,
        revert: () => {
          writer.remove(id);
          writer.put(previous);
        },
      });
    }
    log(PRODUCT_GOAL_ACTIONS.GOAL_CREATED, { goalId: id, measures: values.measures.length });
    for (const g of closing) {
      log(
        g.status === "achieved"
          ? PRODUCT_GOAL_ACTIONS.GOAL_ACHIEVED
          : PRODUCT_GOAL_ACTIONS.GOAL_ABANDONED,
        { goalId: g.id }
      );
    }
    if (!example && closing.some((g) => g.status === "achieved")) cheer(TOOL_ID, "milestone");
    done("The new goal is active.");
  };

  const saveEdit = (goal: ProductGoal, values: GoalFormValues) => {
    writer.put([withGoalValues(goal, values, new Date().toISOString())]);
    log(PRODUCT_GOAL_ACTIONS.GOAL_UPDATED, { goalId: goal.id });
    done("Goal saved.");
  };

  const close = (goal: ProductGoal, outcome: GoalOutcome, note?: string) => {
    const before = writer.all().find((g) => g.id === goal.id) ?? goal;
    undoable({
      label: `Marked “${short(goal.statement)}” ${outcome}`,
      apply: () => writer.put([closedGoal(before, outcome, new Date().toISOString(), note)]),
      revert: () => writer.put([before]),
    });
    log(
      outcome === "achieved"
        ? PRODUCT_GOAL_ACTIONS.GOAL_ACHIEVED
        : PRODUCT_GOAL_ACTIONS.GOAL_ABANDONED,
      { goalId: goal.id }
    );
    if (outcome === "achieved" && !example) cheer(TOOL_ID, "milestone");
    done(`Goal marked ${outcome}. Set the next one when the team is ready.`);
  };

  const reopen = (goal: ProductGoal) => {
    if (active) return;
    const before = goal;
    undoable({
      label: `“${short(goal.statement)}” is active again`,
      apply: () => writer.put([reopenedGoal(before, new Date().toISOString())]),
      revert: () => writer.put([before]),
    });
    log(PRODUCT_GOAL_ACTIONS.GOAL_UPDATED, { goalId: goal.id, reopened: true });
    done("The goal is active again.");
  };

  const remove = (goal: ProductGoal) => {
    const before = goal;
    undoable({
      label: `Deleted “${short(goal.statement)}” from the record`,
      apply: () => writer.remove(goal.id),
      revert: () => writer.put([before]),
    });
    log(PRODUCT_GOAL_ACTIONS.GOAL_REMOVED, { goalId: goal.id });
    setStatus("");
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  /** A sync left two goals active: keep the one shown, close the rest as abandoned. */
  const keepShown = () => {
    const before = extras.map((g) => writer.all().find((x) => x.id === g.id) ?? g);
    const now = new Date().toISOString();
    undoable({
      label: `Closed ${before.length === 1 ? "the other active goal" : `${before.length} other active goals`}`,
      apply: () => writer.put(before.map((g) => closedGoal(g, "abandoned", now, g.note))),
      revert: () => writer.put(before),
    });
  };

  const empty = goals.length === 0;
  const editingGoal = editing?.kind === "edit" ? goals.find((g) => g.id === editing.id) : undefined;

  return (
    <div className="space-y-6">
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-lg font-semibold text-text focus:outline-none"
        >
          {active ? "The active goal" : "No goal is active"}
        </h2>
        <ExportButton
          filename="product-goal"
          markdown={markdown}
          clipboardText={markdown}
          jsonData={{ active: active ?? null, history, vision }}
        />
      </div>

      <VisionField vision={vision} onCommit={onVision} />

      {extras.length > 0 && (
        <CalloutAlert tone="warning">
          <p>
            Another goal is still marked active (
            {extras.map((g) => `“${short(g.statement, 40)}”`).join(", ")}), probably from another
            device. One goal is active at a time.
          </p>
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={keepShown}>
            Keep the one shown, close the other
          </Button>
        </CalloutAlert>
      )}

      {empty && editing?.kind !== "new" ? (
        <EmptyState
          icon={Goal}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" onClick={() => setEditing({ kind: "new" })}>
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                Write the goal
              </Button>
              {onLoadExample && <LoadExampleButton onLoad={onLoadExample} />}
            </div>
          }
        >
          <p className="text-sm">
            No Product Goal yet. Write the one goal your sprints work towards, or look at an example
            first.
          </p>
        </EmptyState>
      ) : editing?.kind === "new" ? (
        <SectionCard title={active ? "A new Product Goal" : "The Product Goal"} icon={Goal}>
          <GoalForm
            initial={EMPTY_GOAL_DRAFT}
            replacing={active?.statement}
            vision={vision}
            storyTitles={storyTitles}
            submitLabel={active ? "Save and make it active" : "Save the goal"}
            onSave={saveNew}
            onCancel={() => done("")}
          />
        </SectionCard>
      ) : editingGoal ? (
        <SectionCard title="Edit the goal" icon={Pencil}>
          <GoalForm
            initial={goalDraftFor(editingGoal)}
            vision={vision}
            storyTitles={storyTitles}
            submitLabel="Save the goal"
            onSave={(v) => saveEdit(editingGoal, v)}
            onCancel={() => done("")}
          />
        </SectionCard>
      ) : active ? (
        <ActiveGoal
          goal={active}
          vision={vision}
          today={today}
          closing={editing?.kind === "close" ? editing.outcome : null}
          onEdit={() => setEditing({ kind: "edit", id: active.id })}
          onClose={(outcome) => setEditing({ kind: "close", outcome })}
          onConfirmClose={(outcome, note) => close(active, outcome, note)}
          onCancelClose={() => setEditing(null)}
          onNew={() => setEditing({ kind: "new" })}
        />
      ) : (
        <SectionCard title="Set the next goal" icon={Goal}>
          <p className="text-sm text-sub">
            The last goal is closed. Write the next one when the team and stakeholders agree on it.
          </p>
          <Button type="button" className="mt-3" onClick={() => setEditing({ kind: "new" })}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            Write the next goal
          </Button>
        </SectionCard>
      )}

      {history.length > 0 && (
        <SectionCard title="Earlier goals" icon={History}>
          <ul className="divide-y divide-border" aria-label="Earlier goals">
            {history.map((g) => (
              <li key={g.id} className="flex flex-wrap items-start gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm text-text">{g.statement}</p>
                  <p className="text-xs text-sub">
                    {GOAL_STATUS_LABEL[g.status]} {(g.closedAt ?? g.updatedAt).slice(0, 10)}
                    {g.note?.trim() ? ` · ${g.note.trim()}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {!active && (
                    <IconButton
                      label={`Make “${short(g.statement, 40)}” active again`}
                      icon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => reopen(g)}
                    />
                  )}
                  <IconButton
                    label={`Delete “${short(g.statement, 40)}”`}
                    icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                    onClick={() => remove(g)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {!example && active && (
        <p className="text-xs text-sub">
          Sprint Goal, Sprint Planning and the{" "}
          <Link href="/team" className="text-accent hover:underline">
            team charter
          </Link>{" "}
          show this goal. At{" "}
          <Link href="/sprint-planning" className="text-accent hover:underline">
            Sprint Planning
          </Link>
          , say which part of it the sprint moves.
        </p>
      )}
    </div>
  );
}

/** The vision, saved when the field loses focus. */
function VisionField({ vision, onCommit }: { vision: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(vision);
  useEffect(() => setDraft(vision), [vision]);
  return (
    <Field
      label="Product vision"
      hint="Optional. Where the product is going in the long run: the check list and Ask Amr compare the goal with it."
    >
      {(control) => (
        <Textarea
          {...control}
          rows={2}
          maxLength={VISION_MAX}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== vision) onCommit(draft.trim());
          }}
        />
      )}
    </Field>
  );
}

function ActiveGoal({
  goal,
  vision,
  today,
  closing,
  onEdit,
  onClose,
  onConfirmClose,
  onCancelClose,
  onNew,
}: {
  goal: ProductGoal;
  vision: string;
  today: string;
  closing: GoalOutcome | null;
  onEdit: () => void;
  onClose: (outcome: GoalOutcome) => void;
  onConfirmClose: (outcome: GoalOutcome, note?: string) => void;
  onCancelClose: () => void;
  onNew: () => void;
}) {
  const target = targetText(goal.targetDate);
  const days = daysToTarget(goal.targetDate, today);
  const checks = goalChecks(goal, vision);
  return (
    <SectionCard title="Product Goal" icon={Goal}>
      <div className="space-y-4">
        <p className="break-words font-display text-lg text-text" data-field="statement">
          {goal.statement}
        </p>
        {goal.why?.trim() && (
          <p className="break-words text-sm text-text">
            <span className="font-medium">Why it matters: </span>
            {goal.why}
          </p>
        )}
        {target && (
          <p className="flex items-center gap-1.5 text-sm text-sub">
            <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
            Target {target.replace(/^by /, "")}
            {days !== null &&
              (days >= 0
                ? ` · ${days} ${days === 1 ? "day" : "days"} left`
                : ` · ${-days} ${days === -1 ? "day" : "days"} past it`)}
          </p>
        )}
        <div>
          <h3 className="text-xs font-medium text-sub">How you&apos;ll know</h3>
          {goal.measures.length === 0 ? (
            <p className="text-sm text-sub">
              No measures yet. Add one so each review can show progress.
            </p>
          ) : (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-text">
              {goal.measures.map((m, i) => (
                <li key={i} className="break-words">
                  {m}
                </li>
              ))}
            </ul>
          )}
        </div>
        <CheckList checks={checks} title="Check list" />
        {closing ? (
          <CloseForm
            outcome={closing}
            onSave={(note) => onConfirmClose(closing, note)}
            onCancel={onCancelClose}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="mr-1 h-4 w-4" aria-hidden="true" />
              Edit
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onClose("achieved")}>
              Mark achieved
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onClose("abandoned")}>
              Mark abandoned
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onNew}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              Set a new goal
            </Button>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

/** "Mark achieved" or "Mark abandoned", with an optional note. */
function CloseForm({
  outcome,
  onSave,
  onCancel,
}: {
  outcome: GoalOutcome;
  onSave: (note?: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();
  const first = useRef<HTMLTextAreaElement>(null);
  useEffect(() => first.current?.focus(), []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const checked = validateNote(note);
    if (!checked.ok) {
      setError(checked.errors.note);
      first.current?.focus();
      return;
    }
    onSave(checked.values);
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-2 rounded-lg border border-border p-3">
      <Field
        label={outcome === "achieved" ? "What showed it was reached?" : "Why is it abandoned?"}
        hint="Optional. It stays with the goal in the record."
        error={error}
      >
        {(control) => (
          <Textarea
            {...control}
            ref={first}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm">
          {outcome === "achieved" ? "Mark achieved" : "Mark abandoned"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
