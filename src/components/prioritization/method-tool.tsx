"use client";

/**
 * The shared shell for the prioritization method tools (RICE, WSJF, ICE,
 * MoSCoW, Value/Effort, Kano, Cost of Delay, Eisenhower), generalised from
 * the ICE pilot. A tool passes its method and copy; the shell wires the
 * UX contract around the method registry:
 *
 * - add: a draft-then-save form (useItemForm + the method's validate, a
 *   blank input is an error, never a default), linked to the backlog item
 *   it was imported from (linkNewRow);
 * - import: "Import from backlog" lists the backlog in its decided order,
 *   and an item this method already scored opens its row for editing
 *   instead of adding a duplicate;
 * - edit in place: MethodRowEditor, saved through saveMethodRow (the row
 *   and, for a method the backlog holds, the linked item in one undoable);
 * - rows read through to their linked items (rankMethodRows), so a hub
 *   or agent edit shows at once; unscored rows read "Not scored" and come
 *   last; the order holds still while editing (useStableOrder + ResortChip);
 * - delete with an undoable toast; first run with EmptyState +
 *   LoadExampleButton and an ExampleNotice; export with Markdown, CSV and
 *   JSON; the verdict sentence; the AI prompts.
 *
 * Plain <ol> rows (the ICE layout), not a DataTable: a DataTable renders
 * the table and its phone cards both, so every inline editor would exist
 * twice in the DOM.
 */

import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { Pencil, Plus, Trash2, type LucideIcon } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ResortChip } from "@/components/shared/resort-chip";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import { ScaleValue } from "@/components/shared/scale-picker";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/icon-button";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { useStableOrder } from "@/hooks/use-stable-order";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem, Workspace } from "@/lib/stores/workspace-types";
import type { PromptDefinition } from "@/lib/ai-prompts/types";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { emitSignal } from "@/lib/signals/signal-bus";
import { undoable } from "@/lib/utils/undoable";
import { hasExampleItems, isExampleId } from "@/lib/utils/example-id";
import type { FormErrors, Validation } from "@/lib/utils/form";
import { linkNewRow, saveMethodRow } from "@/lib/prioritization/backlog-links";
import { methodRow } from "@/lib/prioritization/binding";
import {
  method as methodById,
  type MethodId,
  type PrioritizationMethod,
  type Values,
} from "@/lib/prioritization/methods";
import { formatNumber, toNumber } from "@/lib/prioritization/methods/fields";
import { rankMethodRows, type RankedRow } from "@/lib/prioritization/rank";
import { BacklogRowLink, ImportFromBacklog, useBacklogImport } from "./backlog-link";
import { MethodInputs } from "./method-inputs";

const NO_ROWS: PrioritizationItem[] = [];
const NO_ITEMS: BacklogItem[] = [];

