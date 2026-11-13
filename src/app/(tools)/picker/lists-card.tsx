"use client";

/**
 * Saved lists: anything worth spinning that isn't the team (topics, other
 * squads, places). Make one by typing or pasting names, spin it, edit it,
 * delete it with Undo. A list never changes the team on the Team page.
 *
 * Focus follows the work: a form opens on its first field, saving or
 * cancelling returns to the button that opened it, a delete lands on the
 * next list (else New list, else the heading), and "Spin this" goes to the
 * wheel's Spin button.
 */

import { useEffect, useRef, useState } from "react";
import { Disc3, ListPlus, Pencil, Trash2 } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PICKER_LIMITS, type PickerList } from "@/lib/picker/model";
import { byId, focusSoon, spinButton } from "./focus";
import { EMPTY_LIST_DRAFT, validateListDraft, type ListDraft } from "./forms";

export interface ListsCardProps {
  lists: readonly PickerList[];
  /** The list the wheel spins now, if any. */
  activeId: string;
  busy: boolean;
  onSave: (values: { name: string; names: string[] }, editingId?: string) => void;
  onUse: (id: string) => void;
  onDelete: (list: PickerList) => void;
}

const HEADING_ID = "picker-lists-heading";
const NEW_LIST_ID = "picker-new-list";
const editId = (listId: string) => `picker-edit-${listId}`;

export function ListsCard({ lists, activeId, busy, onSave, onUse, onDelete }: ListsCardProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const full = lists.length >= PICKER_LIMITS.maxLists;
  const backToNew = () => focusSoon(byId(NEW_LIST_ID), byId(HEADING_ID));
  const backToRow = (id: string) => focusSoon(byId(editId(id)), byId(HEADING_ID));

  const remove = (list: PickerList) => {
    const at = lists.findIndex((l) => l.id === list.id);
    const neighbour = lists[at + 1] ?? lists[at - 1];
    onDelete(list);
    focusSoon(
      ...(neighbour ? [byId(editId(neighbour.id))] : []),
      byId(NEW_LIST_ID),
      byId(HEADING_ID)
    );
  };

  return (
    <section
      aria-labelledby={HEADING_ID}
      className="space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={HEADING_ID} tabIndex={-1} className="text-base font-semibold text-text">
          Your lists
        </h2>
        {!adding && (
          <Button
            id={NEW_LIST_ID}
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={full}
            onClick={() => {
              setEditing(null);
              setAdding(true);
            }}
          >
            <ListPlus aria-hidden="true" />
            New list
          </Button>
        )}
      </div>
      {full && (
        <p className="text-xs text-sub">
          The Picker keeps up to {PICKER_LIMITS.maxLists} lists. Delete one to make another.
        </p>
      )}

      {adding && (
        <ListForm
          lists={lists}
          submitLabel="Save list"
          onCancel={() => {
            setAdding(false);
            backToNew();
          }}
          onSave={(values) => {
            onSave(values);
            setAdding(false);
            backToNew();
          }}
        />
      )}

      {lists.length === 0 && !adding ? (
        <p className="text-sm text-sub">
          No lists yet. A list can hold any names: retro topics, other squads, places for the team
          lunch.
        </p>
      ) : (
        <ul className="divide-y divide-rule">
          {lists.map((list) =>
            editing === list.id ? (
              <li key={list.id} className="py-2">
                <ListForm
                  lists={lists}
                  editing={list}
                  submitLabel="Save changes"
                  onCancel={() => {
                    setEditing(null);
                    backToRow(list.id);
                  }}
                  onSave={(values) => {
                    onSave(values, list.id);
                    setEditing(null);
                    backToRow(list.id);
                  }}
                />
              </li>
            ) : (
              <li key={list.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">
                    {list.name}
                    {list.id === activeId && (
                      <span className="ml-2 text-xs text-sub">(on the wheel)</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-sub">
                    {list.entries.length} {list.entries.length === 1 ? "name" : "names"}:{" "}
                    {list.entries.map((e) => e.name).join(", ")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {list.id !== activeId && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="gap-1.5"
                      disabled={busy}
                      onClick={() => {
                        onUse(list.id);
                        // This button goes once the list is on the wheel.
                        focusSoon(spinButton, byId(editId(list.id)));
                      }}
                    >
                      <Disc3 aria-hidden="true" />
                      Spin this
                    </Button>
                  )}
                  <Button
                    id={editId(list.id)}
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Edit ${list.name}`}
                    disabled={busy}
                    onClick={() => {
                      setAdding(false);
                      setEditing(list.id);
                    }}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="danger-ghost"
                    aria-label={`Delete ${list.name}`}
                    disabled={busy}
                    onClick={() => remove(list)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </li>
            )
          )}
        </ul>
      )}
    </section>
  );
}

function ListForm({
  lists,
  editing,
  submitLabel,
  onSave,
  onCancel,
}: {
  lists: readonly PickerList[];
  editing?: PickerList;
  submitLabel: string;
  onSave: (values: { name: string; names: string[] }) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<ListDraft, { name: string; names: string[] }, "name" | "names">({
    initial: editing
      ? { name: editing.name, names: editing.entries.map((e) => e.name).join("\n") }
      : EMPTY_LIST_DRAFT,
    validate: (d) => validateListDraft(d, lists, editing?.id),
    onSave: (values) => onSave(values),
  });
  // Opening the form starts on its first field.
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  const count = form.draft.names.split(/\r?\n/).filter((l) => l.trim()).length;
  return (
    <ItemForm form={form} submitLabel={submitLabel} onCancel={onCancel}>
      <Field label="List name" error={form.errors.name} required>
        {(p) => (
          <Input
            {...p}
            ref={nameRef}
            value={form.draft.name}
            maxLength={PICKER_LIMITS.maxListNameChars + 20}
            placeholder="Retro topics"
            onChange={(e) => form.update({ name: e.target.value })}
          />
        )}
      </Field>
      <Field
        label="Names"
        hint={`One per line, or separated by commas. Up to ${PICKER_LIMITS.maxNames}.${
          count > 0 ? ` ${count} so far.` : ""
        }`}
        error={form.errors.names}
        required
      >
        {(p) => (
          <Textarea
            {...p}
            rows={6}
            value={form.draft.names}
            placeholder={"Sam\nAlex\nJordan"}
            onChange={(e) => form.update({ names: e.target.value })}
          />
        )}
      </Field>
    </ItemForm>
  );
}
