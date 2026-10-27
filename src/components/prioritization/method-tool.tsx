"use client";

/**
 * The shared shell for the prioritization method tools (RICE, WSJF, ICE,
 * MoSCoW, Value/Effort, Kano, Cost of Delay, Eisenhower), generalised from
 * the ICE pilot. A tool passes its method and copy; the shell wires the
 * UX contract around the method registry:
 *
 * - add: a draft-then-save form (useItemForm + the method's validate, a
 *   blank input is an error, never a default), linked to the backlog item
 *   it was imported from (linkNewRow); `initialDraft` and `remember` seed
 *   it with a shown, editable start (RICE's reach period, the last one
 *   picked), never a mid-range score;
 * - import: "Import from backlog" lists the backlog in its decided order,
 *   and an item this method already scored opens its row for editing
 *   instead of adding a duplicate (focus moves into that editor, and it
 *   is announced);
 * - edit in place: MethodRowEditor, saved through saveMethodRow (the row
 *   and, for a method the backlog holds, the linked item in one undoable);
 *   Save and Cancel hand focus back to the row's Edit button, and a save
 *   that moves the row to another group (a bucket, a lane) says so;
 * - rows read through to their linked items (rankMethodRows), so a hub
 *   or agent edit shows at once; unscored rows read "Not scored" and come
 *   last; the order holds still while editing (useStableOrder + ResortChip);
 * - delete with an undoable toast, focus moving to the next row (else the
 *   one before, else the add form's title); first run with EmptyState +
 *   LoadExampleButton and an ExampleNotice; export with Markdown, CSV and
 *   JSON, all three as the screen reads (exportRows); the verdict
 *   sentence; the AI prompts;
 * - a tool's own parts: its inputs layout (told the row and its linked
 *   item), row values, groups, a section above the list (BeforeList) and
 *   under it (Panels), its own check (validate), and rowScore: false for a
 *   method whose rows have no rank or score to show (MoSCoW).
 *
 * Plain <ol> rows (the ICE layout), not a DataTable: a DataTable renders
 * the table and its phone cards both, so every inline editor would exist
 * twice in the DOM.
 */

import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { Pencil, Plus, Trash2, type LucideIcon } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ResortChip } from "@/components/shared/resort-chip";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import { ScaleValue } from "@/components/shared/scale-picker";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/icon-button";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { useReturnFocus } from "@/hooks/use-return-focus";
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
import { linkedItem, methodRow } from "@/lib/prioritization/binding";
import {
  legacyDifferences,
  method as methodById,
  readThrough,
  scoreCache,
  type MethodId,
  type MethodInput,
  type PrioritizationMethod,
  type Values,
} from "@/lib/prioritization/methods";
import { formatNumber, toNumber } from "@/lib/prioritization/methods/fields";
import { rankMethodRows, type RankedRow } from "@/lib/prioritization/rank";
import { BacklogRowLink, ImportFromBacklog, useBacklogImport } from "./backlog-link";
import { MethodInputs } from "./method-inputs";

const NO_ROWS: PrioritizationItem[] = [];
const NO_ITEMS: BacklogItem[] = [];
/** The add form's title, as a useReturnFocus key. */
const ADD_TITLE = "add:title";
/** The open row editor's title (one editor is open at a time). */
const EDITOR_TITLE = "editor:title";

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
  /** The row being edited; absent in the add form. */
  row?: PrioritizationItem;
  /**
   * The backlog item the form's row links to: the edited row's, or the
   * item the add form was imported from (MoSCoW shows its job size in
   * place of the row's own effort).
   */
  item?: BacklogItem;
}

