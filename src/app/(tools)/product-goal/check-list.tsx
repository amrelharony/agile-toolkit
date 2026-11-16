"use client";

import { CheckCircle2, Circle, HelpCircle } from "lucide-react";
import type { GoalCheck } from "@/lib/product-goal/model";

/** The four questions with how the text reads on each, and what to try when one isn't met. */
export function CheckList({ checks, title }: { checks: readonly GoalCheck[]; title: string }) {
  return (
    <section aria-label={title} className="space-y-1.5">
      <h3 className="text-xs font-medium text-sub">{title}</h3>
      <ul className="space-y-1.5">
        {checks.map((c) => (
          <li key={c.id} data-check={c.id} className="flex items-start gap-2 text-sm">
            {c.met === true ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            ) : c.met === false ? (
              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            ) : (
              <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-sub" aria-hidden="true" />
            )}
            <span className="min-w-0">
              <span className="text-text">{c.label}</span>{" "}
              <span className="sr-only">
                {c.met === true ? "Looks met." : c.met === false ? "Not yet." : "Your call."}
              </span>
              {c.met !== true && <span className="block text-xs text-sub">{c.hint}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
