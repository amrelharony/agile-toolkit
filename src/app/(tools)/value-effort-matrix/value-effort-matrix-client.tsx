"use client";

/**
 * Value vs Effort: a draggable 2×2 of each item's value (the backlog's one
 * value field, on the Fibonacci steps; 8 or more is high) against its
 * effort (1–10; 6 or more is high).
 *
 * - The quadrant is derived live from value and effort, never stored, by
 *   the method registry, so the page, the Prioritizer and the agent
 *   actions put an item in the same quadrant.
 * - Dragging or arrow-keying a dot writes value and effort back; a row
 *   linked to a backlog item reads them from the item and writes them to
 *   it, in one undoable (saveMethodRow).
 * - A title alone is a valid item: it waits under "Not placed yet" (the
 *   matrix's tray) until it is placed. One score without the other is an
 *   error.
 * - Lists go quadrant by quadrant in do-first order, best value ÷ effort
 *   first, and hold still while a row is being edited.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Grid3X3, List, Plus } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import { ResetButton } from "@/components/shared/reset-button";
import { ResortChip } from "@/components/shared/resort-chip";
import { SectionCard } from "@/components/shared/section-card";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ImportFromBacklog, useBacklogImport } from "@/components/prioritization/backlog-link";
import { MethodInputs } from "@/components/prioritization/method-inputs";
import {
  MethodRowEditor,
  draftFrom,
  exportRows,
  useMethodActions,
  useMethodRows,
  validateMethodDraft,
  withClears,
  type MethodDraft,
} from "@/components/prioritization/method-tool";
import { useStableOrder } from "@/hooks/use-stable-order";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem, Workspace } from "@/lib/stores/workspace-types";
import { generateValueEffortPrompts } from "@/lib/ai-prompts/value-effort-matrix";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { VALUE_EFFORT_ACTIONS } from "@/lib/history/event-actions";
import { hasExampleItems } from "@/lib/utils/example-id";
import type { MatrixAt } from "@/lib/utils/matrix";
import { method, type Values } from "@/lib/prioritization/methods";
import { defined } from "@/lib/prioritization/methods/fields";
import { VE_CONFIG } from "./config";
import { toMarkdown } from "./markdown";
import { ValueEffortMap, type PlaceHow } from "./matrix";
import {
  FRAMEWORK,
  UNPLACED,
  customValues,
  placeOf,
  positionText,
  promptGroups,
  shortName,
  toCsv,
  veGroups,
} from "./model";
import { VeRow } from "./rows";
import { veVerdict } from "./verdict";

const VALUE_EFFORT = method(FRAMEWORK);

export function ValueEffortMatrixClient() {
  const ranked = useMethodRows(FRAMEWORK);
  const actions = useMethodActions(VE_CONFIG);
  const upsert = useWorkspaceStore((s) => s.upsertPrioritization);
  const removeOne = useWorkspaceStore((s) => s.removePrioritization);
  const { log } = useHistoryLogger("value-effort-matrix");
  const announce = useAnnounce();
  const exportRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLLIElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // "Import from backlog" (or a "Score with Value/Effort" link) fills the
  // add form with the item's value and effort; an item already on the
  // matrix opens its row for editing instead of a second one.
  const formRef = useRef<ItemFormState<MethodDraft, string> | null>(null);
  const backlog = useBacklogImport(
    FRAMEWORK,
    (picked) =>
      formRef.current?.reset({
        ...(defined(VALUE_EFFORT.fromBacklog?.(picked) ?? {}) as Values),
        title: picked.name,
      }),
    {
      onEdit: (row) => {
        setEditingId(row.id);
        announce(`Editing “${shortName(row.title)}”: it's already on the matrix.`);
      },
    }
  );
  const focusEditor = () => editorRef.current?.querySelector<HTMLElement>("input")?.focus();
  // What the imported item holds: an off-scale value of it may stay ("Custom").
  const pending = backlog.pending;
  const held = useMemo(
    () => (pending && VALUE_EFFORT.fromBacklog ? VALUE_EFFORT.fromBacklog(pending) : undefined),
    [pending]
  );

  const form = useItemForm<MethodDraft, MethodDraft, string>({
    initial: () => draftFrom(""),
    validate: (d) => validateMethodDraft(VALUE_EFFORT, d, true, held),
    onSave: (values) => {
      const row = actions.add(withClears(VALUE_EFFORT, values), backlog.pending?.id);
      backlog.clear();
      const p = placeOf({ values: VALUE_EFFORT.read(row.fields) });
      announce(
        p.value !== null && p.effort !== null
          ? `Added “${shortName(row.title)}”: ${positionText(p)}`
          : `Added “${shortName(row.title)}” to Not placed yet`
      );
    },
  });
  formRef.current = form;

  // The lists hold their order while a row is edited ("Re-sort" catches up);
  // a move on the matrix re-sorts them once it is saved.
  const position = new Map(ranked.map((r, i) => [r.row.id, i]));
  const { ordered, isStale, resort } = useStableOrder(
    ranked,
    (r) => r.row.id,
    (a, b) => (position.get(a.row.id) ?? 0) - (position.get(b.row.id) ?? 0)
  );
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    if (!moved) return;
    setMoved(false);
    if (editingId === null) resort();
  }, [moved, editingId, resort]);

  const place = (id: string, at: MatrixAt, how: PlaceHow) => {
    const r = ranked.find((x) => x.row.id === id);
    if (!r) return;
    actions.save(id, { title: r.row.title, value: at.y, effort: at.x });
    setMoved(true);
    setSelectedId(id);
    // A drag and the arrow keys announce as they go; the picker says where it went.
    if (how === "pick") {
      announce(`${shortName(r.row.title)}: ${positionText({ value: at.y, effort: at.x })}`);
    }
  };

  const resetSnapshot = useRef<PrioritizationItem[]>([]);
  const reset = () => {
    const mine = (useWorkspaceStore.getState().prioritizations ?? []).filter(
      (r) => r.framework === FRAMEWORK
    );
    resetSnapshot.current = mine;
    for (const r of mine) removeOne(r.id);
    setEditingId(null);
    setSelectedId(null);
    log(VALUE_EFFORT_ACTIONS.MATRIX_RESET, { items: mine.length });
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
      toolName: "Value vs Effort Matrix",
      prompts: generateValueEffortPrompts({ grouped: promptGroups(ranked) }, workspace),
    }),
    [ranked, workspace]
  );

  const rows = ranked.map((r) => r.row);
  const verdict = veVerdict(ranked);
  const groups = veGroups(ordered);

  return (
    <ToolPageWrapper
      toolId="value-effort-matrix"
      title="Value vs Effort Matrix"
      description={VE_CONFIG.description}
    >
      <div ref={exportRef} className="space-y-4">
        {hasExampleItems(rows) && <ExampleNotice onClear={actions.clearExample} />}

        <SectionCard title="Add item" icon={Plus}>
          <ItemForm
            form={form}
            submitLabel="Add"
            submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
            footer={<ImportFromBacklog link={backlog} onRoutedToEdit={focusEditor} />}
          >
            <Field label={VE_CONFIG.titleLabel} error={form.errors.title} required>
              {(props) => (
                <Input
                  {...props}
                  value={form.draft.title}
                  onChange={(e) => form.update({ title: e.target.value })}
                  placeholder={VE_CONFIG.titlePlaceholder}
                />
              )}
            </Field>
            <MethodInputs
              method={VALUE_EFFORT}
              draft={form.draft}
              update={form.update}
              errors={form.errors}
              custom={customValues(held)}
              className="xl:grid-cols-2"
            />
            <p className="text-xs text-sub">
              Give both a value and an effort, or leave both empty and place it on the matrix later.
            </p>
          </ItemForm>
        </SectionCard>

        {ranked.length === 0 ? (
          <EmptyState
            icon={Grid3X3}
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
            {VE_CONFIG.emptyText}
          </EmptyState>
        ) : (
          <>
            <SectionCard
              title="Matrix"
              icon={Grid3X3}
              actions={
                <>
                  <AiPromptGenerator config={promptConfig} />
                  <ExportButton
                    filename="value-effort"
                    csvData={toCsv(ranked)}
                    jsonData={exportRows(VALUE_EFFORT, ranked)}
                    markdown={toMarkdown(ranked)}
                    targetRef={exportRef}
                  />
                  <ResetButton
                    label="Clear matrix"
                    title="Remove every item from the matrix?"
                    description={`${ranked.length === 1 ? "1 item" : `${ranked.length} items`}, placed or not. Backlog items they link to stay in the backlog.`}
                    confirmLabel="Clear matrix"
                    doneLabel="Cleared the matrix"
                    onReset={reset}
                    onUndo={undoReset}
                  />
                </>
              }
            >
              <p className="mb-3 text-sm font-medium text-text">{verdict}</p>
              <ValueEffortMap
                rows={ranked}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onPlace={place}
              />
            </SectionCard>

            <SectionCard title={`Items (${ranked.length})`} icon={List}>
              <ResortChip isStale={isStale} onResort={resort} />
              {groups
                .filter((g) => g.id !== UNPLACED || g.rows.length > 0)
                .map((g) => (
                  // Named by its heading with the count ("Not placed yet (2)"),
                  // so it never shares a name with the matrix's own tray.
                  <section key={g.id} aria-labelledby={`ve-list-${g.id}`} className="mb-4">
                    <h3
                      id={`ve-list-${g.id}`}
                      className="text-xs font-medium uppercase tracking-wider text-sub"
                    >
                      {g.label} ({g.rows.length})
                    </h3>
                    <p className="text-xs text-sub">{g.meaning}</p>
                    {g.rows.length === 0 ? (
                      <p className="py-2 text-xs text-sub">None yet.</p>
                    ) : (
                      <ol className="divide-y divide-border">
                        {g.rows.map((r) => (
                          <li
                            key={r.row.id}
                            ref={editingId === r.row.id ? editorRef : undefined}
                            className="py-3"
                          >
                            {editingId === r.row.id ? (
                              <MethodRowEditor
                                config={VE_CONFIG}
                                ranked={r}
                                onSave={(draft) => {
                                  setEditingId(null);
                                  actions.save(r.row.id, draft);
                                }}
                                onCancel={() => setEditingId(null)}
                              />
                            ) : (
                              <VeRow
                                ranked={r}
                                selected={selectedId === r.row.id}
                                onEdit={() => setEditingId(r.row.id)}
                                onRemove={() => actions.remove(r.row)}
                              />
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                ))}
            </SectionCard>
          </>
        )}
      </div>
    </ToolPageWrapper>
  );
}
