"use client";

/**
 * Sort the work: the finished items in the window with no type set, each
 * with its guess (from its story kind, tags or the tool it came from). A
 * type picked here, "Repeat work", "Accept all guesses" and Amr's
 * suggestions each write through the page's writer with Undo. "Sort with
 * AI" sends short ids only; without AI it sorts by the page's rules and
 * title words. Nothing is written until the person accepts.
 */

import { useRef, useState } from "react";
import { ListChecks, Wand2 } from "lucide-react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { WORK_TYPES, type WorkType } from "@/lib/stores/workspace-types";
import { WORK_TYPE_LABEL } from "@/lib/flow/work-types";
import { TYPE_BY_LABEL, type MixItem } from "@/lib/flow/distribution";
import type { AiSource } from "@/lib/ai/task-types";
import {
  cleanClassified,
  fitClassifyInput,
  flowInsightsClassifyTask,
} from "@/lib/ai/tasks/flow-insights.lite";
import { classifyPlan, type FlowData, type RowRef, type TypeChange } from "../model";

/** Matches <Input>: 44 px / 16 px on touch, 36 px / 14 px for a mouse at md+. */
const SELECT_CLASS =
  "flex h-11 pointer-fine:md:h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base pointer-fine:md:text-sm text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** Rows shown before "Show all". */
export const SORT_ROWS_SHOWN = 12;

/** One of Amr's suggestions, mapped back to its row. */
export interface SortSuggestion extends RowRef {
  title: string;
  type: WorkType;
  failure: boolean;
  reason: string;
}

/** The write for an accepted suggestion: its type, and "repeat work" when that isn't implied by a defect. */
export function suggestionChange(s: SortSuggestion): TypeChange {
  return {
    kind: s.kind,
    id: s.id,
    type: s.type,
    ...(s.failure && s.type !== "defect" ? { demand: "failure" as const } : {}),
  };
}

