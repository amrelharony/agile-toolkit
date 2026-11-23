"use client";

/**
 * A Kata's obstacles: add one, pick the one being worked on (picking
 * another moves the old one back to open), clear it, or send it to
 * Impediments when it is outside the team's control. At most one is worked
 * on. Deletes come with Undo, and focus moves to the next row.
 */

import { useEffect, useId, useState } from "react";
import { CheckCircle2, Plus, RotateCcw, Target, Trash2 } from "lucide-react";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type Improvement,
  type ImprovementObstacle,
} from "@/lib/stores/workspace-types";
import { IMPROVE_TOOL, OBSTACLE_REFUSAL_TEXT, OBSTACLE_STATUS_LABEL } from "@/lib/improve/model";
import type { Validation } from "@/lib/utils/form";
import { cn } from "@/lib/utils";
import { FieldLabel, RequiredBlurInput } from "./fields";
import { short, type ItemActions } from "./use-item-actions";

/** A new obstacle's draft checked: what's in the way, within its cap. */
export function validateObstacleDraft(draft: {
  text: string;
}): Validation<{ text: string }, "text"> {
  const text = draft.text.trim();
  if (!text) return { ok: false, errors: { text: "Say what's in the way." } };
  if (text.length > TOOL_TEXT_MAX.text) {
    return { ok: false, errors: { text: `Keep it to ${TOOL_TEXT_MAX.text} characters.` } };
  }
  return { ok: true, values: { text } };
}

function ObstacleRow({
  item,
  obstacle,
  rowId,
  actions,
  onDelete,
}: {
  item: Improvement;
  obstacle: ImprovementObstacle;
  rowId: string;
  actions: ItemActions;
  onDelete: () => void;
}) {
  const working = obstacle.status === "working";
  const cleared = obstacle.status === "cleared";
  const [error, setError] = useState<string | null>(null);
  return (
    <li
      className={cn(
        "space-y-2 rounded-lg border bg-card p-3",
        working ? "border-accent" : "border-border"
      )}
    >
      <div className="min-w-0 space-y-1">
        <FieldLabel htmlFor={`${rowId}-text`}>
          Obstacle · {OBSTACLE_STATUS_LABEL[obstacle.status]}
        </FieldLabel>
        <RequiredBlurInput
          id={`${rowId}-text`}
          value={obstacle.text}
          maxLength={TOOL_TEXT_MAX.text}
          className={cleared ? "text-sub line-through" : undefined}
          aria-describedby={error ? `${rowId}-error` : undefined}
          onBlank={() => setError(OBSTACLE_REFUSAL_TEXT.blank)}
          onCommit={(text) => {
            setError(null);
            actions.patchObstacle(obstacle, { text });
          }}
        />
        {error && (
          <p id={`${rowId}-error`} role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {!cleared && (
          <Button
            type="button"
            size="sm"
            variant={working ? "default" : "outline"}
            aria-pressed={working}
            onClick={() =>
              actions.patchObstacle(obstacle, { status: working ? "open" : "working" })
            }
            className="gap-1.5"
          >
            <Target aria-hidden="true" />
            {working ? "Working on it" : "Work on this"}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => actions.patchObstacle(obstacle, { status: cleared ? "open" : "cleared" })}
          className="gap-1.5"
        >
          {cleared ? <RotateCcw aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
          {cleared ? "Open again" : "Cleared"}
        </Button>
        {!actions.example && !cleared && (
          <SendToMenu
            routes={["impediment"]}
            item={{
              title: obstacle.text,
              description: `In the way of the Improvement Kata “${item.title}”.`,
              sourceRef: { tool: IMPROVE_TOOL, id: obstacle.id, doc: item.id },
            }}
            sentTo={obstacle.sentTo}
            onLinksChange={(update) => actions.obstacleLinks(obstacle.id, update)}
            itemLabels={{ impediment: "Impediment (outside the team's control)" }}
          />
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onDelete}
          aria-label={`Delete obstacle: ${short(obstacle.text)}`}
          className="gap-1.5 text-sub hover:text-danger"
        >
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
      </div>
    </li>
  );
}

export function ObstacleList({ item, actions }: { item: Improvement; actions: ItemActions }) {
  const listId = useId();
  const [addError, setAddError] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const rowId = (id: string) => `${listId}-obstacle-${id}`;
  const full = item.obstacles.length >= TOOL_LIST_MAX.kataObstacles;

  const form = useItemForm({
    initial: { text: "" },
    validate: validateObstacleDraft,
    resetOnSave: false,
    onSave: ({ text }) => {
      const why = actions.addObstacle(text);
      setAddError(why);
      if (!why) form.reset();
    },
  });

  useEffect(() => {
    if (!focusId) return;
    const target =
      focusId === "add"
        ? form.formRef.current?.querySelector<HTMLElement>("input")
        : document.getElementById(focusId);
    target?.focus();
    setFocusId(null);
  }, [focusId, form.formRef]);

  const remove = (o: ImprovementObstacle, at: number) => {
    const next = item.obstacles[at + 1] ?? item.obstacles[at - 1];
    actions.removeObstacle(o);
    setFocusId(next ? `${rowId(next.id)}-text` : "add");
  };

  return (
    <section aria-labelledby={`${listId}-heading`} className="space-y-3">
      <h3 id={`${listId}-heading`} className="sr-only">
        Obstacles
      </h3>
      {item.obstacles.length === 0 ? (
        <p className="text-sm text-sub">
          Nothing in the way yet. Name what stops you reaching the target, then pick the one to work
          on first.
        </p>
      ) : (
        <ul className="space-y-2">
          {item.obstacles.map((o, i) => (
            <ObstacleRow
              key={o.id}
              item={item}
              obstacle={o}
              rowId={rowId(o.id)}
              actions={actions}
              onDelete={() => remove(o, i)}
            />
          ))}
        </ul>
      )}
      {full ? (
        <p className="text-sm text-sub">
          A Kata holds {TOOL_LIST_MAX.kataObstacles} obstacles at most. Clear or remove one first.
        </p>
      ) : (
        <ItemForm form={form} submitLabel="Add obstacle" submitIcon={<Plus aria-hidden="true" />}>
          <Field label="What's in the way" error={form.errors.text} required>
            {(props) => (
              <Input
                {...props}
                value={form.draft.text}
                maxLength={TOOL_TEXT_MAX.text}
                onChange={(e) => form.update({ text: e.target.value })}
              />
            )}
          </Field>
          {addError && (
            <p role="alert" className="text-xs text-danger">
              {addError}
            </p>
          )}
        </ItemForm>
      )}
    </section>
  );
}
