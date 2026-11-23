"use client";

/**
 * One item kept from a meeting's notes: its words, owner and due day, the
 * line it came from (until the notes are forgotten), its status, and what
 * can happen next: Send (to the tool its kind goes to), Answered (a
 * question), Drop, or Edit in place (kind, words, owner, due, detail).
 */

import { useEffect, useRef } from "react";
import { Check, Pencil, X } from "lucide-react";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { HandoffLink, HandoffSource } from "@/lib/handoffs/types";
import {
  MEETING_NOTE_ITEM_KINDS,
  TOOL_TEXT_MAX,
  type MeetingNoteItem,
} from "@/lib/stores/workspace-types";
import { KIND_ONE, ROUTE_PLACE, routeOf } from "@/lib/notes-to-actions/model";
import {
  itemDraftFrom,
  validateItem,
  type ItemDraft,
  type ItemField,
  type ItemValues,
} from "./form";

/** Matches <Input>: 44 px / 16 px on touch, 36 px / 14 px for a mouse at md+. */
export const SELECT_CLASS =
  "flex h-11 pointer-fine:md:h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base pointer-fine:md:text-sm text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const STATUS_BADGE: Record<MeetingNoteItem["status"], string> = {
  open: "border-warning/30 bg-warning/10 text-text",
  sent: "border-success/30 bg-success/10 text-success",
  dropped: "border-border bg-bg text-sub",
  answered: "border-info/30 bg-info/10 text-text",
};
const STATUS_TEXT: Record<MeetingNoteItem["status"], string> = {
  open: "Open",
  sent: "Sent",
  dropped: "Dropped",
  answered: "Answered",
};

export interface ItemRowProps {
  item: MeetingNoteItem;
  editing: boolean;
  /** Why it can't be sent (the example), or null. */
  sendBlocked: string | null;
  source: HandoffSource;
  getLinks: () => readonly HandoffLink[] | undefined;
  onLinksChange: (update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => void;
  offerAddToRoster: boolean;
  onEdit: (editing: boolean) => void;
  onSave: (values: ItemValues) => void;
  onDrop: () => void;
  onAnswer: () => void;
  onReopen: () => void;
}

export function ItemRow(props: ItemRowProps) {
  return props.editing ? <ItemEditor {...props} /> : <ItemView {...props} />;
}

function ItemView({
  item,
  sendBlocked,
  source,
  getLinks,
  onLinksChange,
  onEdit,
  onDrop,
  onAnswer,
  onReopen,
}: ItemRowProps) {
  const route = routeOf(item.kind);
  const open = item.status === "open";
  return (
    <li className="space-y-2 rounded-lg border border-border bg-card p-3" data-note-item={item.id}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium text-text" data-item-text={item.id}>
            {item.text}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-sub">
            <Badge variant="outline" className={STATUS_BADGE[item.status]}>
              {STATUS_TEXT[item.status]}
            </Badge>
            {item.owner && <span>Owner: {item.owner}</span>}
            {item.due && <span>Due {item.due}</span>}
          </div>
        </div>
        <IconButton
          label={`Edit ${item.text}`}
          icon={<Pencil className="h-4 w-4" />}
          className="shrink-0 text-sub hover:text-text"
          onClick={() => onEdit(true)}
        />
      </div>
      {item.detail && (
        <p className="whitespace-pre-wrap break-words text-xs text-text">{item.detail}</p>
      )}
      {item.quote && (
        <p className="break-words text-xs text-sub">
          From the notes: <q>{item.quote}</q>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {route && (
          <SendToMenu
            routes={[route]}
            disabled={Boolean(sendBlocked) || item.status === "dropped"}
            item={source}
            sentTo={item.sentTo}
            getLinks={getLinks}
            onLinksChange={onLinksChange}
            itemLabels={{ [route]: `Send to ${ROUTE_PLACE[route]}` }}
            className="h-8"
          />
        )}
        {!route && open && (
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1" onClick={onAnswer}>
            <Check aria-hidden="true" />
            Answered
          </Button>
        )}
        {open && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-sub"
            onClick={onDrop}
            aria-label={`Drop ${item.text}`}
          >
            <X aria-hidden="true" />
            Drop
          </Button>
        )}
        {(item.status === "dropped" || item.status === "answered") && (
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onReopen}>
            Open again
          </Button>
        )}
      </div>
      {route && sendBlocked && <p className="text-xs text-sub">{sendBlocked}</p>}
    </li>
  );
}

function ItemEditor({ item, onSave, onEdit, offerAddToRoster }: ItemRowProps) {
  const form = useItemForm<ItemDraft, ItemValues, ItemField>({
    initial: () => itemDraftFrom(item),
    validate: validateItem,
    onSave: (values) => {
      onSave(values);
      onEdit(false);
    },
    resetOnSave: false,
  });
  const { draft, update, errors, formRef } = form;
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current) return;
    focused.current = true;
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <li className="rounded-lg border border-accent/40 bg-card p-3">
      <ItemForm form={form} submitLabel="Save item" onCancel={() => onEdit(false)}>
        <Field label="What it is" error={errors.text} required>
          {(p) => (
            <Input
              {...p}
              value={draft.text}
              maxLength={TOOL_TEXT_MAX.short}
              onChange={(e) => update({ text: e.target.value })}
            />
          )}
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Kind" error={errors.kind}>
            {(p) => (
              <select
                {...p}
                className={SELECT_CLASS}
                value={draft.kind}
                onChange={(e) => update({ kind: e.target.value as ItemDraft["kind"] })}
              >
                {MEETING_NOTE_ITEM_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_ONE[k]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <PersonPicker
            label="Owner"
            value={draft.owner}
            onChange={(owner) => update({ owner })}
            error={errors.owner}
            offerAddToRoster={offerAddToRoster}
          />
          <Field label="Due" error={errors.due}>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={draft.due}
                onChange={(e) => update({ due: e.target.value })}
              />
            )}
          </Field>
        </div>
        <Field label="Detail" hint="Optional: what someone needs to know." error={errors.detail}>
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={draft.detail}
              maxLength={TOOL_TEXT_MAX.text}
              onChange={(e) => update({ detail: e.target.value })}
            />
          )}
        </Field>
      </ItemForm>
    </li>
  );
}