export function SortSection({
  items,
  data,
  status,
  onSetType,
  onToggleRepeat,
  onAcceptGuesses,
  onAcceptSuggestions,
}: {
  /** Finished items in the window with no type set, newest first. */
  items: readonly MixItem[];
  data: FlowData;
  status: string;
  onSetType: (item: MixItem, type: WorkType) => void;
  onToggleRepeat: (item: MixItem) => void;
  onAcceptGuesses: (items: MixItem[]) => void;
  onAcceptSuggestions: (list: SortSuggestion[], source: AiSource) => void;
}) {
  const [all, setAll] = useState(false);
  const [suggested, setSuggested] = useState<{
    items: SortSuggestion[];
    source: AiSource;
    left: number;
  } | null>(null);
  const askRef = useRef<HTMLDivElement>(null);
  const planRef = useRef<ReturnType<typeof classifyPlan> | null>(null);
  const sentRef = useRef<Set<string>>(new Set());
  const leftRef = useRef(0);
  const guessed = items.filter((it) => it.type !== null);
  const shown = all ? items : items.slice(0, SORT_ROWS_SHOWN);

  const buildInput = () => {
    const plan = classifyPlan(items, data.stories, data.board?.cards ?? []);
    const fitted = fitClassifyInput(plan.input);
    planRef.current = plan;
    sentRef.current = new Set(fitted.items.map((i) => i.id));
    leftRef.current = items.length - fitted.items.length;
    return fitted;
  };

  const showSuggestions = (
    answer: { items: { id: string; type: WorkType; failure: boolean; reason: string }[] },
    source: AiSource
  ) => {
    const plan = planRef.current;
    if (!plan) return;
    const titles = new Map(items.map((it) => [`${it.kind}:${it.id}`, it.title]));
    const list = cleanClassified(answer.items, sentRef.current).flatMap((a) => {
      const ref = plan.byShortId.get(a.id);
      if (!ref) return [];
      return [
        {
          ...ref,
          title: titles.get(`${ref.kind}:${ref.id}`) || "Untitled",
          type: a.type,
          failure: a.failure,
          reason: a.reason,
        },
      ];
    });
    setSuggested({ items: list, source, left: leftRef.current });
  };

  return (
    <SectionCard
      title={`Sort the work (${items.length})`}
      icon={ListChecks}
      contentClassName="space-y-3"
      actions={
        items.length > 0 ? (
          <div ref={askRef} className="flex flex-wrap gap-2">
            {guessed.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onAcceptGuesses(guessed)}
              >
                <Wand2 aria-hidden="true" />
                Accept all guesses ({guessed.length})
              </Button>
            )}
            <AiButton
              task={flowInsightsClassifyTask}
              label="Sort with AI"
              fallbackLabel="Sort by keywords"
              variant="outline"
              input={buildInput}
              onResult={(answer, meta) => showSuggestions(answer, meta.source)}
            />
          </div>
        ) : undefined
      }
    >
      <p role="status" aria-live="polite" className="text-sm text-text empty:hidden">
        {status}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-sub">
          Every finished item in the window has a type. New ones show here to sort.
        </p>
      ) : (
        <>
          <p className="text-xs text-sub">
            Each finished item without a type set, newest first. A guess counts in the mix until you
            pick a type; Amr&apos;s suggestions wait for you to accept them.
          </p>
          {suggested && suggested.items.length > 0 && (
            <AiSuggestions
              items={suggested.items}
              source={suggested.source}
              title="Types to accept"
              acceptLabel="Accept"
              itemKey={(s) => `${s.kind}:${s.id}`}
              render={(s) => ({
                title: `${s.title}: ${WORK_TYPE_LABEL[s.type]}${s.failure ? ", repeat work" : ""}`,
                detail: s.reason,
              })}
              onAccept={(s) => onAcceptSuggestions([s], suggested.source)}
              onAcceptAll={(list) => onAcceptSuggestions(list, suggested.source)}
              onDismiss={() => setSuggested(null)}
              returnFocus={() =>
                askRef.current?.querySelector<HTMLElement>('[data-testid="ai-button"]')
              }
            />
          )}
          {suggested && suggested.left > 0 && (
            <p className="text-xs text-sub">
              {suggested.left} {suggested.left === 1 ? "item didn't" : "items didn't"} fit: sort{" "}
              {suggested.left === 1 ? "it" : "them"} next.
            </p>
          )}
          <ul
            className="divide-y divide-border rounded-lg border border-border"
            aria-label="Items to sort"
          >
            {shown.map((it) => (
              <SortRow
                key={`${it.kind}-${it.id}`}
                item={it}
                onSetType={onSetType}
                onToggleRepeat={onToggleRepeat}
              />
            ))}
          </ul>
          {items.length > SORT_ROWS_SHOWN && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setAll((v) => !v)}>
              {all ? "Show fewer" : `Show all ${items.length}`}
            </Button>
          )}
        </>
      )}
    </SectionCard>
  );
}

function SortRow({
  item,
  onSetType,
  onToggleRepeat,
}: {
  item: MixItem;
  onSetType: (item: MixItem, type: WorkType) => void;
  onToggleRepeat: (item: MixItem) => void;
}) {
  const guess = item.type
    ? `Guess: ${WORK_TYPE_LABEL[item.type]}, ${TYPE_BY_LABEL[item.typeBy ?? "keywords"]}`
    : "Not sorted: no guess";
  return (
    <li className="grid gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
      <div className="min-w-0">
        <p className="break-words text-sm text-text">{item.title || "Untitled"}</p>
        <p className="text-xs text-sub">
          {item.kind === "story" ? "Story" : "Card"} · done {item.doneOn} · {guess}
        </p>
      </div>
      <select
        aria-label={`Type of ${item.title || "this item"}`}
        className={SELECT_CLASS}
        value=""
        onChange={(e) => {
          const v = e.target.value as WorkType;
          if ((WORK_TYPES as readonly string[]).includes(v)) onSetType(item, v);
        }}
      >
        <option value="">
          {item.type ? `Pick (guess: ${WORK_TYPE_LABEL[item.type]})` : "Pick a type"}
        </option>
        {WORK_TYPES.map((t) => (
          <option key={t} value={t}>
            {WORK_TYPE_LABEL[t]}
          </option>
        ))}
      </select>
      <Button
        type="button"
        size="sm"
        variant={item.failure ? "default" : "outline"}
        aria-pressed={item.failure}
        onClick={() => onToggleRepeat(item)}
      >
        Repeat work
      </Button>
    </li>
  );
}
