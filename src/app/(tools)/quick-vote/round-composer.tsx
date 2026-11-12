"use client";

/**
 * Set up the round: the question, and whatever the format lets you change
 * (your own options or labels, a range, the backlog item, the feelings
 * step). Every change is saved to the tool's store as it is typed, so a
 * reload or Amr's `start_round` picks it up; a live room's next round asks
 * whatever is here then.
 *
 * Each field says what's wrong once it has been left, and Run it says what
 * is still missing; a blank is never defaulted. "Suggest
 * options" asks Amr's AI, or answers without it, and nothing is added until
 * the host adds it (with Undo).
 */

import { useId, useState } from "react";
import Link from "next/link";
import { ListPlus, RotateCcw } from "lucide-react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/toggle-group";
import type { AiSource } from "@/lib/ai/task-types";
import { SUGGEST_OPTIONS_MAX, suggestOptionsTask } from "@/lib/ai/tasks/_example";
import { VOTE_LIMITS } from "@/lib/realtime/vote-room/protocol";
import { FEELINGS, feelingsQuestion, type QuickVotePreset } from "@/lib/quick-vote/presets";
import {
  LIST_TEXT_MAX,
  OPTION_MAX,
  QUESTION_MAX,
  UNIT_MAX,
  draftOptions,
  draftPoints,
  parseLines,
  type DraftField,
  type RoundDraft,
} from "@/lib/quick-vote/draft";
import type { ComposerSources } from "./model";

export interface RoundComposerProps {
  draft: RoundDraft;
  preset: QuickVotePreset;
  errors: Partial<Record<DraftField, string>>;
  onChange: (patch: Partial<RoundDraft>) => void;
  /** Add options to the list (Amr's suggestions), with Undo. */
  onAddOptions: (options: string[]) => void;
  /** Replace the list with one from the backlog or the retro, with Undo. */
  onUseList: (options: string[], from: string) => void;
  /** Back to the format's own question and answers. */
  onStartOver: () => void;
  sources: ComposerSources;
  readOnly?: boolean;
}

const MODES = [
  { value: "single" as const, label: "One pick each" },
  { value: "multi" as const, label: "Several picks" },
];

const DECIMALS = [
  { value: 0 as const, label: "Whole numbers" },
  { value: 1 as const, label: "1 decimal" },
  { value: 2 as const, label: "2 decimals" },
];

const NUMBER_CLASS = "w-28";

