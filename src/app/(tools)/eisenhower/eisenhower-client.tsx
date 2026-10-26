"use client";

/**
 * The Eisenhower Matrix: two answers per task (is it urgent, is it
 * important) and an optional due date sort it into Do, Schedule, Delegate
 * or Delete.
 *
 * - The quadrant is derived live by the method registry, never stored or
 *   picked: urgent means the answer is Yes OR the task is due within two
 *   days (overdue included), and the row says so ("Urgent because it's
 *   due tomorrow"). The agent actions derive it the same way.
 * - Nothing lands in a pane by default: both answers are needed to save,
 *   and a task missing one (a legacy row, an agent's raw write) waits under
 *   "Not sorted yet" with an Edit, never in Do. A quadrant picked on the
 *   old page still decides its task's pane until the task is saved again.
 * - A Delegate task names who takes it from the roster (PersonPicker).
 * - Edit in place; an edit that changes an answer or the date moves the
 *   task, while the order inside each pane holds still until "Re-sort".
 *   Delete and Clear matrix come with Undo.
 */

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ListChecks, Plus, Square } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { ResetButton } from "@/components/shared/reset-button";
import { ResortChip } from "@/components/shared/resort-chip";
import { SectionCard } from "@/components/shared/section-card";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  MethodRowEditor,
  draftFrom,
  exportRows,
  useMethodActions,
  validateMethodDraft,
  withClears,
  type MethodDraft,
} from "@/components/prioritization/method-tool";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { useStableOrder } from "@/hooks/use-stable-order";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem, Workspace } from "@/lib/stores/workspace-types";
import { generateEisenhowerPrompts } from "@/lib/ai-prompts/eisenhower";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { EISENHOWER_ACTIONS } from "@/lib/history/event-actions";
import { hasExampleItems } from "@/lib/utils/example-id";
import { cn } from "@/lib/utils";
import { todayLocalISO } from "@/lib/utils/formatters";
import { method } from "@/lib/prioritization/methods";
import {
  EISENHOWER_LABEL,
  eisenhowerQuadrant,
  type EisenhowerQuadrant,
} from "@/lib/prioritization/methods/eisenhower";
import { EIS_CONFIG } from "./config";
import { EisenhowerInputs } from "./inputs";
import { toMarkdown } from "./markdown";
import {
  FRAMEWORK,
  UNSORTED,
  compareTasks,
  eisGroups,
  eisRows,
  shortName,
  toCsv,
  type EisGroup,
} from "./model";
import { TaskRow } from "./rows";
import { eisVerdict } from "./verdict";

const EISENHOWER = method(FRAMEWORK);
const NO_ROWS: PrioritizationItem[] = [];

/** Each pane's tint and heading colour, as theme tokens (never a hex). */
const PANE: Record<EisenhowerQuadrant, { pane: string; heading: string }> = {
  do: { pane: "bg-danger/5", heading: "text-danger" },
  schedule: { pane: "bg-accent/10", heading: "text-accent" },
  delegate: { pane: "bg-warning/5", heading: "text-warning" },
  delete: { pane: "bg-bg", heading: "text-sub" },
};