/** A name short enough for a one-line toast. */
export function shortName(name: string, max = 40): string {
  const t = name.trim() || "Untitled item";
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** A method form's draft: the title plus the method's inputs. */
export type MethodDraft = Values & { title: string };

/** What a custom inputs component gets (the tool's own layout of the method's inputs). */
export interface MethodInputsSlotProps {
  method: PrioritizationMethod;
  draft: MethodDraft;
  update: (patch: Values) => void;
  errors: FormErrors<string>;
  custom?: Values;
  size: "sm" | "md";
}

export interface MethodToolConfig {
  methodId: MethodId;
  /** The tool id (history, page wrapper, export filename). */
  toolId: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** "idea" / "ideas", for counts and copy. */
  noun: { one: string; many: string };
  /** The title field's label ("Idea or experiment"). */
  titleLabel: string;
  titlePlaceholder?: string;
  /** The add card's heading. Default "Add {noun.one}". */
  addTitle?: string;
  /** The add button. Default "Add & score". */
  submitLabel?: string;
  /** The ranked list's accessible name ("Ideas, highest ICE first"). */
  listLabel: string;
  /** The empty state's text. */
  emptyText: ReactNode;
  /** History action names. */
  history: { ITEM_ADDED: string; ITEM_UPDATED: string; ITEM_REMOVED: string };
  /** A row may be saved with only its title (WSJF column mode, the Value/Effort tray). */
  allowTitleOnly?: boolean;
  /** The example rows (ids from exampleId), for "Load an example". */
  buildExample?: () => PrioritizationItem[];
  /** One sentence over the list. Default: the top scored row. */
  verdict?: (rows: readonly RankedRow[]) => string;
  toMarkdown?: (rows: readonly RankedRow[]) => string;
  csv?: (rows: readonly RankedRow[]) => { headers: string[]; rows: (string | number)[][] };
  prompts?: (rows: readonly RankedRow[], workspace: Workspace) => PromptDefinition[];
  /** The tool's own inputs layout. Default: MethodInputs. */
  Inputs?: ComponentType<MethodInputsSlotProps>;
  /** A row's values in the list. Default: each input's value. */
  RowValues?: ComponentType<{ ranked: RankedRow }>;
  /** Lists by group (MoSCoW buckets, quadrants, lanes) instead of one ranked list. */
  groups?: (rows: readonly RankedRow[]) => { id: string; label: string; rows: RankedRow[] }[];
  /** Extra sections under the list (a budget bar, a chart, a matrix). */
  Panels?: ComponentType<{ rows: readonly RankedRow[] }>;
}

/* ── Rows ──────────────────────────────────────────────────────────── */

/** One method's rows, read through to their linked items, ranked; unscored last. */
export function useMethodRows(methodId: MethodId): RankedRow[] {
  const rows = useWorkspaceStore((s) => s.prioritizations) ?? NO_ROWS;
  const items = useWorkspaceStore((s) => s.backlogItems) ?? NO_ITEMS;
  return useMemo(() => rankMethodRows(methodId, rows, items), [methodId, rows, items]);
}

/** The draft for a row (its inputs as read through) or an empty one. */
export function draftFrom(title: string, values: Values = {}): MethodDraft {
  return { ...values, title };
}

/** The method's inputs of a draft (the title left out). */
function inputsOf(d: MethodDraft): Values {
  const rest: Values = { ...d };
  delete rest.title;
  return rest;
}

/**
 * A checked draft as it is saved: every input of the method present, a
 * blank one as undefined. Validation drops blanks, and saveMethodRow reads
 * an input left out as "keep what the row shows", so without this a
 * cleared due date, effort or value would come straight back.
 */
export function withClears(m: PrioritizationMethod, d: MethodDraft): MethodDraft {
  const out: MethodDraft = { ...d };
  for (const input of m.inputs) if (!(input.key in out)) out[input.key] = undefined;
  return out;
}

const isBlank = (v: unknown) => v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * Check a draft: the title, then the method's own rules (blanks are
 * errors). `keep` is what the row or the imported item already holds: an
 * off-scale value among them stays valid as "Custom" (validate's rule, the
 * agent actions' too).
 */
export function validateMethodDraft(
  m: PrioritizationMethod,
  d: MethodDraft,
  allowTitleOnly = false,
  keep?: Values
): Validation<MethodDraft, string> {
  const title = d.title.trim().replace(/\s+/g, " ").slice(0, 200);
  const values = inputsOf(d);
  const titleOnly = m.inputs.every((i) => isBlank(values[i.key]));
  const checked =
    allowTitleOnly && titleOnly ? ({ ok: true, values: {} } as const) : m.validate(values, keep);
  const errors: FormErrors<string> = checked.ok ? {} : { ...checked.errors };
  if (!title) errors.title = "Enter a title.";
  if (Object.values(errors).some(Boolean) || !checked.ok) return { ok: false, errors };
  return { ok: true, values: { ...checked.values, title } };
}

/** Off-scale values a row holds, for the pickers' "Custom". */
function customOf(m: PrioritizationMethod, values: Values): Values {
  const out: Values = {};
  for (const input of m.inputs) {
    if (input.kind !== "scale") continue;
    const n = toNumber(values[input.key]);
    if (n !== undefined && !input.steps.some((s) => s.value === n)) out[input.key] = n;
  }
  return out;
}

/* ── Actions ───────────────────────────────────────────────────────── */

export interface MethodActions {
  /**
   * Add a row (linked to `backlogItemId` when given). An input present as
   * undefined (withClears) is one blanked from the import's prefill: it
   * clears the linked item's field too.
   */
  add: (draft: MethodDraft, backlogItemId?: string | null) => PrioritizationItem;
  /**
   * Save a row's edit: the row and its linked item, in one undoable. An
   * input left out keeps what the row shows; one present as undefined
   * (withClears) is cleared.
   */
  save: (rowId: string, draft: MethodDraft) => void;
  /** Delete with Undo. */
  remove: (row: PrioritizationItem) => void;
  loadExample: () => void;
  clearExample: () => void;
}

export function useMethodActions(config: MethodToolConfig): MethodActions {
  const m = methodById(config.methodId);
  const upsert = useWorkspaceStore((s) => s.upsertPrioritization);
  const removeOne = useWorkspaceStore((s) => s.removePrioritization);
  const { log } = useHistoryLogger(config.toolId);

  const signal = (row: PrioritizationItem) =>
    emitSignal({
      kind: "prioritization.scored",
      at: row.updatedAt,
      toolId: config.toolId,
      payload: { framework: m.id, id: row.id, score: row.score ?? null },
    });

  return {
    add(draft, backlogItemId) {
      const values = inputsOf(draft);
      const row = linkNewRow(
        methodRow({ id: crypto.randomUUID(), framework: m.id, title: draft.title, values }),
        backlogItemId,
        values
      );
      upsert(row);
      log(config.history.ITEM_ADDED, { title: row.title, score: row.score ?? null });
      signal(row);
      return row;
    },
    save(rowId, draft) {
      const saved = saveMethodRow(rowId, inputsOf(draft), { title: draft.title });
      if (!saved) return;
      log(config.history.ITEM_UPDATED, { id: rowId, score: saved.score ?? null });
      signal(saved);
    },
    remove(row) {
      undoable({
        label: `Deleted “${shortName(row.title)}”`,
        apply: () => {
          removeOne(row.id);
          log(config.history.ITEM_REMOVED, { id: row.id });
        },
        revert: () => upsert(row),
      });
    },
    loadExample() {
      const have = new Set((useWorkspaceStore.getState().prioritizations ?? []).map((r) => r.id));
      for (const row of config.buildExample?.() ?? []) if (!have.has(row.id)) upsert(row);
    },
    clearExample() {
      for (const row of useWorkspaceStore.getState().prioritizations ?? []) {
        if (row.framework === m.id && isExampleId(row.id)) removeOne(row.id);
      }
    },
  };
}

/* ── Forms ─────────────────────────────────────────────────────────── */

function DraftFields({
  config,
  form,
  custom,
  size,
}: {
  config: MethodToolConfig;
  form: ItemFormState<MethodDraft, string>;
  custom?: Values;
  size: "sm" | "md";
}) {
  const m = methodById(config.methodId);
  const Inputs = config.Inputs;
  return (
    <>
      <Field label={config.titleLabel} error={form.errors.title} required>
        {(props) => (
          <Input
            {...props}
            value={form.draft.title}
            onChange={(e) => form.update({ title: e.target.value })}
            placeholder={config.titlePlaceholder}
          />
        )}
      </Field>
      {Inputs ? (
        <Inputs
          method={m}
          draft={form.draft}
          update={form.update}
          errors={form.errors}
          custom={custom}
          size={size}
        />
      ) : (
        <MethodInputs
          method={m}
          draft={form.draft}
          update={form.update}
          errors={form.errors}
          custom={custom}
          size={size}
          className="xl:grid-cols-2"
        />
      )}
    </>
  );
}

/** Edit a row in place: Enter saves, Escape cancels, focus starts on the title. */
export function MethodRowEditor({
  config,
  ranked,
  onSave,
  onCancel,
}: {
  config: MethodToolConfig;
  ranked: RankedRow;
  onSave: (draft: MethodDraft) => void;
  onCancel: () => void;
}) {
  const m = methodById(config.methodId);
  const start = draftFrom(ranked.row.title, ranked.values);
  const form = useItemForm<MethodDraft, MethodDraft, string>({
    initial: start,
    // What the row shows may stay as it is (an off-scale value is "Custom").
    validate: (d) => validateMethodDraft(m, d, config.allowTitleOnly, ranked.values),
    // Every input goes to the save, a blanked one as a clear.
    onSave: (values) => onSave(withClears(m, values)),
    resetOnSave: false,
  });
  const { formRef } = form;
  // Open on the title, so the keyboard user lands where they were heading.
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
      <DraftFields config={config} form={form} custom={customOf(m, ranked.values)} size="sm" />
    </ItemForm>
  );
}

