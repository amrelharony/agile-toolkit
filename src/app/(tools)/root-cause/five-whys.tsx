"use client";

/**
 * The 5 Whys ladder: the problem at the top, then each answer to "why?",
 * the first one answering why the problem happened. Under every answer the
 * check "Is this really why?": would fixing it stop the line above? A "Not
 * really" asks for another answer before going deeper.
 *
 * Any answer can be marked as the root cause. Answers are edited in place
 * and deleted with Undo; Ask Amr suggests candidate next answers. They are
 * alternatives to one another, so the person picks one: it goes on the
 * ladder like a typed one, with Undo, and the rest go away (they answered
 * the line that is no longer last). Ask again for the next why.
 */

import { useRef, useState, type FormEvent, type MutableRefObject } from "react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { Check, CircleHelp, Plus, Target, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import { AiButton, AiSuggestions } from "@/components/ai";
import { nextWhyTask } from "@/lib/ai/tasks/root-cause";
import type { AiSource } from "@/lib/ai/task-types";
import {
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type RootCauseAnalysis,
  type RootCauseWhy,
} from "@/lib/stores/workspace-types";
import { WHYS_TYPICAL, whyLines } from "@/lib/root-cause/model";
import { cn } from "@/lib/utils";
import type { WhyCheck } from "./checks-store";

export interface FiveWhysProps {
  analysis: RootCauseAnalysis;
  checks: Readonly<Record<string, WhyCheck>>;
  /** Example analyses are read-only for AI (nothing to ask about the team). */
  readOnlyAi?: boolean;
  onAdd: (text: string, opts?: { fromAi?: boolean }) => void;
  onEdit: (whyId: string, text: string) => void;
  onRemove: (why: RootCauseWhy) => void;
  onMarkRoot: (text: string) => void;
  onCheck: (whyId: string, answer: WhyCheck | null) => void;
}

/** A new why's text checked: something to add, within the cap. */
export function validateWhy(text: string): string | null {
  const t = text.trim();
  if (!t) return "Write why it happened.";
  if (t.length > TOOL_TEXT_MAX.text) return `Keep it to ${TOOL_TEXT_MAX.text} characters.`;
  return null;
}