export function RoundComposer({
  draft,
  preset,
  errors,
  onChange,
  onAddOptions,
  onUseList,
  onStartOver,
  sources,
  readOnly = false,
}: RoundComposerProps) {
  const [touched, setTouched] = useState<ReadonlySet<DraftField>>(() => new Set());
  const [suggested, setSuggested] = useState<{ items: string[]; source: AiSource } | null>(null);
  const itemSelectId = useId();
  const touch = (f: DraftField) => () =>
    setTouched((prev) => (prev.has(f) ? prev : new Set(prev).add(f)));
  const shown = (f: DraftField) => (touched.has(f) ? errors[f] : undefined);

  const options = draftOptions(draft, preset);
  const optionsMax =
    preset.kind === "rank" ? VOTE_LIMITS.maxRankOptions : VOTE_LIMITS.maxChoiceOptions;
  const answers =
    preset.kind === "scale"
      ? draftPoints(draft, preset).map((p) => p.label)
      : options.map((o) => o.text);
  const question = draft.question.trim();

  return (
    <div className="space-y-4">
      <Field label="Question" error={shown("question")} required>
        {(props) => (
          <Input
            {...props}
            value={draft.question}
            maxLength={QUESTION_MAX}
            disabled={readOnly}
            onChange={(e) => onChange({ question: e.target.value })}
            onBlur={touch("question")}
          />
        )}
      </Field>

      {preset.editable === "options" && (
        <div className="space-y-3">
          <Field
            label="Options, one per line"
            hint={`${options.length} of ${optionsMax} at most. Paste a list: bullets and numbers are dropped.`}
            error={shown("options")}
            required
          >
            {(props) => (
              <Textarea
                {...props}
                rows={5}
                value={draft.optionsText}
                maxLength={LIST_TEXT_MAX}
                disabled={readOnly}
                onChange={(e) => onChange({ optionsText: e.target.value })}
                onBlur={touch("options")}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-start gap-2">
            <AiButton
              task={suggestOptionsTask}
              input={() => ({ question })}
              label="Suggest options"
              fallbackLabel="Suggest options"
              variant="outline"
              disabledReason={
                readOnly
                  ? "Clear the example first."
                  : question.length < 3
                    ? "Type the question first, then ask for options."
                    : null
              }
              onResult={(data, meta) => setSuggested({ items: data.options, source: meta.source })}
            />
            {sources.backlog.length >= 2 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={readOnly}
                onClick={() => onUseList(sources.backlog.slice(0, optionsMax), "the backlog")}
              >
                <ListPlus aria-hidden="true" />
                Use the backlog
              </Button>
            )}
            {sources.retro.length >= 2 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={readOnly}
                onClick={() => onUseList(sources.retro.slice(0, optionsMax), "the retro board")}
              >
                <ListPlus aria-hidden="true" />
                Use the retro board
              </Button>
            )}
          </div>
          {suggested && (
            <AiSuggestions
              items={suggested.items.slice(0, SUGGEST_OPTIONS_MAX)}
              source={suggested.source}
              title="Suggested options"
              onAccept={(text) => onAddOptions([text])}
              onAcceptAll={(list) => onAddOptions(list)}
              onDismiss={() => setSuggested(null)}
            />
          )}
        </div>
      )}

      {preset.id === "poll" && (
        <div className="space-y-3">
          <ToggleGroup
            label="How people answer"
            options={MODES}
            value={draft.mode === "multi" ? "multi" : "single"}
            onValueChange={(mode) =>
              onChange({ mode, limit: mode === "multi" && !draft.limit.trim() ? "2" : draft.limit })
            }
          />
          {draft.mode === "multi" && (
            <Field label="Most picks each" error={shown("limit")} required>
              {(props) => (
                <Input
                  {...props}
                  className={NUMBER_CLASS}
                  inputMode="numeric"
                  value={draft.limit}
                  disabled={readOnly}
                  onChange={(e) => onChange({ limit: e.target.value })}
                  onBlur={touch("limit")}
                />
              )}
            </Field>
          )}
        </div>
      )}

      {preset.id === "dots" && (
        <Field
          label="Dots each"
          hint={`1 to ${VOTE_LIMITS.maxDots}. People may put several on one option.`}
          error={shown("limit")}
          required
        >
          {(props) => (
            <Input
              {...props}
              className={NUMBER_CLASS}
              inputMode="numeric"
              value={draft.limit}
              disabled={readOnly}
              onChange={(e) => onChange({ limit: e.target.value })}
              onBlur={touch("limit")}
            />
          )}
        </Field>
      )}

      {preset.editable === "labels" && (
        <Field
          label="Answers, lowest first, one per line"
          hint={`${VOTE_LIMITS.minPoints} to ${VOTE_LIMITS.maxPoints} answers.`}
          error={shown("labels")}
          required
        >
          {(props) => (
            <Textarea
              {...props}
              rows={4}
              value={draft.labelsText}
              maxLength={LIST_TEXT_MAX}
              disabled={readOnly}
              onChange={(e) => onChange({ labelsText: e.target.value })}
              onBlur={touch("labels")}
            />
          )}
        </Field>
      )}

      {preset.editable === "range" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <Field label="Lowest answer" error={shown("min")} required>
              {(props) => (
                <Input
                  {...props}
                  className={NUMBER_CLASS}
                  inputMode="decimal"
                  value={draft.min}
                  disabled={readOnly}
                  onChange={(e) => onChange({ min: e.target.value })}
                  onBlur={touch("min")}
                />
              )}
            </Field>
            <Field label="Highest answer" error={shown("max")} required>
              {(props) => (
                <Input
                  {...props}
                  className={NUMBER_CLASS}
                  inputMode="decimal"
                  value={draft.max}
                  disabled={readOnly}
                  onChange={(e) => onChange({ max: e.target.value })}
                  onBlur={touch("max")}
                />
              )}
            </Field>
            <Field label="Unit" hint="Optional: %, days, €" error={shown("unit")}>
              {(props) => (
                <Input
                  {...props}
                  className={NUMBER_CLASS}
                  value={draft.unit}
                  maxLength={UNIT_MAX + 4}
                  disabled={readOnly}
                  onChange={(e) => onChange({ unit: e.target.value })}
                  onBlur={touch("unit")}
                />
              )}
            </Field>
          </div>
          <ToggleGroup
            label="Decimal places"
            options={DECIMALS}
            value={draft.decimals}
            onValueChange={(decimals) => onChange({ decimals })}
          />
        </div>
      )}

      {preset.editable === "item" && (
        <div className="space-y-1.5">
          <label htmlFor={itemSelectId} className="text-sm text-text">
            Backlog item
          </label>
          {sources.items.length > 0 ? (
            <select
              id={itemSelectId}
              value={draft.backlogItemId ?? ""}
              disabled={readOnly}
              onChange={(e) => {
                const id = e.target.value || null;
                const item = sources.items.find((x) => x.id === id);
                onChange({
                  backlogItemId: id,
                  ...(item
                    ? {
                        question:
                          `How much value does “${item.name}” bring, compared with the others?`.slice(
                            0,
                            QUESTION_MAX
                          ),
                      }
                    : {}),
                });
              }}
              className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-base text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 pointer-fine:md:h-9 pointer-fine:md:text-sm"
            >
              <option value="">No item: just vote</option>
              {sources.items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          ) : null}
          <p className="text-xs text-sub">
            {sources.items.length > 0
              ? "After the round, you can save the agreed value to the item, with Undo."
              : "No backlog items yet. "}
            {sources.items.length === 0 && (
              <Link href="/prioritizer" className="text-accent underline-offset-2 hover:underline">
                Add some in the Backlog Prioritizer
              </Link>
            )}
          </p>
        </div>
      )}

      {preset.editable === "feelings" && (
        <ToggleGroup
          label="Which step"
          options={[
            { value: "", label: "1. Core feelings" },
            ...FEELINGS.map((f) => ({ value: f.core, label: `2. ${f.core}` })),
          ]}
          value={draft.feelingsCore ?? ""}
          onValueChange={(core) =>
            onChange({ feelingsCore: core || null, question: feelingsQuestion(core || null) })
          }
        />
      )}

      {preset.editable !== "options" && preset.editable !== "labels" && answers.length > 0 && (
        <div>
          <p className="text-sm text-text">People answer</p>
          <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Answers">
            {answers.map((a) => (
              <li
                key={a}
                className="rounded-md border border-border bg-surface-deep px-2 py-1 text-xs text-text"
              >
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {preset.editable === "range" && (
        <p className="text-xs text-sub">
          People type one number in the range. After the round, add the real answer to the saved
          result to see how close the guesses were.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="gap-1.5"
          disabled={readOnly}
          onClick={() => {
            setTouched(new Set());
            setSuggested(null);
            onStartOver();
          }}
        >
          <RotateCcw aria-hidden="true" />
          Start over
        </Button>
        <p className="text-xs text-sub">{preset.tip}</p>
      </div>
    </div>
  );
}

/** The options a pasted list adds to `current`: new ones only, within the cap. */
export function addToList(current: string, add: readonly string[], max: number): string {
  const lines = parseLines(current, OPTION_MAX);
  const seen = new Set(lines.map((l) => l.toLowerCase()));
  for (const raw of add) {
    const t = parseLines(raw, OPTION_MAX)[0];
    if (!t || seen.has(t.toLowerCase()) || lines.length >= max) continue;
    seen.add(t.toLowerCase());
    lines.push(t);
  }
  return lines.join("\n");
}
