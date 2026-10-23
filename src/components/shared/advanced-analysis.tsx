"use client";

import type { ReactNode } from "react";
import { ChevronDown, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Statistical extras (control charts, change points, forecasts from short
 * histories) behind a closed disclosure, so the headline result stays the
 * first thing a Scrum master reads.
 */
export function AdvancedAnalysis({
  summary = "Advanced analysis",
  children,
  className,
}: {
  summary?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("group rounded-lg border border-border bg-card", className)}>
      <summary className="flex min-h-11 cursor-pointer select-none list-none items-center gap-2 px-4 py-2 text-sm text-text [&::-webkit-details-marker]:hidden">
        <FlaskConical className="h-4 w-4 shrink-0 text-sub" aria-hidden="true" />
        <span className="font-medium">{summary}</span>
        <ChevronDown
          className="ml-auto h-4 w-4 shrink-0 text-sub transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="space-y-4 border-t border-border px-4 py-4">{children}</div>
    </details>
  );
}
