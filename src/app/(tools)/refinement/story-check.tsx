"use client";

import { useId } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { INVEST_QUESTIONS, SPLIT_PATTERNS, investResult } from "./invest";

/**
 * "Check the story": the six INVEST questions as boxes to tick while the
 * team talks, a line saying where the story stands, and five ways to split
 * one that is too big. A thinking aid, closed until asked for: the ticks
 * live in the page while it is open and are never saved, and nothing here
 * decides "Mark ready". No AI, no key.
 */
export function StoryCheck({
  title,
  open,
  onOpenChange,
  yes,
  onChange,
  className,
}: {
  /** The story being checked, for the questions' group name. */
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ids of the questions answered yes. */
  yes: readonly string[];
  onChange: (yes: string[]) => void;
  className?: string;
}) {
  const bodyId = useId();
  const ticked = new Set(yes);
  const result = investResult(yes);
  const toggle = (id: string, on: boolean) =>
    onChange(INVEST_QUESTIONS.map((q) => q.id).filter((q) => (q === id ? on : ticked.has(q))));

  return (
    <div className={cn("rounded-lg border border-border bg-card", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => onOpenChange(!open)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-text hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span>
          Check the story{" "}
          <span className="font-normal text-sub">· six questions, and ways to split it</span>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-sub transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div id={bodyId} className="space-y-4 border-t border-rule px-3 py-3">
          <fieldset>
            <legend className="text-sm font-medium text-text">
              Six questions to ask of it<span className="sr-only">: {title}</span>
            </legend>
            <p className="mt-0.5 text-xs text-sub">
              Tick each one the answer is yes to. The ticks stay while this page is open. They
              aren&rsquo;t saved, and they don&rsquo;t change whether the story is ready.
            </p>
            <ul className="mt-2 space-y-1">
              {INVEST_QUESTIONS.map((q) => (
                <li key={q.id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-card-hover pointer-coarse:min-h-11 pointer-coarse:items-center">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)] pointer-coarse:mt-0"
                      checked={ticked.has(q.id)}
                      onChange={(e) => toggle(q.id, e.target.checked)}
                    />
                    <span className="min-w-0 text-sm text-text">
                      <span className="font-medium">{q.word}.</span> {q.question}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <p aria-live="polite" className="text-sm text-text" data-field="story-check-result">
            {result.text}
          </p>
          <div>
            <h4 className="text-sm font-medium text-text">Too big? Five ways to split it</h4>
            <dl className="mt-1.5 space-y-1.5">
              {SPLIT_PATTERNS.map((p) => (
                <div key={p.id} className="text-sm">
                  <dt className="inline font-medium text-text">{p.name}. </dt>
                  <dd className="inline text-sub">{p.how}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