/* ── List ──────────────────────────────────────────────────────────── */

/** A row's inputs as short values (the default RowValues). */
function DefaultRowValues({
  method: m,
  ranked,
}: {
  method: PrioritizationMethod;
  ranked: RankedRow;
}) {
  return (
    <dl className="flex flex-wrap items-center gap-3 font-mono text-xs text-sub">
      {m.inputs
        .filter((i) => ranked.values[i.key] !== undefined)
        .map((input) => {
          const v = ranked.values[input.key];
          const shown =
            input.kind === "scale" ? (
              <ScaleValue steps={input.steps} value={v} />
            ) : input.kind === "choice" ? (
              (input.options.find((o) => o.id === v)?.label ?? String(v))
            ) : (
              String(v)
            );
          return (
            <div key={input.key} className="flex gap-1">
              <dt className="font-sans">{input.label}</dt>
              <dd className="text-text">{shown}</dd>
            </div>
          );
        })}
    </dl>
  );
}

function MethodRow({
  config,
  ranked,
  onEdit,
  onRemove,
}: {
  config: MethodToolConfig;
  ranked: RankedRow;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const m = methodById(config.methodId);
  const { row, result } = ranked;
  const RowValues = config.RowValues;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span
        className="w-6 shrink-0 font-mono text-xs text-sub"
        aria-label={ranked.rank === null ? "Not ranked" : `Rank ${ranked.rank}`}
      >
        {ranked.rank ?? "—"}
      </span>
      <span className="inline-flex min-w-0 flex-1 basis-48 flex-wrap items-center gap-2 text-sm text-text">
        <span className="break-words">{row.title}</span>
        <BacklogRowLink row={row} />
      </span>
      {RowValues ? <RowValues ranked={ranked} /> : <DefaultRowValues method={m} ranked={ranked} />}
      <span className="shrink-0 text-right font-mono text-sm text-text">
        {result.score === null ? (
          <span className="font-sans text-xs text-sub">Not scored</span>
        ) : (
          <>
            <span className="sr-only">{m.label} </span>
            {m.format(result.score)}
          </>
        )}
      </span>
      <span className="flex shrink-0 items-center">
        <IconButton
          label={`Edit ${row.title}`}
          icon={<Pencil className="h-4 w-4" />}
          className="text-sub hover:text-text"
          onClick={onEdit}
        />
        <IconButton
          label={`Delete ${row.title}`}
          icon={<Trash2 className="h-4 w-4" />}
          className="text-sub hover:text-danger"
          onClick={onRemove}
        />
      </span>
      {result.warnings.length > 0 && (
        <p className="basis-full text-xs text-warning">{result.warnings.join(" ")}</p>
      )}
    </div>
  );
}

