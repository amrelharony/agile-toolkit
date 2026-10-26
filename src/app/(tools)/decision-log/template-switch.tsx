"use client";

import Link from "next/link";
import type { DecisionTemplate } from "@/lib/stores/workspace-types";
import { TEMPLATES } from "@/lib/decisions/templates";
import { cn } from "@/lib/utils";

const ORDER: readonly { template: DecisionTemplate; hint: string }[] = [
  { template: "adr", hint: "Context, options, outcome and consequences" },
  { template: "daci", hint: "Driver, Approver, Contributors, Informed" },
  { template: "rapid", hint: "Recommend, Agree, Perform, Input, Decide" },
];

/**
 * ADR | DACI | RAPID. Links rather than tabs: each form keeps its own page
 * (/decision-log, /daci, /rapid-decision), so a bookmark or a link opens
 * the right one, and the switch replaces the history entry so Back leaves
 * the log instead of flipping between forms. Every page lists the same
 * records; the form only sets what New starts with.
 */
export function TemplateSwitch({ template }: { template: DecisionTemplate }) {
  return (
    <nav
      aria-label="Decision form"
      className="inline-flex shrink-0 rounded-lg border border-border bg-surface-deep p-1"
    >
      {ORDER.map(({ template: t, hint }) => {
        const active = t === template;
        return (
          <Link
            key={t}
            href={TEMPLATES[t].href}
            replace
            aria-current={active ? "page" : undefined}
            title={hint}
            className={cn(
              "min-touch-coarse inline-flex items-center rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              active ? "bg-surface font-medium text-text shadow-sm" : "text-sub hover:text-text"
            )}
          >
            {TEMPLATES[t].label}
          </Link>
        );
      })}
    </nav>
  );
}
