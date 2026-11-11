"use client";

import Link from "@/components/motion/transition-link";
import type { ReactNode } from "react";
import { leadBasisText, provenanceText, type DoraDerivation } from "@/lib/dora/derive";
import type { DoraMetric } from "@/lib/dora/bands";
import type { DoraDraftField } from "./form";

/** Where to go for the data a metric couldn't be worked out from. */
const FIX: Record<DoraMetric, { href: string; label: string }> = {
  deployFreqPerWeek: { href: "/release-readiness", label: "Release Readiness" },
  changeFailRate: { href: "/release-readiness", label: "Release Readiness" },
  leadTimeHours: { href: "/kanban", label: "Kanban" },
  mttrHours: { href: "/incident-commander", label: "Incident Commander" },
};

const FIELD_METRIC: Partial<Record<DoraDraftField, DoraMetric>> = {
  deployFreqPerWeek: "deployFreqPerWeek",
  leadTimeHours: "leadTimeHours",
  changeFailRatePct: "changeFailRate",
  mttrHours: "mttrHours",
};

/**
 * Under a metric "Fill from your data" couldn't work out: why, and a link
 * to where its data lives. Shared by "Log a quarter" and a row's editor.
 */
export function metricNoteFor(shown: DoraDerivation | null) {
  return function metricNote(field: DoraDraftField): ReactNode {
    const metric = FIELD_METRIC[field];
    const why = shown && metric ? shown.missing[metric] : undefined;
    if (!why || !metric) return null;
    return (
      <span className="text-warning">
        {why}{" "}
        <Link href={FIX[metric].href} className="font-medium text-accent hover:underline">
          {FIX[metric].label}
        </Link>
      </span>
    );
  };
}

/** What a fill was worked out from, how the lead time was measured, and a running quarter's caveat. */
export function DerivationPanel({ shown }: { shown: DoraDerivation }) {
  return (
    <div role="status" className="rounded-lg border border-border bg-surface p-3 text-xs text-sub">
      <p className="font-medium text-text">{provenanceText(shown.derivedFrom)}</p>
      <p className="mt-1">{leadBasisText(shown)}</p>
      {shown.inProgress && (
        <p className="mt-1">
          {shown.quarter} is still running: deploys a week are over the{" "}
          {Math.round(shown.weeks * 10) / 10} weeks so far.
        </p>
      )}
      <p className="mt-1">Only a number saved as it was filled counts as from your data.</p>
    </div>
  );
}
