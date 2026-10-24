"use client";

/**
 * Tab 3 — Showcase Checklist. What to have ready before the stakeholders
 * arrive: a progress bar, items ticked and renamed in place, deleted with
 * Undo. A new review starts with no checklist (an empty review must stay
 * empty for the cockpit); the standard one is a click away.
 */

import { useRef, useState } from "react";
import { CheckCircle2, CheckSquare, ListChecks, Plus, Trash2 } from "lucide-react";
import { BlurInput } from "@/components/shared/blur-fields";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { Validation } from "@/lib/utils/form";
import { removeWithUndo } from "@/lib/utils/undoable";
import { STANDARD_CHECKLIST } from "../constants";
import { shortName, standardChecklist } from "../doc";
import { byData, focusSoon } from "../focus";
import type { ChecklistItem, ReviewSource } from "../types";

interface CheckDraft {
  label: string;
}

export function validateCheck(d: CheckDraft): Validation<CheckDraft, "label"> {
  const label = d.label.trim();
  return label
    ? { ok: true, values: { label } }
    : { ok: false, errors: { label: "Name the item." } };
}

export function ShowcaseChecklistTab({ source }: { source: ReviewSource }) {
  const { doc, writer } = source;
  const items = doc.checklistItems;
  const checked = items.filter((c) => c.checked).length;
  const progress = items.length > 0 ? Math.round((checked / items.length) * 100) : 0;
  const addRef = useRef<HTMLDivElement>(null);

  const updateItems = (fn: (list: readonly ChecklistItem[]) => ChecklistItem[]) =>
    writer.update((d) => ({ ...d, checklistItems: fn(d.checklistItems) }));

  const form = useItemForm<CheckDraft, CheckDraft, "label">({
    initial: { label: "" },
    validate: validateCheck,
    onSave: ({ label }) =>
      updateItems((list) => [...list, { id: crypto.randomUUID(), label, checked: false }]),
  });

  const toggle = (id: string) =>
    updateItems((list) => list.map((c) => (c.id === id ? { ...c, checked: !c.checked } : c)));
  const rename = (id: string, label: string) =>
    updateItems((list) => list.map((c) => (c.id === id ? { ...c, label } : c)));

  function remove(item: ChecklistItem, index: number) {
    // Focus moves on to the next item (else the previous one), or to the
    // new-item field once the checklist is empty.
    const neighbour = items[index + 1] ?? items[index - 1];
    removeWithUndo<ChecklistItem>({
      label: `Deleted “${shortName(item.label || "Untitled item")}”`,
      update: updateItems,
      match: (c) => c.id === item.id,
    });
    focusSoon(() =>
      neighbour
        ? byData("check-toggle", neighbour.id)
        : addRef.current?.querySelector<HTMLElement>("input")
    );
  }

  // The button gives way to the list: focus its first item.
  function addStandard() {
    updateItems(() => standardChecklist(STANDARD_CHECKLIST));
    focusSoon(() => document.querySelector<HTMLElement>("[data-check-toggle]"));
  }

  return (
    <div className="space-y-6">
      <SectionCard
        title="Showcase checklist"
        icon={CheckSquare}
        actions={
          items.length > 0 ? (
            <>
              <span className="font-data text-sm text-sub">
                {checked}/{items.length}
              </span>
              {progress === 100 && (
                <CheckCircle2 className="h-4 w-4 text-accent-green" aria-label="All ready" />
              )}
            </>
          ) : undefined
        }
        contentClassName="space-y-4"
      >
        {items.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 basis-56 text-sm text-sub">
              No checklist yet. Start from the standard one (environment, demo data, invites and
              five more), or add your own items below.
            </p>
            <Button type="button" size="sm" variant="outline" onClick={addStandard}>
              <ListChecks aria-hidden="true" />
              Use the standard checklist
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-sub">
                <span>Ready</span>
                <span className="font-data">{progress}%</span>
              </div>
              <Progress value={progress} className="h-2 bg-card" aria-label="Checklist ready" />
            </div>
            <ul className="space-y-2" aria-label="Showcase checklist">
              {items.map((item, i) => (
                <ChecklistRow
                  key={item.id}
                  item={item}
                  onToggle={() => toggle(item.id)}
                  onRename={(label) => rename(item.id, label)}
                  onRemove={() => remove(item, i)}
                />
              ))}
            </ul>
          </>
        )}

        <div ref={addRef} className="border-t border-border pt-4">
          <ItemForm
            form={form}
            submitLabel="Add"
            submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
          >
            <Field label="New checklist item" error={form.errors.label}>
              {(props) => (
                <Input
                  {...props}
                  value={form.draft.label}
                  onChange={(e) => form.update({ label: e.target.value })}
                  placeholder="e.g. Feature flag on in staging"
                />
              )}
            </Field>
          </ItemForm>
        </div>
      </SectionCard>
    </div>
  );
}

function ChecklistRow({
  item,
  onToggle,
  onRename,
  onRemove,
}: {
  item: ChecklistItem;
  onToggle: () => void;
  onRename: (label: string) => void;
  onRemove: () => void;
}) {
  // Clearing the name doesn't save a blank item: the field goes back to the
  // stored name (remounting drops the blank draft).
  const [revision, setRevision] = useState(0);
  const name = item.label.trim() || "Untitled item";
  return (
    <li className="group flex items-center gap-3 rounded-lg border border-border bg-surface-deep/40 p-3 transition-colors hover:bg-surface-deep/70">
      <button
        type="button"
        role="checkbox"
        aria-checked={item.checked}
        aria-label={name}
        data-check-toggle={item.id}
        onClick={onToggle}
        className={cn(
          "h-5 w-5 flex-shrink-0 rounded border text-primary-foreground transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          item.checked ? "border-accent bg-accent" : "border-border hover:border-accent/50"
        )}
      >
        {item.checked && (
          <svg viewBox="0 0 20 20" fill="none" className="h-full w-full" aria-hidden="true">
            <path
              d="M5 10l4 4 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      <BlurInput
        key={revision}
        value={item.label}
        onCommit={(v) => {
          if (v.trim()) onRename(v.trim());
          else setRevision((r) => r + 1);
        }}
        aria-label={`Rename checklist item: ${name}`}
        // Borderless, but it shows focus: a keyboard user tabbing on from
        // the checkbox must see they're in an editable field.
        className={cn(
          "h-auto min-w-0 flex-1 rounded-sm border-none bg-transparent p-0 text-sm focus-visible:ring-2 focus-visible:ring-accent",
          item.checked ? "text-sub line-through" : "text-text"
        )}
      />
      <IconButton
        label={`Delete checklist item: ${name}`}
        icon={<Trash2 className="h-3.5 w-3.5" />}
        className="h-7 w-7 text-sub opacity-0 transition-opacity hover:text-danger group-focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
        onClick={onRemove}
      />
    </li>
  );
}
