"use client";

import Link from "next/link";
import { Mail, Mic } from "lucide-react";
import type { StandupMode } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";

/** Each mode keeps its own URL, so a bookmark or a link opens the right one. */
export const MODE_HREF: Record<StandupMode, string> = {
  live: "/standup",
  async: "/async-standup",
};

const MODES = [
  { mode: "live", label: "Live", icon: Mic, hint: "Walk the board together" },
  { mode: "async", label: "Async", icon: Mail, hint: "Post written updates" },
] as const;

/**
 * Live | Async. Links rather than tabs: each mode is its own page, and the
 * switch replaces the history entry (router.replace) so Back leaves the
 * standup instead of flipping between its modes.
 */
export function ModeSwitch({ mode }: { mode: StandupMode }) {
  return (
    <nav
      aria-label="Standup mode"
      className="inline-flex shrink-0 rounded-lg border border-border bg-surface-deep p-1"
    >
      {MODES.map((m) => {
        const active = m.mode === mode;
        const Icon = m.icon;
        return (
          <Link
            key={m.mode}
            href={MODE_HREF[m.mode]}
            replace
            aria-current={active ? "page" : undefined}
            title={m.hint}
            className={cn(
              "min-touch-coarse inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              active ? "bg-surface font-medium text-text shadow-sm" : "text-sub hover:text-text"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {m.label}
          </Link>
        );
      })}
    </nav>
  );
}
