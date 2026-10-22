"use client";

import Link from "next/link";
import { ArrowRight, Check, Circle, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlowCard, FlowState } from "../view";

const STATE_ICON = { todo: Circle, doing: CircleDot, done: Check } as const;
const STATE_WORD: Record<FlowState, string> = {
  todo: "not started",
  doing: "in progress",
  done: "done",
};
const STATE_CLASS: Record<FlowState, string> = {
  todo: "border-border text-sub",
  doing: "border-accent/40 bg-accent/10 text-accent",
  done: "border-success/40 bg-success/10 text-success",
};

/**
 * The sprint's ceremonies left to right — Planning, Daily, Refinement,
 * Review, Retro — each with where it stands and the tool that runs it.
 */
export function FlowStrip({ cards }: { cards: FlowCard[] }) {
  return (
    <ol aria-label="Sprint ceremonies" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card, i) => {
        const Icon = STATE_ICON[card.state];
        return (
          <li
            key={card.kind}
            data-flow={card.kind}
            data-state={card.state}
            className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-card p-3"
          >
            <div className="flex items-center gap-2 text-xs font-medium text-sub">
              <span
                className={cn(
                  "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                  STATE_CLASS[card.state]
                )}
              >
                <Icon className="h-3 w-3" aria-hidden="true" />
              </span>
              <span className="truncate">
                {i + 1}. {card.label}
              </span>
              <span className="sr-only">, {STATE_WORD[card.state]}</span>
            </div>
            <p className="text-sm text-text">{card.line}</p>
            <Link
              href={card.href}
              className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
            >
              {card.cta}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