export function EisenhowerClient() {
  // Judged against today each render, so a task turns urgent the day its
  // due date comes within two days, as the agent actions see it.
  const today = todayLocalISO();
  const all = useWorkspaceStore((s) => s.prioritizations) ?? NO_ROWS;
  const ranked = useMemo(() => eisRows(all, today), [all, today]);
  const actions = useMethodActions(EIS_CONFIG);
  const upsert = useWorkspaceStore((s) => s.upsertPrioritization);
  const removeOne = useWorkspaceStore((s) => s.removePrioritization);
  const { log } = useHistoryLogger("eisenhower");
  const announce = useAnnounce();
  const exportRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const form = useItemForm<MethodDraft, MethodDraft, string>({
    initial: () => draftFrom(""),
    validate: (d) => validateMethodDraft(EISENHOWER, d),
    onSave: (values) => {
      const row = actions.add(withClears(EISENHOWER, values));
      const q = eisenhowerQuadrant(EISENHOWER.read(row.fields), todayLocalISO());
      announce(
        q
          ? `Added “${shortName(row.title)}” to ${EISENHOWER_LABEL[q]}`
          : `Added “${shortName(row.title)}”`
      );
    },
  });

  // Save and Cancel unmount the editor: focus goes back to the task's Edit
  // button, in whichever pane the task lands.
  const { refFor, returnTo } = useReturnFocus();
  const closeEditor = (id: string) => {
    setEditingId(null);
    returnTo(`edit:${id}`);
  };

  const save = (id: string, draft: MethodDraft) => {
    const before = ranked.find((r) => r.row.id === id);
    const from = before ? eisenhowerQuadrant(before.values, today) : null;
    closeEditor(id);
    actions.save(id, draft);
    const to = eisenhowerQuadrant(draft, today);
    // A changed answer or date moves the task: say where to.
    if (to && to !== from) announce(`${shortName(draft.title)} moved to ${EISENHOWER_LABEL[to]}`);
  };

  // Each pane holds its order while a task is being edited; "Re-sort" catches up.
  const { ordered, isStale, resort } = useStableOrder(ranked, (r) => r.row.id, compareTasks(today));

  const resetSnapshot = useRef<PrioritizationItem[]>([]);
  const reset = () => {
    const mine = (useWorkspaceStore.getState().prioritizations ?? []).filter(
      (r) => r.framework === FRAMEWORK
    );
    resetSnapshot.current = mine;
    for (const r of mine) removeOne(r.id);
    setEditingId(null);
    log(EISENHOWER_ACTIONS.EISENHOWER_RESET, { tasks: mine.length });
  };
  const undoReset = () => {
    const have = new Set((useWorkspaceStore.getState().prioritizations ?? []).map((r) => r.id));
    for (const r of resetSnapshot.current) if (!have.has(r.id)) upsert(r);
  };

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
        prioritizations: s.prioritizations,
      })
    )
  );
  const promptConfig = useMemo(
    () => ({
      toolName: "Eisenhower Matrix",
      // Panes derived today (the due date included), with each task's reason and delegate.
      prompts: generateEisenhowerPrompts({ rows: ranked, today }, workspace),
    }),
    [ranked, today, workspace]
  );

  const rows = ranked.map((r) => r.row);
  const groups = eisGroups(ordered, today);
  const panes = groups.filter((g) => g.id !== UNSORTED);
  const unsorted = groups.find((g) => g.id === UNSORTED) as EisGroup;

  const renderTasks = (g: EisGroup) => (
    <ul className="divide-y divide-border">
      {g.tasks.map((t) => (
        <li key={t.ranked.row.id} className="py-2">
          {editingId === t.ranked.row.id ? (
            <MethodRowEditor
              config={EIS_CONFIG}
              ranked={t.ranked}
              onSave={(draft) => save(t.ranked.row.id, draft)}
              onCancel={() => closeEditor(t.ranked.row.id)}
            />
          ) : (
            <TaskRow
              task={t}
              inDelegate={g.id === "delegate"}
              onEdit={() => setEditingId(t.ranked.row.id)}
              onRemove={() => actions.remove(t.ranked.row)}
              editRef={refFor(`edit:${t.ranked.row.id}`)}
            />
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <ToolPageWrapper
      toolId="eisenhower"
      title="Eisenhower Matrix"
      description={EIS_CONFIG.description}
    >
      <div ref={exportRef} className="space-y-4">
        {hasExampleItems(rows) && <ExampleNotice onClear={actions.clearExample} />}

        <SectionCard title="Add task" icon={Plus}>
          <ItemForm
            form={form}
            submitLabel="Add task"
            submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
          >
            <Field label={EIS_CONFIG.titleLabel} error={form.errors.title} required>
              {(props) => (
                <Input
                  {...props}
                  value={form.draft.title}
                  onChange={(e) => form.update({ title: e.target.value })}
                  placeholder={EIS_CONFIG.titlePlaceholder}
                />
              )}
            </Field>
            <EisenhowerInputs
              method={EISENHOWER}
              draft={form.draft}
              update={form.update}
              errors={form.errors}
              size="md"
            />
          </ItemForm>
        </SectionCard>

        {ranked.length === 0 ? (
          <EmptyState
            icon={Square}
            action={
              <LoadExampleButton
                onLoad={() => {
                  actions.loadExample();
                  // An earlier empty "Add" shouldn't leave errors under the example.
                  form.reset();
                }}
                className="mt-4"
              />
            }
          >
            {EIS_CONFIG.emptyText}
          </EmptyState>
        ) : (
          <SectionCard
            title={`Matrix (${ranked.length === 1 ? "1 task" : `${ranked.length} tasks`})`}
            icon={Square}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="eisenhower"
                  csvData={toCsv(ranked, today)}
                  jsonData={exportRows(EISENHOWER, ranked)}
                  markdown={toMarkdown(ranked, today)}
                  targetRef={exportRef}
                />
                <ResetButton
                  label="Clear matrix"
                  title="Remove every task from the matrix?"
                  description={`${ranked.length === 1 ? "1 task" : `${ranked.length} tasks`}, sorted or not.`}
                  confirmLabel="Clear matrix"
                  doneLabel="Cleared the matrix"
                  onReset={reset}
                  onUndo={undoReset}
                />
              </>
            }
          >
            <p className="mb-3 text-sm font-medium text-text">{eisVerdict(ranked, today)}</p>
            <ResortChip isStale={isStale} onResort={resort} />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {panes.map((g) => {
                const tone = PANE[g.id as EisenhowerQuadrant];
                return (
                  <section
                    key={g.id}
                    aria-labelledby={`eis-pane-${g.id}`}
                    className={cn("min-w-0 rounded-lg border border-border p-3", tone.pane)}
                  >
                    <h3
                      id={`eis-pane-${g.id}`}
                      className={cn("text-sm font-bold uppercase tracking-wider", tone.heading)}
                    >
                      {g.label} ({g.tasks.length})
                    </h3>
                    <p className="mb-1 text-xs text-sub">{g.meaning}</p>
                    {g.tasks.length === 0 ? (
                      <p className="py-2 text-xs text-sub">None.</p>
                    ) : (
                      renderTasks(g)
                    )}
                  </section>
                );
              })}
            </div>
            {unsorted.tasks.length > 0 && (
              <section aria-labelledby="eis-pane-unsorted" className="mt-4">
                <h3
                  id="eis-pane-unsorted"
                  className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-sub"
                >
                  <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
                  {unsorted.label} ({unsorted.tasks.length})
                </h3>
                <p className="text-xs text-sub">{unsorted.meaning}</p>
                {renderTasks(unsorted)}
              </section>
            )}
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}
