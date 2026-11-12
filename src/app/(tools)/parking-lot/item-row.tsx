"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Check, CircleSlash, Pencil, RotateCcw, Send, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import { cn } from "@/lib/utils";
import { getHandoffRoute, liveLink } from "@/lib/handoffs/registry";
import { TOOL_TEXT_MAX, type HandoffLink, type ParkingLotItem } from "@/lib/stores/workspace-types";
import {
  PARKING_ROUTES,
  ROUTE_PLACE,
  STATUS_LABEL,
  isParkingRoute,
  parkedWhen,
  validateParkingDraft,
  type ParkingDraft,
  type ParkingField,
  type ParkingRoute,
  type ParkingValues,
} from "@/lib/parking-lot/model";

/** The menu's names for the routes. */
export const ROUTE_MENU_LABEL: Readonly<Record<ParkingRoute, string>> = {
  "backlog-story": "Backlog story",
  impediment: "Impediment",
  "retro-action": "Retro action",
};

const STATUS_TONE: Record<ParkingLotItem["status"], string> = {
  open: "border-accent/40 text-text",
  discussed: "border-border text-sub",
  sent: "border-success/40 text-success",
  dropped: "border-border text-sub",
};

/** A point's words, short enough for a button's name. */
export function shortText(text: string, max = 40): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Where a point went, one line per route: a link to it while it lives there. */
export function SentLinks({ links }: { links: readonly HandoffLink[] | undefined }) {
  const sent = (links ?? []).filter((l) => isParkingRoute(l.route));
  if (sent.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-sub">
      {sent.map((link) => {
        const route = getHandoffRoute(link.route);
        const live = route.exists(link.targetId);
        const done = live && route.isDone?.(link.targetId);
        const place = ROUTE_PLACE[link.route as ParkingRoute];
        return (
          <li key={`${link.route}:${link.targetId}`}>
            {live ? (
              <>
                Sent to {place}
                {done ? " (done there)" : ""} ·{" "}
                <Link
                  href={route.targetHref(link.targetId)}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  Open
                </Link>
              </>
            ) : (
              <>Sent to {place}, since removed there</>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** "Send to…": the three routes, each a link to the item once it was sent there. */
export function SendMenu({
  item,
  disabledReason,
  onSend,
}: {
  item: ParkingLotItem;
  /** Why this point can't be sent (an example point), or null. */
  disabledReason: string | null;
  onSend: (item: ParkingLotItem, route: ParkingRoute) => void;
}) {
  const sent = (item.sentTo ?? []).some((l) => liveLink(item.sentTo, l.route));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={Boolean(disabledReason)}
          title={disabledReason ?? undefined}
          // Rows repeat this button: its name says which point, after the visible text.
          aria-label={`Send to… ${shortText(item.text)}${sent ? " (sent)" : ""}`}
          className="gap-1.5 text-sub hover:text-accent"
        >
          {sent ? (
            <Check className="text-success" aria-hidden="true" />
          ) : (
            <Send aria-hidden="true" />
          )}
          Send to…
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-xs font-medium text-sub">Send to</DropdownMenuLabel>
        {PARKING_ROUTES.map((routeId) => {
          const route = getHandoffRoute(routeId);
          const link = liveLink(item.sentTo, routeId);
          if (link) {
            return (
              <DropdownMenuItem key={routeId} asChild>
                <Link href={route.targetHref(link.targetId)}>
                  <span className="flex-1">{ROUTE_MENU_LABEL[routeId]}</span>
                  <span className="text-xs text-success">Sent · Open</span>
                </Link>
              </DropdownMenuItem>
            );
          }
          return (
            <DropdownMenuItem key={routeId} onSelect={() => onSend(item, routeId)}>
              {ROUTE_MENU_LABEL[routeId]}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The point's edit form, in place of its text: the same checks as parking it. */
function EditForm({
  item,
  onSave,
  onCancel,
  offerAddToRoster,
}: {
  item: ParkingLotItem;
  onSave: (values: ParkingValues) => void;
  onCancel: () => void;
  offerAddToRoster: boolean;
}) {
  const form = useItemForm<ParkingDraft, ParkingValues, ParkingField>({
    initial: () => ({
      text: item.text,
      meeting: item.meeting ?? "",
      raisedBy: item.raisedBy ?? "",
    }),
    validate: validateParkingDraft,
    onSave,
    resetOnSave: false,
  });
  const { draft, update, errors } = form;
  // The form opens on a click of Edit: start where the words are.
  const textRef = useRef<HTMLInputElement>(null);
  useEffect(() => textRef.current?.focus(), []);
  return (
    <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
      <Field label="Point" error={errors.text} required>
        {(props) => (
          <Input
            {...props}
            ref={textRef}
            value={draft.text}
            maxLength={TOOL_TEXT_MAX.text}
            autoComplete="off"
            onChange={(e) => update({ text: e.target.value })}
          />
        )}
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Meeting" error={errors.meeting}>
          {(props) => (
            <Input
              {...props}
              value={draft.meeting}
              maxLength={TOOL_TEXT_MAX.short}
              autoComplete="off"
              onChange={(e) => update({ meeting: e.target.value })}
            />
          )}
        </Field>
        <PersonPicker
          label="Raised by"
          value={draft.raisedBy}
          onChange={(raisedBy) => update({ raisedBy })}
          error={errors.raisedBy}
          offerAddToRoster={offerAddToRoster}
        />
      </div>
    </ItemForm>
  );
}

export interface ParkingRowProps {
  item: ParkingLotItem;
  now: Date;
  editing: boolean;
  /** Why it can't be sent (an example point), or null. */
  sendBlocked: string | null;
  offerAddToRoster: boolean;
  onDiscussed: (item: ParkingLotItem) => void;
  onDrop: (item: ParkingLotItem) => void;
  onReopen: (item: ParkingLotItem) => void;
  onSend: (item: ParkingLotItem, route: ParkingRoute) => void;
  onEdit: (item: ParkingLotItem | null) => void;
  onSave: (item: ParkingLotItem, values: ParkingValues) => void;
  onDelete: (item: ParkingLotItem) => void;
}

/**
 * One parked point: its words and status, where and by whom it was raised,
 * where it was sent, and what can be done with it. An open point can be
 * marked discussed, sent on or dropped; a discussed or dropped one opened
 * again. Every row can be edited in place or deleted (with Undo).
 */
export function ParkingRow({
  item,
  now,
  editing,
  sendBlocked,
  offerAddToRoster,
  onDiscussed,
  onDrop,
  onReopen,
  onSend,
  onEdit,
  onSave,
  onDelete,
}: ParkingRowProps) {
  const name = shortText(item.text);
  const meta = [
    item.meeting,
    item.raisedBy ? `raised by ${item.raisedBy}` : null,
    parkedWhen(item, now),
  ].filter(Boolean);
  return (
    <li id={`parking-${item.id}`} className="rounded-lg border border-border bg-card p-3">
      {editing ? (
        <EditForm
          item={item}
          offerAddToRoster={offerAddToRoster}
          onSave={(values) => onSave(item, values)}
          onCancel={() => onEdit(null)}
        />
      ) : (
        <>
          <div className="flex min-w-0 items-start justify-between gap-2">
            <p
              data-parking-text={item.id}
              tabIndex={-1}
              className={cn(
                "min-w-0 break-words rounded-sm text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                item.status === "dropped" && "text-sub line-through"
              )}
            >
              {item.text}
            </p>
            <Badge variant="outline" className={cn("shrink-0", STATUS_TONE[item.status])}>
              {STATUS_LABEL[item.status]}
            </Badge>
          </div>
          {meta.length > 0 && <p className="mt-1 text-xs text-sub">{meta.join(" · ")}</p>}
          <SentLinks links={item.sentTo} />
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {item.status === "open" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                aria-label={`Discussed: ${name}`}
                onClick={() => onDiscussed(item)}
              >
                <Check aria-hidden="true" />
                Discussed
              </Button>
            )}
            <SendMenu item={item} disabledReason={sendBlocked} onSend={onSend} />
            {item.status === "open" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                aria-label={`Drop: ${name}`}
                onClick={() => onDrop(item)}
              >
                <CircleSlash aria-hidden="true" />
                Drop
              </Button>
            )}
            {(item.status === "discussed" || item.status === "dropped") && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                aria-label={`Reopen: ${name}`}
                onClick={() => onReopen(item)}
              >
                <RotateCcw aria-hidden="true" />
                Reopen
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5"
              aria-label={`Edit: ${name}`}
              onClick={() => onEdit(item)}
            >
              <Pencil aria-hidden="true" />
              Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-sub hover:text-danger"
              aria-label={`Delete: ${name}`}
              onClick={() => onDelete(item)}
            >
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
