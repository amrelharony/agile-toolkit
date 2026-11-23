"use client";

import { Columns3 } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/toggle-group";
import {
  BUCKET_SET_LABEL,
  bucketsFor,
  bucketsProblem,
  splitLabels,
  type NewItem,
} from "@/lib/relative-sizing/model";
import {
  BUCKET_SETS,
  SIZING_ITEMS_MAX,
  SIZING_LIMITS,
  type BucketSet,
  type SizingBucket,
} from "@/lib/relative-sizing/state";
import type { Validation } from "@/lib/utils/form";
import { leftOutMessage, pastedLines } from "@/lib/utils/paste-lines";

export type BoardSource = "unsized" | "paste";

export interface BoardDraft {
  title: string;
  source: BoardSource;
  pasted: string;
  bucketSet: BucketSet;
  custom: string;
}

export interface BoardValues {
  title: string;
  bucketSet: BucketSet;
  buckets: SizingBucket[];
  items: NewItem[];
  /** Lines past the board's 100 that were left out. */
  dropped: number;
}

type BoardField = "title" | "pasted" | "custom";

const SELECT_CLASS =
  "flex h-11 pointer-fine:md:h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base pointer-fine:md:text-sm text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** A new board: a title, the stories (the unsized backlog or pasted titles) and the buckets. */
export function validateBoardDraft(
  d: BoardDraft,
  unsized: readonly NewItem[]
): Validation<BoardValues, BoardField> {
  const errors: Partial<Record<BoardField, string>> = {};
  const title = d.title.replace(/\s+/g, " ").trim();
  if (!title) errors.title = "Name the board.";
  else if (title.length > SIZING_LIMITS.title) {
    errors.title = `Keep the name to ${SIZING_LIMITS.title} characters.`;
  }
  let items: NewItem[] = [];
  let dropped = 0;
  if (d.source === "unsized") {
    items = unsized.slice(0, SIZING_ITEMS_MAX).map((i) => ({ ...i }));
    if (items.length === 0)
      errors.pasted = "The backlog has no unsized stories: paste titles instead.";
  } else {
    const lines = pastedLines(d.pasted, SIZING_ITEMS_MAX);
    dropped = lines.dropped;
    items = lines.lines.map((t) => ({ title: t.slice(0, SIZING_LIMITS.itemTitle) }));
    if (items.length === 0) errors.pasted = "Paste at least one story title, one per line.";
  }
  const buckets = bucketsFor(d.bucketSet, d.bucketSet === "custom" ? splitLabels(d.custom) : []);
  const problem = bucketsProblem(
    d.bucketSet === "custom" ? splitLabels(d.custom).map((label) => ({ label })) : buckets
  );
  if (problem) errors.custom = problem;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { title, bucketSet: d.bucketSet, buckets, items, dropped } };
}

export function NewBoardForm({
  unsized,
  initialSource,
  onCreate,
  onCancel,
}: {
  unsized: readonly NewItem[];
  initialSource: BoardSource;
  onCreate: (v: BoardValues) => void;
  onCancel?: () => void;
}) {
  const form = useItemForm<BoardDraft, BoardValues, BoardField>({
    initial: () => ({
      title: initialSource === "unsized" ? "Unsized backlog" : "",
      source: initialSource,
      pasted: "",
      bucketSet: "fibonacci",
      custom: "",
    }),
    validate: (d) => validateBoardDraft(d, unsized),
    onSave: onCreate,
  });
  const { draft, update, errors } = form;
  const pasted = draft.source === "paste" ? pastedLines(draft.pasted, SIZING_ITEMS_MAX) : null;
  return (
    <ItemForm
      form={form}
      submitLabel="Start the board"
      submitIcon={<Columns3 className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
    >
      <Field label="Board name" error={errors.title} required>
        {(props) => (
          <Input
            {...props}
            value={draft.title}
            maxLength={SIZING_LIMITS.title}
            autoComplete="off"
            placeholder="e.g. Checkout backlog"
            onChange={(e) => update({ title: e.target.value })}
          />
        )}
      </Field>
      <ToggleGroup<BoardSource>
        label="Stories"
        value={draft.source}
        onValueChange={(source) => update({ source })}
        options={[
          { value: "unsized", label: `Unsized backlog stories (${unsized.length})` },
          { value: "paste", label: "Paste titles" },
        ]}
      />
      {draft.source === "paste" ? (
        <Field
          label="Story titles, one per line"
          error={errors.pasted}
          hint={
            pasted && pasted.dropped > 0
              ? `${leftOutMessage(pasted.dropped)} A board holds ${SIZING_ITEMS_MAX}.`
              : `Up to ${SIZING_ITEMS_MAX}. Add them to the backlog later to save their sizes.`
          }
        >
          {(props) => (
            <Textarea
              {...props}
              rows={5}
              value={draft.pasted}
              onChange={(e) => update({ pasted: e.target.value })}
            />
          )}
        </Field>
      ) : (
        errors.pasted && <p className="text-sm text-danger">{errors.pasted}</p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Buckets">
          {(props) => (
            <select
              {...props}
              className={SELECT_CLASS}
              value={draft.bucketSet}
              onChange={(e) => update({ bucketSet: e.target.value as BucketSet })}
            >
              {BUCKET_SETS.map((s) => (
                <option key={s} value={s}>
                  {BUCKET_SET_LABEL[s]}
                  {s !== "custom"
                    ? `: ${bucketsFor(s)
                        .map((b) => b.label)
                        .join(", ")}`
                    : ""}
                </option>
              ))}
            </select>
          )}
        </Field>
        {draft.bucketSet === "custom" && (
          <Field
            label="Your buckets, smallest first"
            error={errors.custom}
            hint="2 to 11 labels, separated by commas or spaces. Numbers become points; give other labels theirs on the board."
          >
            {(props) => (
              <Input
                {...props}
                value={draft.custom}
                autoComplete="off"
                placeholder="e.g. 1, 2, 4, 8, 16"
                onChange={(e) => update({ custom: e.target.value })}
              />
            )}
          </Field>
        )}
      </div>
      {draft.bucketSet === "tshirt" && (
        <p className="text-xs text-sub">
          T-shirt sizes have no points yet. Give each bucket its points under Map sizes to points,
          on the board, before you save sizes.
        </p>
      )}
      {errors.custom && draft.bucketSet !== "custom" && (
        <p className="text-sm text-danger">{errors.custom}</p>
      )}
    </ItemForm>
  );
}