function WhyRow({
  why,
  index,
  above,
  check,
  isRoot,
  onEdit,
  onRemove,
  onMarkRoot,
  onCheck,
  textRef,
}: {
  why: RootCauseWhy;
  index: number;
  /** The line it answers: the problem, or the why before it. */
  above: string;
  check: WhyCheck | undefined;
  isRoot: boolean;
  onEdit: (text: string) => void;
  onRemove: () => void;
  onMarkRoot: () => void;
  onCheck: (answer: WhyCheck | null) => void;
  /** The row's text button, so focus can land here after a delete. */
  textRef: (el: HTMLButtonElement | null) => void;
}) {
  const edit = useInlineEdit();
  const questionId = `why-check-${why.id}`;
  return (
    <li
      className={cn(
        "space-y-2 rounded-lg border bg-card px-3 py-2.5",
        isRoot ? "border-accent" : "border-border"
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded-md bg-accent/15 px-1.5 py-0.5 font-mono text-xs font-semibold text-accent">
          Why {index + 1}
        </span>
        {edit.editing ? (
          <InlineItemEditor
            className="flex-1"
            label={`Edit why ${index + 1}`}
            title={why.text}
            titleLabel={`Why ${index + 1}`}
            titleMaxLength={TOOL_TEXT_MAX.text}
            onDone={(next, { refocus }) => {
              edit.stop({ refocus });
              if (next) onEdit(next.title);
            }}
          />
        ) : (
          <button
            ref={(el) => {
              (edit.triggerRef as MutableRefObject<HTMLButtonElement | null>).current = el;
              textRef(el);
            }}
            type="button"
            onClick={edit.start}
            aria-label={`Why ${index + 1}: ${why.text}. Edit`}
            className="min-w-0 flex-1 break-words text-left text-sm text-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {why.text}
          </button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={`Delete why ${index + 1}`}
          className="min-touch-coarse h-7 shrink-0 px-2 text-sub hover:text-danger"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-1">
        <p id={questionId} className="min-w-0 flex-1 text-xs text-sub">
          <CircleHelp className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
          Is this really why? If we fixed it, would “{above}” stop?
        </p>
        <div role="group" aria-labelledby={questionId} className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={check === "yes" ? "default" : "outline"}
            aria-pressed={check === "yes"}
            onClick={() => onCheck(check === "yes" ? null : "yes")}
            className="h-7 gap-1 px-2 text-xs"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Yes
          </Button>
          <Button
            type="button"
            size="sm"
            variant={check === "no" ? "default" : "outline"}
            aria-pressed={check === "no"}
            onClick={() => onCheck(check === "no" ? null : "no")}
            className="h-7 gap-1 px-2 text-xs"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Not really
          </Button>
        </div>
        {isRoot ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent">
            <Target className="h-3.5 w-3.5" aria-hidden="true" />
            Root cause
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onMarkRoot}
            // The visible words first, then which why (each row has one).
            aria-label={`Mark as root cause: why ${index + 1}`}
            className="h-7 gap-1 px-2 text-xs"
          >
            <Target className="h-3.5 w-3.5" aria-hidden="true" />
            Mark as root cause
          </Button>
        )}
      </div>
      {check === "no" && (
        <p className="pl-1 text-xs text-warning">
          Then it isn&apos;t the cause yet: reword it, or try another answer to the line above.
        </p>
      )}
    </li>
  );
}

export function FiveWhys({
  analysis,
  checks,
  readOnlyAi = false,
  onAdd,
  onEdit,
  onRemove,
  onMarkRoot,
  onCheck,
}: FiveWhysProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<{ items: string[]; source: AiSource } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** Each row's text button, by why id. */
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const announce = useAnnounce();
  const full = analysis.whys.length >= TOOL_LIST_MAX.whys;
  const problemLine = analysis.title;
  const root = analysis.rootCause?.trim() ?? "";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = validateWhy(draft);
    if (problem) {
      setError(problem);
      inputRef.current?.focus();
      return;
    }
    onAdd(draft.trim());
    setDraft("");
    setError(null);
  };

  /** After the chain changes, focus `whyId`'s row, else the new-why field, else the heading. */
  const focusAfter = (whyId: string | null) => {
    requestAnimationFrame(() => {
      const target =
        (whyId ? rowButtons.current.get(whyId) : undefined) ??
        inputRef.current ??
        headingRef.current;
      target?.focus();
    });
  };

  const remove = (why: RootCauseWhy, index: number) => {
    const neighbour = analysis.whys[index + 1] ?? analysis.whys[index - 1] ?? null;
    onRemove(why);
    focusAfter(neighbour?.id ?? null);
  };

  const accept = (text: string) => {
    onAdd(text, { fromAi: true });
    // The others answered the line that was last; ask again for the next one.
    setSuggested(null);
    focusAfter(null);
  };

  const aiInput = () => ({
    problem: [analysis.title, analysis.problem]
      .filter((s) => s.trim())
      .join(". ")
      .slice(0, 1000),
    whys: whyLines(analysis.whys).map((w) => w.slice(0, 1000)),
  });

  return (
    <section aria-labelledby="five-whys-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id="five-whys-heading"
          ref={headingRef}
          tabIndex={-1}
          className="rounded-sm text-sm font-semibold text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          5 Whys
        </h3>
        {!readOnlyAi && !full && (
          <AiButton
            task={nextWhyTask}
            input={aiInput}
            label="Ask Amr for the next why"
            fallbackLabel="Suggest without AI"
            onResult={(data, meta) => {
              setSuggested({ items: data.whys, source: meta.source });
              const n = data.whys.length;
              announce(
                n === 0
                  ? "No next why to suggest."
                  : `${n} possible next ${n === 1 ? "why" : "whys"} below. Pick the one that fits.`
              );
            }}
          />
        )}
      </div>
      <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-text">
        <span className="font-semibold">Problem:</span> {problemLine}
        {analysis.whys.length === 0 && (
          <span className="block text-xs text-sub">Why did this happen? Add the first answer.</span>
        )}
      </p>
      {analysis.whys.length > 0 && (
        <ol aria-label="Why chain" className="space-y-2">
          {analysis.whys.map((w, i) => (
            <WhyRow
              key={w.id}
              why={w}
              index={i}
              above={i === 0 ? problemLine : analysis.whys[i - 1].text}
              check={checks[w.id]}
              isRoot={root !== "" && w.text.trim() === root}
              onEdit={(text) => onEdit(w.id, text)}
              onRemove={() => remove(w, i)}
              onMarkRoot={() => onMarkRoot(w.text)}
              onCheck={(answer) => onCheck(w.id, answer)}
              textRef={(el) => {
                if (el) rowButtons.current.set(w.id, el);
                else rowButtons.current.delete(w.id);
              }}
            />
          ))}
        </ol>
      )}
      {analysis.whys.length >= WHYS_TYPICAL && !root && (
        <p className="text-xs text-sub">
          That&apos;s {analysis.whys.length}. Stop at a cause the team can change, and mark it as
          the root cause.
        </p>
      )}
      {suggested && suggested.items.length > 0 && (
        <AiSuggestions
          items={suggested.items}
          source={suggested.source}
          title="Possible next whys"
          pickOne
          onAccept={accept}
          onDismiss={() => setSuggested(null)}
        />
      )}
      {full ? (
        <p className="text-xs text-sub">
          The chain holds {TOOL_LIST_MAX.whys} whys, the most it can. Delete one to add another.
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <label htmlFor={`why-new-${analysis.id}`} className="sr-only">
              {analysis.whys.length === 0
                ? "Why did the problem happen?"
                : `Why did “${analysis.whys[analysis.whys.length - 1].text}” happen?`}
            </label>
            <Input
              id={`why-new-${analysis.id}`}
              ref={inputRef}
              value={draft}
              maxLength={TOOL_TEXT_MAX.text}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `why-new-error-${analysis.id}` : undefined}
              placeholder={analysis.whys.length === 0 ? "Because…" : "And why was that? Because…"}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError(validateWhy(e.target.value));
              }}
            />
            {error && (
              <p id={`why-new-error-${analysis.id}`} className="mt-1 text-xs text-danger">
                {error}
              </p>
            )}
          </div>
          <Button type="submit" size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add why
          </Button>
        </form>
      )}
    </section>
  );
}
