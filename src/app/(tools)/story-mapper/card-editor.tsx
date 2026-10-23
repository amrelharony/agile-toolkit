"use client";

import { useEffect } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { ScalePicker, offScale } from "@/components/shared/scale-picker";
import { STORY_TITLE_MAX } from "@/lib/handoffs/targets/backlog-story";
import type { StoryMapCard } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import type { Validation } from "@/lib/utils/form";
import { CARD_COLORS } from "./card-colors";
import { POINT_STEPS, estimateKind, estimatePoints } from "./estimate";

export interface CardDraft {
  title: string;
  description: string;
  color: string;
  /** Points picked on the scale; null when not estimated. */
  points: number | null;
  /** A non-numeric estimate the card already had ("XL", "?"), kept until replaced or cleared. */
  custom: string | null;
  /** The stored estimate, so an untouched "5.0" isn't rewritten as "5". */
  original?: string;
}

export type CardField = "title" | "points";

export interface CardValues {
  title: string;
  description: string;
  color: string;
  /** The estimate to store: a number as a string, a kept custom value, or none. */
  estimate: string | undefined;
}

export function cardDraftFrom(card: StoryMapCard): CardDraft {
  const points = estimatePoints(card.estimate);
  return {
    title: card.title,
    description: card.description ?? "",
    color: card.color,
    points: points ?? null,
    custom: estimateKind(card.estimate) === "custom" ? (card.estimate as string) : null,
    original: card.estimate,
  };
}

/**
 * Check a card draft. A blank title is an error (the old dialog silently
 * ignored Save); points come only from the scale, so anything stored as a
 * number is a number of zero or more.
 */
export function validateCard(d: CardDraft): Validation<CardValues, CardField> {
  const errors: Partial<Record<CardField, string>> = {};
  const title = d.title.trim();
  if (!title) errors.title = "Enter a story title.";
  else if (title.length > STORY_TITLE_MAX)
    errors.title = `Keep the title to ${STORY_TITLE_MAX} characters or fewer.`;
  if (d.points !== null && (!Number.isFinite(d.points) || d.points < 0))
    errors.points = "Points can't be negative.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  let estimate: string | undefined;
  if (d.points !== null) {
    estimate = estimatePoints(d.original) === d.points ? d.original : String(d.points);
  } else {
    estimate = d.custom ?? undefined;
  }
  return {
    ok: true,
    values: { title, description: d.description.trim(), color: d.color, estimate },
  };
}

/** The card with the saved values; the estimate key goes when it's cleared. */
export function withCardValues(card: StoryMapCard, v: CardValues): StoryMapCard {
  const next: StoryMapCard = {
    ...card,
    title: v.title,
    description: v.description,
    color: v.color,
  };
  if (v.estimate === undefined) delete next.estimate;
  else next.estimate = v.estimate;
  return next;
}

export function sameCardValues(card: StoryMapCard, v: CardValues): boolean {
  return (
    card.title === v.title &&
    (card.description ?? "") === v.description &&
    card.color === v.color &&
    card.estimate === v.estimate
  );
}

/**
 * Edit a card where it sits on the board. Enter in the title saves, Escape
 * cancels. Points come from the Fibonacci deck; a custom estimate from
 * Planning Poker ("XL") is kept unless points are picked or it's cleared.
 */
export function CardEditor({
  card,
  onSave,
  onCancel,
}: {
  card: StoryMapCard;
  onSave: (values: CardValues) => void;
  onCancel: () => void;
}) {
  const start = cardDraftFrom(card);
  const form = useItemForm<CardDraft, CardValues, CardField>({
    initial: start,
    validate: validateCard,
    onSave,
    resetOnSave: false,
  });
  const { formRef, draft, update, errors } = form;
  // Open on the title, so the keyboard user lands where they were heading.
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);

  return (
    <ItemForm
      form={form}
      submitLabel="Save"
      onCancel={onCancel}
      className="rounded-md border border-accent/40 bg-surface p-2"
    >
      <Field label="Title" error={errors.title} required>
        {(props) => (
          <Input
            {...props}
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="Story title"
            className="h-8 bg-card text-sm"
          />
        )}
      </Field>
      <Field label="Description">
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            value={draft.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="As a user, I want to…"
            className="resize-none bg-card text-sm"
          />
        )}
      </Field>
      <ScalePicker
        label="Points"
        size="sm"
        // The options wrap at their own width (no fixed grid): a cell is
        // about 124 px at 375 px, too narrow for four even tracks once
        // "13", "21" or a "Custom: 16" option is in the row.
        steps={POINT_STEPS}
        value={draft.points}
        custom={offScale(POINT_STEPS, start.points)}
        onValueChange={(points) => update({ points, custom: null })}
        onClear={() => update({ points: null })}
        hint="Fibonacci, as in Planning Poker. Leave it empty until it's sized."
        error={errors.points}
      />
      {draft.custom !== null && draft.points === null && (
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-sub">
          <span>
            Estimate <span className="font-mono text-text">{draft.custom}</span> is kept (custom,
            not in points).
          </span>
          <button
            type="button"
            onClick={() => update({ custom: null })}
            aria-label={`Clear the custom estimate ${draft.custom}`}
            className="min-touch-coarse rounded underline-offset-2 hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Clear
          </button>
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        {/* The radio group carries the same name; this is the visible label. */}
        <span className="text-sm text-text" aria-hidden="true">
          Colour
        </span>
        <ToggleGroup
          label="Colour"
          size="sm"
          options={CARD_COLORS.map((c) => ({
            value: c.value,
            ariaLabel: c.label,
            label: <span className={cn("h-3.5 w-3.5 rounded-full", c.dot)} aria-hidden="true" />,
          }))}
          value={draft.color}
          onValueChange={(color) => update({ color })}
        />
      </div>
    </ItemForm>
  );
}
