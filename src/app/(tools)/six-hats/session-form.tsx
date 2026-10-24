"use client";

import { useEffect, useRef } from "react";
import { ArrowDown, ArrowUp, Play, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import type { SixHatsHat, SixHatsSession } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import { HATS, hatInfo, hatName } from "./hats";
import {
  DEFAULT_ORDER,
  ORDER_MAX,
  TOPIC_MAX,
  emptySessionDraft,
  moveHat,
  removeHatAt,
  sameRoundIn,
  sessionDraftFrom,
  validateSession,
  wornAfterMove,
  wornAfterRemove,
  type SessionDraft,
  type SessionField,
  type SessionValues,
  type WornRound,
} from "./session";

const sameOrder = (a: readonly SixHatsHat[], b: readonly SixHatsHat[]) =>
  a.length === b.length && a.every((h, i) => h === b[i]);

/**
 * Start a session, or edit one in place. Nothing is saved until the topic
 * and the minutes per round are filled in; the order starts as the common
 * one and can be changed hat by hat.
 */
export function SessionForm({
  session,
  autoFocus = false,
  onSave,
  onCancel,
}: {
  /** The session to edit; absent for a new one. */
  session?: SixHatsSession;
  /** Opened by a click (New session, Edit): focus the topic. Not on page load. */
  autoFocus?: boolean;
  onSave: (values: SessionValues) => void;
  onCancel?: () => void;
}) {
  const form = useItemForm<SessionDraft, SessionValues, SessionField>({
    initial: () => (session ? sessionDraftFrom(session) : emptySessionDraft()),
    validate: validateSession,
    onSave,
    resetOnSave: !session,
  });
  const { draft, update, errors, formRef } = form;

  // Open on the topic, so the keyboard user lands where they were heading.
  useEffect(() => {
    if (autoFocus) formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [autoFocus, formRef]);

  return (
    <ItemForm
      form={form}
      submitLabel={session ? "Save" : "Start session"}
      submitIcon={session ? undefined : <Play className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
    >
      <Field
        label="Topic"
        error={errors.topic}
        required
        hint="The question or proposal to think through."
      >
        {(props) => (
          <Input
            {...props}
            data-focus="session-topic"
            value={draft.topic}
            maxLength={TOPIC_MAX}
            onChange={(e) => update({ topic: e.target.value })}
            placeholder="e.g. Should we move to weekly releases?"
          />
        )}
      </Field>
      <HatOrderEditor
        order={draft.order}
        worn={draft.worn}
        error={errors.order}
        onChange={(order, worn) => update({ order, worn })}
      />
      <Field
        label="Minutes per round"
        error={errors.minutes}
        required
        hint="Most teams give each hat 3 to 5 minutes. A Red-hat round needs about half."
        className="max-w-xs"
      >
        {(props) => (
          <Input
            {...props}
            type="number"
            inputMode="decimal"
            min={1}
            max={30}
            step="any"
            value={draft.minutes}
            onChange={(e) => update({ minutes: e.target.value })}
          />
        )}
      </Field>
    </ItemForm>
  );
}

/** A control to focus after an order change: in a row (by index), or anywhere in the editor (-1). */
type FocusTry = [row: number, selector: string];

/**
 * The hats in the order they'll be worn: move each up or down, remove it,
 * or add one. The order always keeps at least one hat, so it can't be
 * emptied by accident. Mid-round it marks the round being worn and follows
 * it through the edits (`worn`).
 */
function HatOrderEditor({
  order,
  worn,
  error,
  onChange,
}: {
  order: SixHatsHat[];
  worn?: WornRound;
  error?: string;
  onChange: (order: SixHatsHat[], worn: WornRound | undefined) => void;
}) {
  const full = order.length >= ORDER_MAX;
  const groupRef = useRef<HTMLFieldSetElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  // Rows are keyed by position, so after a change the button just used can
  // be another hat's, or gone (the last row removed, "Use the common order"
  // once used, Add at the limit): focus goes to the first of these controls
  // still there, never to the page body.
  const follow = useRef<FocusTry[] | null>(null);
  useEffect(() => {
    const tries = follow.current;
    if (!tries) return;
    follow.current = null;
    for (const [row, selector] of tries) {
      const scope = row < 0 ? groupRef.current : listRef.current?.children[row];
      const el = scope?.querySelector<HTMLButtonElement>(`${selector}:not(:disabled)`);
      if (el) {
        el.focus();
        return;
      }
    }
  });
  const move = (i: number, by: -1 | 1) => {
    const [dir, other] = by < 0 ? ["earlier", "later"] : ["later", "earlier"];
    follow.current = [
      [i + by, `[data-move="${dir}"]`],
      [i + by, `[data-move="${other}"]`],
    ];
    onChange(moveHat(order, i, by), wornAfterMove(worn, i, by, order.length));
  };
  const remove = (i: number) => {
    follow.current = [
      [i, "[data-remove]"],
      [i - 1, "[data-remove]"],
      [-1, "[data-add]"],
    ];
    onChange(removeHatAt(order, i), wornAfterRemove(worn, i));
  };
  const add = (hat: SixHatsHat) => {
    follow.current = [
      [-1, `[data-add="${hat}"]`],
      [order.length, "[data-remove]"],
    ];
    onChange([...order, hat], worn);
  };
  const toCommon = () => {
    follow.current = [[-1, "[data-add]"]];
    const at = worn?.at ?? null;
    onChange(
      [...DEFAULT_ORDER],
      worn && { ...worn, at: at === null ? null : sameRoundIn(order, at, DEFAULT_ORDER) }
    );
  };
  return (
    <fieldset ref={groupRef} className="space-y-2">
      <legend className="text-sm text-text">Order of the hats</legend>
      <p className="text-xs text-sub">
        Blue opens and closes. Keep Black after Yellow and Green, so new ideas don’t die early.
      </p>
      {worn?.at === null && (
        <p className="text-xs text-warning">
          The round being worn is removed: saving moves the session on to the round now in its
          place.
        </p>
      )}
      <ol ref={listRef} className="space-y-1" aria-label="Order of the hats">
        {order.map((hat, i) => {
          const info = hatInfo(hat);
          const place = `${hatName(hat)}, round ${i + 1}`;
          return (
            <li
              key={i}
              className="flex items-center gap-2 rounded border border-border bg-surface-deep px-2 py-1"
            >
              <span className="w-5 shrink-0 text-right font-mono text-xs text-sub">{i + 1}</span>
              <span
                className={cn("h-3 w-3 shrink-0 rounded-full", info.swatch)}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className={cn("font-medium", info.text)}>{info.name}</span>
                <span className="text-sub"> · {info.focus}</span>
              </span>
              {worn?.at === i && (
                <span className="shrink-0 text-xs font-medium text-accent">being worn</span>
              )}
              <IconButton
                label={`Move ${place} earlier`}
                icon={<ArrowUp className="h-4 w-4" />}
                className="text-sub hover:text-text"
                data-move="earlier"
                disabled={i === 0}
                onClick={() => move(i, -1)}
              />
              <IconButton
                label={`Move ${place} later`}
                icon={<ArrowDown className="h-4 w-4" />}
                className="text-sub hover:text-text"
                data-move="later"
                disabled={i === order.length - 1}
                onClick={() => move(i, 1)}
              />
              <IconButton
                label={
                  order.length === 1
                    ? `Remove ${place} (a session needs at least one hat)`
                    : `Remove ${place}`
                }
                icon={<X className="h-4 w-4" />}
                className="text-sub hover:text-danger"
                data-remove
                disabled={order.length === 1}
                onClick={() => remove(i)}
              />
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Add a hat">
        <span className="text-xs text-sub">Add:</span>
        {HATS.map((h) => (
          <Button
            key={h.id}
            type="button"
            size="sm"
            variant="outline"
            className="min-touch-coarse h-7 gap-1 px-2 text-xs"
            disabled={full}
            data-add={h.id}
            aria-label={`Add ${h.name} hat`}
            onClick={() => add(h.id)}
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            {h.name}
          </Button>
        ))}
        {!sameOrder(order, DEFAULT_ORDER) && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-touch-coarse h-7 gap-1 px-2 text-xs text-sub"
            onClick={toCommon}
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Use the common order
          </Button>
        )}
      </div>
      {full && (
        <p className="text-xs text-sub">That’s the most rounds a session can have ({ORDER_MAX}).</p>
      )}
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