/** "Do first: X (RICE 2,400)." Ties named; nothing scored says so. */
export function defaultVerdict(m: PrioritizationMethod, rows: readonly RankedRow[]): string {
  const scored = rows.filter((r) => r.result.score !== null);
  if (scored.length === 0) {
    return rows.length === 0 ? "Nothing to rank yet." : `None of the ${rows.length} is scored yet.`;
  }
  const top = scored.filter((r) => r.rank === 1);
  const score = m.format(top[0].result.score as number);
  const names = top.map((r) => `“${shortName(r.row.title)}”`);
  const unscored = rows.length - scored.length;
  const rest = unscored > 0 ? ` ${unscored} not scored yet.` : "";
  return top.length > 1
    ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} tie for first (${m.label} ${score}).${rest}`
    : `Do first: ${names[0]} (${m.label} ${score}).${rest}`;
}

/** The default CSV: rank, title, each input, the score. */
function defaultCsv(m: PrioritizationMethod, rows: readonly RankedRow[]) {
  return {
    headers: ["Rank", "Title", ...m.inputs.map((i) => i.label), m.label],
    rows: rows.map((r) => [
      r.rank ?? "",
      r.row.title,
      ...m.inputs.map((i) => r.values[i.key] ?? ""),
      r.result.score === null ? "" : formatNumber(r.result.score, 2),
    ]),
  };
}

/* ── The tool ──────────────────────────────────────────────────────── */

export function MethodTool({ config }: { config: MethodToolConfig }) {
  const m = methodById(config.methodId);
  const ranked = useMethodRows(config.methodId);
  const actions = useMethodActions(config);
  const exportRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // "Import from backlog" (or a "Score with…" link) fills the add form; an
  // item this method already scored opens its row instead of a second one.
  // It comes before the form: the item it links to decides what the form
  // may keep (formRef reaches the form from the pick).
  const formRef = useRef<ItemFormState<MethodDraft, string> | null>(null);
  const backlog = useBacklogImport(
    m.id,
    (picked) =>
      formRef.current?.reset({
        ...(m.fromBacklog ? definedValues(m.fromBacklog(picked)) : {}),
        title: picked.name,
      }),
    { onEdit: (row) => setEditingId(row.id) }
  );
  // What the imported item already holds: an off-scale value of it stays
  // valid in the add form ("Custom"), as it would in the row's editor.
  const pending = backlog.pending;
  const held = useMemo(
    () => (pending && m.fromBacklog ? m.fromBacklog(pending) : undefined),
    [pending, m]
  );
  const form = useItemForm<MethodDraft, MethodDraft, string>({
    initial: { title: "" },
    validate: (d) => validateMethodDraft(m, d, config.allowTitleOnly, held),
    onSave: (values) => {
      actions.add(withClears(m, values), backlog.pending?.id);
      backlog.clear();
    },
  });
  formRef.current = form;

  // The order on screen holds while a row is being edited; "Re-sort" catches up.
  const position = new Map(ranked.map((r, i) => [r.row.id, i]));
  const { ordered, isStale, resort } = useStableOrder(
    ranked,
    (r) => r.row.id,
    (a, b) => (position.get(a.row.id) ?? 0) - (position.get(b.row.id) ?? 0)
  );

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
  const prompts = config.prompts?.(ranked, workspace) ?? [];
  const rows = ranked.map((r) => r.row);

  const renderRow = (r: RankedRow) => (
    <li key={r.row.id} className="py-3">
      {editingId === r.row.id ? (
        <MethodRowEditor
          config={config}
          ranked={r}
          onSave={(draft) => {
            setEditingId(null);
            actions.save(r.row.id, draft);
          }}
          onCancel={() => setEditingId(null)}
        />
      ) : (
        <MethodRow
          config={config}
          ranked={r}
          onEdit={() => setEditingId(r.row.id)}
          onRemove={() => actions.remove(r.row)}
        />
      )}
    </li>
  );

  const Panels = config.Panels;

  return (
    <ToolPageWrapper toolId={config.toolId} title={config.title} description={config.description}>
      <div ref={exportRef} className="space-y-4">
        {hasExampleItems(rows) && <ExampleNotice onClear={actions.clearExample} />}

        <SectionCard title={config.addTitle ?? `Add ${config.noun.one}`} icon={Plus}>
          <ItemForm
            form={form}
            submitLabel={config.submitLabel ?? "Add & score"}
            submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
            footer={<ImportFromBacklog link={backlog} />}
          >
            <DraftFields
              config={config}
              form={form}
              custom={held ? customOf(m, held) : undefined}
              size="md"
            />
          </ItemForm>
        </SectionCard>

        {ranked.length === 0 ? (
          <EmptyState
            icon={config.icon}
            action={
              config.buildExample ? (
                <LoadExampleButton
                  onLoad={() => {
                    actions.loadExample();
                    // An earlier empty "Add" shouldn't leave errors under the example.
                    form.reset();
                  }}
                  className="mt-4"
                />
              ) : undefined
            }
          >
            {config.emptyText}
          </EmptyState>
        ) : (
          <SectionCard
            title={`${config.noun.many[0].toUpperCase()}${config.noun.many.slice(1)} (${ranked.length})`}
            icon={config.icon}
            actions={
              <>
                {prompts.length > 0 && (
                  <AiPromptGenerator config={{ toolName: config.title, prompts }} />
                )}
                <ExportButton
                  filename={config.toolId}
                  csvData={(config.csv ?? ((x) => defaultCsv(m, x)))(ranked)}
                  jsonData={rows}
                  markdown={config.toMarkdown?.(ranked)}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <p className="mb-3 text-sm font-medium text-text">
              {(config.verdict ?? ((x) => defaultVerdict(m, x)))(ranked)}
            </p>
            <ResortChip isStale={isStale} onResort={resort} />
            {config.groups ? (
              config.groups(ordered).map((g) => (
                <section key={g.id} aria-label={g.label} className="mb-4">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-sub">
                    {g.label} ({g.rows.length})
                  </h3>
                  <ol className="divide-y divide-border">{g.rows.map(renderRow)}</ol>
                </section>
              ))
            ) : (
              <ol className="divide-y divide-border" aria-label={config.listLabel}>
                {ordered.map(renderRow)}
              </ol>
            )}
          </SectionCard>
        )}
        {Panels && ranked.length > 0 && <Panels rows={ranked} />}
      </div>
    </ToolPageWrapper>
  );
}

/** Values with the unset ones left out (a form draft never holds undefined keys from a prefill). */
function definedValues(v: Values): Values {
  const out: Values = {};
  for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = x;
  return out;
}
