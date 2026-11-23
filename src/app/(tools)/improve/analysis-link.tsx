"use client";

/**
 * An A3's link to a Root Cause analysis ("linked" always means its
 * rootCauseId). Pick one of the team's analyses, or, while none is linked,
 * open a new one with Analyze in Root Cause (one Undo takes back the
 * analysis and the link). Once linked, its root cause shows read-only, with
 * Use this (fills "Why it happens", with Undo) and Open in Root Cause. An
 * analysis that was deleted says so and offers Unlink.
 */

import { useId } from "react";
import Link from "next/link";
import { ArrowRight, Link2Off, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rootCauseHref } from "@/lib/handoffs/targets/root-cause";
import type { Improvement, RootCauseAnalysis } from "@/lib/stores/workspace-types";
import { SELECT_CLASS } from "./fields";
import type { ItemActions } from "./use-item-actions";

export function AnalysisLink({
  item,
  analyses,
  actions,
}: {
  item: Improvement;
  /** The team's analyses (no examples), newest change first. */
  analyses: readonly RootCauseAnalysis[];
  actions: ItemActions;
}) {
  const ids = useId();
  const linked = item.rootCauseId ? analyses.find((a) => a.id === item.rootCauseId) : undefined;

  if (item.rootCauseId && !linked) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2">
        <p className="text-sm text-sub">The linked analysis was deleted.</p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => actions.linkAnalysis(undefined)}
          className="gap-1.5"
        >
          <Link2Off aria-hidden="true" />
          Unlink
        </Button>
      </div>
    );
  }

  if (linked) {
    const root = linked.rootCause?.trim() ?? "";
    return (
      <div className="space-y-2 rounded-lg border border-border bg-card px-3 py-2">
        <p className="text-xs font-medium text-sub">
          From the Root Cause analysis “{linked.title}”
        </p>
        <p className="text-sm text-text">
          {root ? `Root cause: ${root}` : "No root cause named there yet."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {root && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => actions.applyRootCause(root)}
            >
              Use this
            </Button>
          )}
          <Link
            href={rootCauseHref(linked.id)}
            className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-accent hover:underline"
          >
            Open in Root Cause
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => actions.linkAnalysis(undefined)}
            className="gap-1.5 text-sub"
          >
            <Link2Off aria-hidden="true" />
            Unlink
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="max-w-md">
        <label htmlFor={`${ids}-pick`} className="mb-1 block text-xs font-medium text-sub">
          Link a Root Cause analysis
        </label>
        <select
          id={`${ids}-pick`}
          value=""
          onChange={(e) => {
            if (e.target.value) actions.linkAnalysis(e.target.value);
          }}
          className={SELECT_CLASS}
        >
          <option value="">{analyses.length === 0 ? "No analysis yet" : "Not linked"}</option>
          {analyses.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
      </div>
      {!actions.example && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => actions.analyzeInRootCause()}
            disabled={!item.title.trim()}
            className="gap-1.5"
            aria-describedby={`${ids}-analyze-note`}
          >
            <Search aria-hidden="true" />
            Analyze in Root Cause
          </Button>
          <p id={`${ids}-analyze-note`} className="text-xs text-sub">
            Opens a new analysis of this problem, linked here.
          </p>
        </div>
      )}
    </div>
  );
}
