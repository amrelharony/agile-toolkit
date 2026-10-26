"use client";

import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { BlurInput } from "@/components/shared/blur-fields";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import { PersonPicker } from "@/components/team/person-picker";
import { cn } from "@/lib/utils";
import {
  AGENDA_STATUSES,
  STATUS_LABELS,
  isIsoDay,
  type AgendaItem,
  type AgendaStatus,
} from "./model";

export const STATUS_TONE: Record<AgendaStatus, string> = {
  open: "border-warning/40 bg-warning/5",
  discussed: "border-success/40 bg-success/5",
  action_required: "border-accent/40 bg-accent/5",
  done: "border-border bg-card",
};

/** The longest agenda item. */
export const AGENDA_MAX = 200;

/**
 * The action's owner, picked from the roster. Typing stays in the field;
 * the owner is saved when focus leaves it (not on every keystroke, which
 * wrote the whole 1:1 log to storage per character).
 */
function OwnerField({
  value,
  onCommit,
  offerAddToRoster,
}: {
  value: string;
  onCommit: (owner: string) => void;
  offerAddToRoster: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  // Focus moving between the input and its "Add to the team" button stays
  // inside the fieldset, so it doesn't save half a name.
  return (
    // Blur only saves what was typed; the input inside is the control.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <fieldset
      className="m-0 min-w-0 border-0 p-0"
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        if (draft.trim() !== value.trim()) onCommit(draft.trim());
      }}
    >
      <PersonPicker
        label="Owner"
        hideLabel
        value={draft}
        onChange={setDraft}
        placeholder="Owner"
        offerAddToRoster={offerAddToRoster}
      />
    </fieldset>
  );
}

/**
 * One agenda item of the open 1:1: its status (Open, Discussed, Action,
 * Done — picked, not cycled, so a finished action never jumps back to
 * Open), its text edited in place, an Action's what / who / when, and the
 * day a Done item was done (today by default, backdatable).
 */
export function AgendaItemRow({
  item,
  today,
  offerAddToRoster,
  onStatus,
  onPatch,
  onDelete,
}: {
  item: AgendaItem;
  today: string;
  offerAddToRoster: boolean;
  onStatus: (status: AgendaStatus) => void;
  onPatch: (patch: Partial<AgendaItem>) => void;
  onDelete: () => void;
}) {
  const edit = useInlineEdit();
  const showAction = item.status === "action_required";
  return (
    <li className={cn("rounded-md border p-2 text-xs", STATUS_TONE[item.status])}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 basis-48">
          {edit.editing ? (
            <InlineItemEditor
              label="Edit agenda item"
              title={item.text}
              titleLabel="Agenda item"
              titleMaxLength={AGENDA_MAX}
              onDone={(next, opts) => {
                if (next) onPatch({ text: next.title });
                edit.stop(opts);
              }}
            />
          ) : (
            <button
              ref={edit.triggerRef}
              type="button"
              onClick={edit.start}
              className={cn(
                "group inline-flex max-w-full items-start gap-1 rounded text-left text-sm text-text break-words",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                item.status === "done" && "text-sub line-through decoration-sub/60"
              )}
              aria-label={`Edit agenda item: ${item.text}`}
            >
              <span>{item.text}</span>
              <Pencil
                className="mt-0.5 h-3 w-3 shrink-0 text-sub opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                aria-hidden="true"
              />
            </button>
          )}
        </div>
        <ToggleGroup<AgendaStatus>
          label={`Status of ${item.text}`}
          size="sm"
          value={item.status}
          onValueChange={onStatus}
          options={AGENDA_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
        />
        <IconButton
          label={`Remove agenda item: ${item.text}`}
          icon={<Trash2 className="h-3.5 w-3.5" />}
          className="h-7 w-7 text-sub hover:text-danger"
          onClick={onDelete}
        />
      </div>
      {showAction && (
        <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          <BlurInput
            value={item.action ?? ""}
            onCommit={(v) => onPatch({ action: v.trim() || undefined })}
            placeholder="Action..."
            className="h-8 border-border bg-bg text-xs"
            aria-label="Action"
          />
          <OwnerField
            value={item.owner ?? ""}
            onCommit={(owner) => onPatch({ owner: owner || undefined })}
            offerAddToRoster={offerAddToRoster}
          />
          <Input
            type="date"
            value={item.dueDate ?? ""}
            onChange={(e) => onPatch({ dueDate: e.target.value || undefined })}
            className="h-8 border-border bg-bg text-xs"
            aria-label="Due date"
          />
        </div>
      )}
      {item.status === "done" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sub">
          {item.action && <span className="min-w-0 break-words">→ {item.action}</span>}
          <label className="inline-flex items-center gap-1.5">
            Done on
            <Input
              type="date"
              value={item.doneAt ?? ""}
              max={today}
              onChange={(e) => {
                const day = e.target.value;
                // A day can be backdated, not emptied or moved past today.
                if (isIsoDay(day) && day <= today) onPatch({ doneAt: day });
              }}
              className="h-8 w-auto border-border bg-bg text-xs"
            />
          </label>
        </div>
      )}
    </li>
  );
}