/** What a tool's own check (`MethodToolConfig.validate`) is told about the form. */
export interface MethodValidateContext {
  /** The row in the editor; absent in the add form. */
  editing?: RankedRow;
  /** What the row or the imported item already holds (an off-scale value stays valid). */
  keep?: Values;
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
  /**
   * The add form's and the editor's check, in place of validateMethodDraft
   * (which it may call): WSJF lets a feature that column scoring left
   * partial be renamed or re-scored in place (validatePartialDraft).
   */
  validate?: (draft: MethodDraft, ctx: MethodValidateContext) => Validation<MethodDraft, string>;
  /**
   * false: rows show no rank and no score, and the order never holds
   * still for a Re-sort (MoSCoW: the bucket is the answer, and its
   * groups already show a move).
   */
  rowScore?: false;
  /**
   * What the add form starts with besides the title, shown and editable,
   * never hidden (RICE: `{ reachPeriod: "quarter" }`). Nothing that would
   * be a mid-range score: a default here is a unit or a period, never a
   * value of the method's scale.
   */
  initialDraft?: Values;
  /**
   * Input keys the add form remembers: each starts at the value of the
   * most recently saved row of this method that has one (read through to
   * its item), else at `initialDraft` (RICE remembers its reach period).
   */
  remember?: readonly string[];
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
  /** A section between the add form and the list (WSJF's column scoring), once there are rows. */
  BeforeList?: ComponentType<{ rows: readonly RankedRow[] }>;
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

/**
 * The add form's first draft: `initialDraft`, then each `remember` key at
 * the newest saved row's value for it (read through to its item). Reads
 * the store when called, so the draft after an add starts from that add.
 */
export function startDraft(
  m: PrioritizationMethod,
  config: Pick<MethodToolConfig, "initialDraft" | "remember">,
  rows: readonly PrioritizationItem[],
  items: readonly BacklogItem[]
): MethodDraft {
  const out: MethodDraft = { ...config.initialDraft, title: "" };
  if (!config.remember?.length) return out;
  const newestFirst = rows
    .filter((r) => r.framework === m.id)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  for (const key of config.remember) {
    for (const row of newestFirst) {
      const item = m.embedded ? linkedItem(row, items) : undefined;
      const v = m.read(readThrough(row, item))[key];
      if (v !== undefined) {
        out[key] = v;
        break;
      }
    }
  }
  return out;
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

/** A draft's title as saved: trimmed, single-spaced, at most 200 characters. */
const cleanTitle = (title: string) => title.trim().replace(/\s+/g, " ").slice(0, 200);

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
  const title = cleanTitle(d.title);
  const values = inputsOf(d);
  const titleOnly = m.inputs.every((i) => isBlank(values[i.key]));
  const checked =
    allowTitleOnly && titleOnly ? ({ ok: true, values: {} } as const) : m.validate(values, keep);
  const errors: FormErrors<string> = checked.ok ? {} : { ...checked.errors };
  if (!title) errors.title = "Enter a title.";
  if (Object.values(errors).some(Boolean) || !checked.ok) return { ok: false, errors };
  return { ok: true, values: { ...checked.values, title } };
}

/**
 * Check a draft that may be partial: the inputs it has set by the
 * method's rules, the blank ones left unset rather than refused. A full or
 * a title-only draft is checked as validateMethodDraft checks it. For a
 * row some inputs of which are still to come (WSJF's column scoring fills
 * one part at a time), so its editor can rename it or change one part
 * without the others being demanded first.
 */
export function validatePartialDraft(
  m: PrioritizationMethod,
  d: MethodDraft,
  keep?: Values
): Validation<MethodDraft, string> {
  const values = inputsOf(d);
  const blank = new Set(m.inputs.filter((i) => isBlank(values[i.key])).map((i) => i.key));
  const required = m.inputs.filter((i) => !i.optional);
  if (blank.size === m.inputs.length || required.every((i) => !blank.has(i.key))) {
    return validateMethodDraft(m, d, true, keep);
  }
  const checked = validateMethodDraft(m, d, false, keep);
  if (checked.ok) return checked;
  const errors: FormErrors<string> = {};
  for (const [key, error] of Object.entries(checked.errors)) {
    if (error && !blank.has(key)) errors[key] = error;
  }
  if (Object.values(errors).some(Boolean)) return { ok: false, errors };
  // The set inputs as drafted, as toValidation passes them on (so this is
  // for a method whose validate doesn't reshape its values, as WSJF's).
  const set: Values = {};
  for (const input of m.inputs) if (!blank.has(input.key)) set[input.key] = values[input.key];
  return { ok: true, values: { ...set, title: cleanTitle(d.title) } };
}

/** A form's check: the tool's own (`validate`), else validateMethodDraft. */
function checkDraft(
  config: MethodToolConfig,
  m: PrioritizationMethod,
  d: MethodDraft,
  ctx: MethodValidateContext
): Validation<MethodDraft, string> {
  return config.validate
    ? config.validate(d, ctx)
    : validateMethodDraft(m, d, config.allowTitleOnly, ctx.keep);
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
  row,
  item,
  titleRef,
}: {
  config: MethodToolConfig;
  form: ItemFormState<MethodDraft, string>;
  custom?: Values;
  size: "sm" | "md";
  row?: PrioritizationItem;
  item?: BacklogItem;
  titleRef?: (el: HTMLElement | null) => void;
}) {
  const m = methodById(config.methodId);
  const Inputs = config.Inputs;
  return (
    <>
      <Field label={config.titleLabel} error={form.errors.title} required>
        {(props) => (
          <Input
            {...props}
            ref={titleRef}
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
          row={row}
          item={item}
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
  titleRef,
}: {
  config: MethodToolConfig;
  ranked: RankedRow;
  onSave: (draft: MethodDraft) => void;
  onCancel: () => void;
  /** The title input, for focus that comes back to the editor. */
  titleRef?: (el: HTMLElement | null) => void;
}) {
  const m = methodById(config.methodId);
  const items = useWorkspaceStore((s) => s.backlogItems) ?? NO_ITEMS;
  const start = draftFrom(ranked.row.title, ranked.values);
  const form = useItemForm<MethodDraft, MethodDraft, string>({
    initial: start,
    // What the row shows may stay as it is (an off-scale value is "Custom").
    validate: (d) => checkDraft(config, m, d, { editing: ranked, keep: ranked.values }),
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
      <DraftFields
        config={config}
        form={form}
        custom={customOf(m, ranked.values)}
        size="sm"
        row={ranked.row}
        item={linkedItem(ranked.row, items)}
        titleRef={titleRef}
      />
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

/** One input's value as a sentence shows it ("Must have", "80%", "13"). */
function inputText(input: MethodInput, v: string | number): string {
  if (input.kind === "choice") return input.options.find((o) => o.id === v)?.label ?? String(v);
  if (input.kind === "scale" && input.format === "pct") return `${v}%`;
  if (input.kind === "scale" && input.format === "x") return `${v}x`;
  return String(v);
}

/**
 * A row linked before Phase 7 that holds another value than its backlog
 * item (legacyDifferences): old items carry no date, so the tool asks once
 * which one stays. The item's value counts until then, as everywhere. The
 * shell's rows show it; a tool with its own rows (Value vs Effort) renders
 * it too, wired with useLegacyChoice.
 */
export function LegacyChoice({
  method: m,
  row,
  onUseRow,
  onKeepItem,
}: {
  method: PrioritizationMethod;
  row: PrioritizationItem;
  onUseRow: (values: Values) => void;
  onKeepItem: () => void;
}) {
  const item = useWorkspaceStore((s) => linkedItem(row, s.backlogItems ?? NO_ITEMS));
  const diffs = legacyDifferences(row, item);
  if (!item || diffs.length === 0) return null;
  const parts = diffs.map((d) => {
    const input = m.inputs.find((i) => i.key === d.key) as MethodInput;
    return `${input.label} ${inputText(input, d.row)} here, ${inputText(input, d.item)} on the backlog item`;
  });
  const own: Values = Object.fromEntries(diffs.map((d) => [d.key, d.row]));
  return (
    <div
      role="note"
      className="basis-full space-y-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-text"
    >
      <p>
        From before the backlog item became the one source, this row and “{shortName(item.name)}”
        disagree: {parts.join("; ")}. The backlog item&apos;s value counts until you choose.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Use this row's ${m.label} values for ${row.title}`}
          onClick={() => onUseRow(own)}
        >
          Use this row&apos;s
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Keep the backlog item's ${m.label} values for ${row.title}`}
          onClick={onKeepItem}
        >
          Keep the backlog item&apos;s
        </Button>
      </div>
    </div>
  );
}

/** What a tool wires LegacyChoice's two buttons to (useLegacyChoice). */
export interface LegacyChoiceActions {
  /** "Use this row's": its own values written through to the item. */
  takeRow: (r: RankedRow, values: Values) => void;
  /** "Keep the backlog item's": the values the row shows copied into its own fields. */
  keepItem: (r: RankedRow) => void;
}

/**
 * A legacy row's two answers (LegacyChoice). This row's values: written
 * through to the item by `save` (saveMethodRow, with Undo). The item's:
 * copied into the row's own fields, so nothing disagrees any more (with
 * Undo too). Either save drops the row's legacy mark. Focus goes to the
 * row's Edit button (`returnTo("edit:<id>")`), as the note it was in goes
 * away, and the choice is announced; `afterTake`, read once the row's
 * values are saved, adds to that announcement (a move to another quadrant,
 * a value WSJF shares).
 */
export function useLegacyChoice(
  m: PrioritizationMethod,
  save: (rowId: string, draft: MethodDraft) => void,
  returnTo: (key: string) => void,
  afterTake?: (r: RankedRow, values: Values) => string | null
): LegacyChoiceActions {
  const announce = useAnnounce();
  return {
    takeRow(r, values) {
      returnTo(`edit:${r.row.id}`);
      save(r.row.id, { ...values, title: r.row.title });
      const more = afterTake?.(r, values);
      announce(
        `Kept this row's ${m.label} values for “${shortName(r.row.title)}”.${more ? ` ${more}` : ""}`
      );
    },
    keepItem(r) {
      const before = r.row;
      const next = methodRow({
        id: before.id,
        framework: m.id,
        title: before.title,
        values: r.values,
        prev: before,
      });
      const store = () => useWorkspaceStore.getState();
      returnTo(`edit:${before.id}`);
      undoable({
        label: `Kept the backlog item's values for “${shortName(before.title)}”`,
        apply: () => store().upsertPrioritization(next),
        revert: () => {
          const cur = (store().prioritizations ?? []).find((p) => p.id === before.id);
          // Back only if nobody saved the row since.
          if (cur && cur.updatedAt === next.updatedAt) store().upsertPrioritization(before);
        },
      });
      announce(`Kept the backlog item's ${m.label} values for “${shortName(before.title)}”.`);
    },
  };
}

function MethodRow({
  config,
  ranked,
  onEdit,
  onRemove,
  onUseRow,
  onKeepItem,
  editRef,
}: {
  config: MethodToolConfig;
  ranked: RankedRow;
  onEdit: () => void;
  onRemove: () => void;
  /** A legacy row's choice (LegacyChoice): write its own values through to the item. */
  onUseRow: (values: Values) => void;
  /** …or take the item's values into the row's own copy. */
  onKeepItem: () => void;
  /** The Edit button, where focus comes back to after the editor closes. */
  editRef?: (el: HTMLElement | null) => void;
}) {
  const m = methodById(config.methodId);
  const { row, result } = ranked;
  const RowValues = config.RowValues;
  const scored = config.rowScore !== false;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {scored && (
        <span
          className="w-6 shrink-0 font-mono text-xs text-sub"
          aria-label={ranked.rank === null ? "Not ranked" : `Rank ${ranked.rank}`}
        >
          {ranked.rank ?? "—"}
        </span>
      )}
      <span className="inline-flex min-w-0 flex-1 basis-48 flex-wrap items-center gap-2 text-sm text-text">
        <span className="break-words">{row.title}</span>
        <BacklogRowLink row={row} />
      </span>
      {RowValues ? <RowValues ranked={ranked} /> : <DefaultRowValues method={m} ranked={ranked} />}
      {scored && (
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
      )}
      <span className="flex shrink-0 items-center">
        <IconButton
          ref={editRef}
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
      {ranked.live && (
        <LegacyChoice method={m} row={row} onUseRow={onUseRow} onKeepItem={onKeepItem} />
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

/**
 * The JSON export: each row as the tool shows it. A linked row of a method
 * the backlog holds reads through to its item, and hub or agent edits are
 * never copied back to the row, so the stored fields and score can be
 * stale: the export writes the shown inputs over them and recomputes the
 * score cache, as the screen, the CSV and the Markdown read.
 */
export function exportRows(
  m: PrioritizationMethod,
  ranked: readonly RankedRow[]
): PrioritizationItem[] {
  return ranked.map((r) => {
    const cache = scoreCache(r.result, r.row.status);
    const out: PrioritizationItem = {
      ...r.row,
      fields: m.write(r.row.fields, r.values),
      status: cache.status,
    };
    if (cache.score === undefined) delete out.score;
    else out.score = cache.score;
    return out;
  });
}

/* ── The tool ──────────────────────────────────────────────────────── */

export function MethodTool({ config }: { config: MethodToolConfig }) {
  const m = methodById(config.methodId);
  const ranked = useMethodRows(config.methodId);
  const actions = useMethodActions(config);
  const announce = useAnnounce();
  const exportRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLLIElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Focus after the editor closes (the row's Edit button) or a delete (a
  // neighbour's, the open editor's title when only its row is left, or the
  // add form's title once the list is empty).
  const { refFor, returnTo } = useReturnFocus();

  // "Import from backlog" (or a "Score with…" link) fills the add form; an
  // item this method already scored opens its row instead of a second one,
  // and says so. It comes before the form: the item it links to decides
  // what the form may keep (formRef reaches the form from the pick).
  const formRef = useRef<ItemFormState<MethodDraft, string> | null>(null);
  const backlog = useBacklogImport(
    m.id,
    (picked) =>
      formRef.current?.reset({
        ...(m.fromBacklog ? definedValues(m.fromBacklog(picked)) : {}),
        title: picked.name,
      }),
    {
      onEdit: (row) => {
        setEditingId(row.id);
        announce(`Editing “${shortName(row.title)}”: already scored with ${m.label}.`);
      },
    }
  );
  // After the menu closes on such a pick: focus the editor's title (the
  // editor's own focus on mount lost to the menu's focus handling).
  const focusEditor = () => editorRef.current?.querySelector<HTMLElement>("input")?.focus();
  // What the imported item already holds: an off-scale value of it stays
  // valid in the add form ("Custom"), as it would in the row's editor.
  const pending = backlog.pending;
  const held = useMemo(
    () => (pending && m.fromBacklog ? m.fromBacklog(pending) : undefined),
    [pending, m]
  );
  const form = useItemForm<MethodDraft, MethodDraft, string>({
    // Called again on every reset, so a remembered input follows the last add.
    initial: () => {
      const s = useWorkspaceStore.getState();
      return startDraft(m, config, s.prioritizations ?? NO_ROWS, s.backlogItems ?? NO_ITEMS);
    },
    validate: (d) => checkDraft(config, m, d, { keep: held }),
    onSave: (values) => {
      actions.add(withClears(m, values), backlog.pending?.id);
      backlog.clear();
    },
  });
  formRef.current = form;

  // The order on screen holds while a row is being edited; "Re-sort"
  // catches up. Rows with no score (rowScore: false) have no order to
  // hold: they list as ranked, and nothing goes stale.
  const position = new Map(ranked.map((r, i) => [r.row.id, i]));
  const stable = useStableOrder(
    ranked,
    (r) => r.row.id,
    (a, b) => (position.get(a.row.id) ?? 0) - (position.get(b.row.id) ?? 0)
  );
  const holdsOrder = config.rowScore !== false;
  const ordered = holdsOrder ? stable.ordered : ranked;
  const isStale = holdsOrder && stable.isStale;
  const grouped = config.groups?.(ordered);
  // The rows in the order on screen, group by group.
  const shown = grouped ? grouped.flatMap((g) => g.rows) : ordered;

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

  /** The group a row is listed under (from a list of rows as ranked). */
  const groupOf = (id: string, list: readonly RankedRow[]) =>
    config.groups?.(list).find((g) => g.rows.some((x) => x.row.id === id));

  // Save or Cancel: focus goes back to the row's Edit button. A save that
  // puts the row in another group (a bucket, a lane) moves it on screen,
  // which says so.
  const saveEdit = (r: RankedRow, draft: MethodDraft) => {
    const before = groupOf(r.row.id, ordered);
    setEditingId(null);
    returnTo(`edit:${r.row.id}`);
    actions.save(r.row.id, draft);
    if (!before) return;
    const s = useWorkspaceStore.getState();
    const now = rankMethodRows(m.id, s.prioritizations ?? NO_ROWS, s.backlogItems ?? NO_ITEMS);
    const after = groupOf(r.row.id, now);
    if (after && after.id !== before.id) {
      announce(`Moved “${shortName(draft.title)}” to ${after.label}.`);
    }
  };
  const cancelEdit = (r: RankedRow) => {
    setEditingId(null);
    returnTo(`edit:${r.row.id}`);
  };
  // Delete: focus moves to the next row's Edit button, else the one
  // before, else the open editor's title (the one row left is being
  // edited), else (the list is empty now) the add form's title.
  const removeRow = (r: RankedRow) => {
    // (Not the row in the editor: its Edit button isn't on screen.)
    const others = shown.filter((x) => x.row.id !== editingId);
    const at = others.findIndex((x) => x.row.id === r.row.id);
    const next = others[at + 1] ?? others[at - 1];
    // (The editor counts while its row is on screen: an agent may have deleted it.)
    const editorOpen = others.length < shown.length;
    returnTo(next ? `edit:${next.row.id}` : editorOpen ? EDITOR_TITLE : ADD_TITLE);
    actions.remove(r.row);
  };

  // A legacy row's choice (LegacyChoice).
  const legacy = useLegacyChoice(m, actions.save, returnTo);

  const renderRow = (r: RankedRow) => (
    <li key={r.row.id} ref={editingId === r.row.id ? editorRef : undefined} className="py-3">
      {editingId === r.row.id ? (
        <MethodRowEditor
          config={config}
          ranked={r}
          onSave={(draft) => saveEdit(r, draft)}
          onCancel={() => cancelEdit(r)}
          titleRef={refFor(EDITOR_TITLE)}
        />
      ) : (
        <MethodRow
          config={config}
          ranked={r}
          onEdit={() => setEditingId(r.row.id)}
          onRemove={() => removeRow(r)}
          onUseRow={(values) => legacy.takeRow(r, values)}
          onKeepItem={() => legacy.keepItem(r)}
          editRef={refFor(`edit:${r.row.id}`)}
        />
      )}
    </li>
  );

  const BeforeList = config.BeforeList;
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
            footer={<ImportFromBacklog link={backlog} onRoutedToEdit={focusEditor} />}
          >
            <DraftFields
              config={config}
              form={form}
              custom={held ? customOf(m, held) : undefined}
              size="md"
              item={pending ?? undefined}
              titleRef={refFor(ADD_TITLE)}
            />
          </ItemForm>
        </SectionCard>

        {BeforeList && ranked.length > 0 && <BeforeList rows={ranked} />}

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
                  jsonData={exportRows(m, ranked)}
                  markdown={config.toMarkdown?.(ranked)}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <p className="mb-3 text-sm font-medium text-text">
              {(config.verdict ?? ((x) => defaultVerdict(m, x)))(ranked)}
            </p>
            <ResortChip isStale={isStale} onResort={stable.resort} />
            {grouped ? (
              grouped.map((g) => (
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
