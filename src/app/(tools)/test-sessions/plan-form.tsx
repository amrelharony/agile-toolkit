"use client";

import { forwardRef, useId, useRef, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import type { AiSource } from "@/lib/ai/task-types";
import {
  CHARTERS_DETAILS_MAX,
  CHARTERS_PAST_MAX,
  CHARTERS_PAST_TEXT_MAX,
  CHARTERS_TARGET_MAX,
  testSessionsChartersTask,
  type ChartersInput,
  type CharterSuggestion,
} from "@/lib/ai/tasks/test-sessions.lite";
import { TOOL_TEXT_MAX, type Story } from "@/lib/stores/workspace-types";
import {
  CHARTER_LABEL,
  EMPTY_CHARTER_DRAFT,
  SESSION_LENGTHS,
  nearestLength,
  validateCharter,
  type CharterDraft,
  type CharterValues,
} from "@/lib/test-sessions/model";
import { SELECT_CLASS } from "./fields";

/** "1 hour", "45 minutes", "1 hour 30 minutes". */
export function lengthText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h === 0 ? "" : h === 1 ? "1 hour" : `${h} hours`;
  const mins = m === 0 ? "" : `${m} minutes`;
  return [hours, mins].filter(Boolean).join(" ") || "0 minutes";
}

/** A story's details for the charter ask: its notes, criteria and Given/When/Then, joined. */
export function storyDetails(story: Story | undefined): string {
  if (!story) return "";
  return [
    story.notes,
    story.acceptanceCriteria,
    ...(story.gwt ?? []).map((g) => `Given ${g.given}, when ${g.when}, then ${g.then}.`),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, CHARTERS_DETAILS_MAX);
}

/**
 * Plan a session: the charter in three parts in our own words ("Look at…",
 * "Using…", "To learn…"), a length, a tester, an optional story from the
 * selected sprint and an area. Amr (or the ten lenses, without AI)
 * suggests charters for what is typed or the story picked; each accepted
 * one becomes a planned session (`onAccept`, with Undo).
 */
export const PlanForm = forwardRef<
  HTMLInputElement,
  {
    stories: readonly Story[];
    areas: readonly string[];
    /** Past charters as sentences, to skip repeats. */
    past: readonly string[];
    onSave: (values: CharterValues) => void;
    onAccept: (charter: CharterSuggestion, draft: CharterDraft) => void;
    offerAddToRoster?: boolean;
  }
>(function PlanForm({ stories, areas, past, onSave, onAccept, offerAddToRoster = true }, ref) {
  const form = useItemForm<CharterDraft, CharterValues, keyof CharterDraft>({
    initial: EMPTY_CHARTER_DRAFT,
    validate: validateCharter,
    onSave,
  });
  const { draft, update, errors } = form;
  const areasId = useId();
  const askRef = useRef<HTMLDivElement>(null);
  const [ideas, setIdeas] = useState<{ items: CharterSuggestion[]; source: AiSource } | null>(null);
  const story = stories.find((s) => s.id === draft.storyId);
  const target = draft.target.trim() || story?.title.trim() || "";

  const ask = (): ChartersInput => {
    if (!target) throw new Error("nothing to ask about");
    const details = storyDetails(story);
    const pastLines = past
      .map((p) => p.trim().slice(0, CHARTERS_PAST_TEXT_MAX))
      .filter(Boolean)
      .slice(0, CHARTERS_PAST_MAX);
    return {
      target: target.slice(0, CHARTERS_TARGET_MAX),
      ...(details ? { details } : {}),
      ...(pastLines.length > 0 ? { past: pastLines } : {}),
      count: 3,
    };
  };

  return (
    <div className="space-y-4">
      <ItemForm
        form={form}
        submitLabel="Plan session"
        submitIcon={<CalendarPlus className="h-4 w-4" aria-hidden="true" />}
      >
        <Field label={CHARTER_LABEL.target} error={errors.target} required hint="What to explore">
          {(props) => (
            <Input
              {...props}
              ref={ref}
              value={draft.target}
              maxLength={TOOL_TEXT_MAX.short}
              autoComplete="off"
              onChange={(e) => update({ target: e.target.value })}
              placeholder="e.g. Saved addresses at checkout"
            />
          )}
        </Field>
        <Field
          label={CHARTER_LABEL.using}
          error={errors.using}
          hint="Data, a device, a role or a condition"
        >
          {(props) => (
            <Input
              {...props}
              value={draft.using}
              maxLength={TOOL_TEXT_MAX.short}
              autoComplete="off"
              onChange={(e) => update({ using: e.target.value })}
              placeholder="e.g. a slow connection"
            />
          )}
        </Field>
        <Field label={CHARTER_LABEL.toLearn} error={errors.toLearn} required>
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              value={draft.toLearn}
              maxLength={TOOL_TEXT_MAX.text}
              onChange={(e) => update({ toLearn: e.target.value })}
              placeholder="e.g. what a shopper sees when the list fails to load"
            />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Length" error={errors.minutes}>
            {(props) => (
              <select
                {...props}
                className={SELECT_CLASS}
                value={draft.minutes}
                onChange={(e) => update({ minutes: e.target.value })}
              >
                {SESSION_LENGTHS.map((m) => (
                  <option key={m} value={String(m)}>
                    {lengthText(m)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <PersonPicker
            label="Tester"
            value={draft.tester}
            error={errors.tester}
            onChange={(tester) => update({ tester })}
            offerAddToRoster={offerAddToRoster}
          />
          <Field
            label="Story"
            hint={
              stories.length === 0
                ? "Stories in progress, in review or done in the sprint show here"
                : undefined
            }
          >
            {(props) => (
              <select
                {...props}
                className={SELECT_CLASS}
                value={draft.storyId}
                onChange={(e) => update({ storyId: e.target.value })}
              >
                <option value="">No story</option>
                {stories.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Area" error={errors.area} hint="The part of the product">
            {(props) => (
              <Input
                {...props}
                list={areasId}
                value={draft.area}
                maxLength={TOOL_TEXT_MAX.short}
                autoComplete="off"
                onChange={(e) => update({ area: e.target.value })}
              />
            )}
          </Field>
          <datalist id={areasId}>
            {areas.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>
      </ItemForm>

      <div ref={askRef}>
        <AiButton
          task={testSessionsChartersTask}
          label="Ask Amr for charters"
          fallbackLabel="Suggest charters without AI"
          variant="outline"
          disabledReason={target ? null : "Type what to look at, or pick a story, first."}
          input={ask}
          onResult={(data, meta) => setIdeas({ items: data.charters, source: meta.source })}
        />
      </div>
      {ideas && ideas.items.length > 0 && (
        <AiSuggestions
          items={ideas.items}
          source={ideas.source}
          title="Charters to plan"
          acceptLabel="Plan"
          render={(c) => ({
            title: `Look at ${c.target}, using ${c.using}, to learn ${c.toLearn}`,
            // The length Plan makes: the nearest one the form offers.
            detail: `${lengthText(nearestLength(c.minutes))}. ${c.why}`,
          })}
          onAccept={(c) => onAccept(c, draft)}
          onDismiss={() => setIdeas(null)}
          returnFocus={() =>
            askRef.current?.querySelector<HTMLElement>('[data-testid="ai-button"]')
          }
        />
      )}
    </div>
  );
});
