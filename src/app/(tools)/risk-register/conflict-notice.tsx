"use client";

import { History, Inbox, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RiskConflictField, RiskRegisterConflict } from "@/lib/risks/legacy-register";
import { toScale } from "@/lib/risks/model";
import type { Risk } from "@/lib/stores/workspace-types";
import { IMPACT_STEPS, LIKELIHOOD_STEPS } from "./scales";

const FIELD_LABEL: Readonly<Record<RiskConflictField, string>> = {
  title: "Title",
  mitigation: "Mitigation plan",
  mitigationDueAt: "Mitigation due",
  probability: "Likelihood",
  impact: "Impact",
};

/** A conflict's value as the page shows it: a rating with what it means, a day, or the text. */
export function conflictText(field: RiskConflictField, v: string | number): string {
  if (field === "probability" || field === "impact") {
    const steps = field === "probability" ? LIKELIHOOD_STEPS : IMPACT_STEPS;
    const n = toScale(v);
    const meaning = steps.find((s) => s.value === n)?.meaning;
    return meaning ? `${n} (${meaning})` : String(v);
  }
  return String(v);
}

/**
 * The risk with the old Risk Register page's value for one field: a rating
 * read on the 1–5 scale (the move compared it there), else the text.
 */
export function withBlobValue(r: Risk, c: RiskRegisterConflict): Risk {
  if (c.field === "probability" || c.field === "impact") {
    const n = toScale(c.blob);
    return n === null ? r : { ...r, [c.field]: n };
  }
  return { ...r, [c.field]: String(c.blob) };
}

/**
 * Shown once, after the move: risks whose values differed between the old
 * Risk Register page (edited after a Push) and the workspace (an agent's
 * edit, or a hand-off). The move kept the workspace's; each field offers
 * the old page's value with "Use this instead" (with Undo) or "Keep". Once
 * settled, or when the page is left, it isn't shown again: the old value
 * stays in the old page's storage, the backup.
 */
export function ConflictNotice({
  conflicts,
  records,
  onKeep,
  onUseOld,
}: {
  conflicts: readonly RiskRegisterConflict[];
  records: readonly Risk[];
  onKeep: (c: RiskRegisterConflict) => void;
  onUseOld: (c: RiskRegisterConflict) => void;
}) {
  const shown = conflicts.filter((c) => records.some((r) => r.id === c.id));
  if (shown.length === 0) return null;
  return (
    <section
      aria-label="Edited on the old Risk Register page"
      className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-4"
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
        <History className="h-4 w-4 text-warning" aria-hidden="true" />
        {shown.length === 1
          ? "One value was edited on the old Risk Register page"
          : `${shown.length} values were edited on the old Risk Register page`}
      </h2>
      <p className="text-xs text-sub">
        The register kept the value under &ldquo;In the register now&rdquo;. Keep it, or use the old
        page&apos;s value instead.
      </p>
      <ul className="space-y-3">
        {shown.map((c) => {
          const r = records.find((x) => x.id === c.id)!;
          return (
            <li
              key={`${c.id}-${c.field}`}
              className="space-y-2 rounded-md border border-border bg-card p-3"
            >
              <p className="text-sm font-medium text-text">
                {r.title || "Untitled risk"}
                <span className="font-normal text-sub"> · {FIELD_LABEL[c.field]}</span>
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="min-w-0">
                  <p className="text-xs text-sub">In the register now</p>
                  <p className="whitespace-pre-wrap break-words text-sm text-text">
                    {conflictText(c.field, c.workspace)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-sub">On the old page</p>
                  <p className="whitespace-pre-wrap break-words text-sm text-text">
                    {conflictText(c.field, c.blob)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`Keep the ${FIELD_LABEL[c.field].toLowerCase()} in the register: ${r.title}`}
                  onClick={() => onKeep(c)}
                >
                  Keep
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`Use the old page's ${FIELD_LABEL[c.field].toLowerCase()} instead: ${r.title}`}
                  onClick={() => onUseOld(c)}
                >
                  Use this instead
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Shown once, after the move: how many risks only the workspace held (the
 * old page never listed them) are now in the register, which is the one
 * store. Each can be deleted, with Undo, like any other risk.
 */
export function AppearedNotice({ count, onDismiss }: { count: number; onDismiss: () => void }) {
  if (count <= 0) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-start gap-3 rounded-lg border border-info/30 bg-info/10 px-4 py-2.5 text-sm text-text"
    >
      <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        {count === 1
          ? "1 risk the old register page didn't list is now in the register"
          : `${count} risks the old register page didn't list are now in the register`}
        : added by an agent, sent from a premortem, or deleted on the old page after a Push. Delete
        any you don&apos;t need; Undo brings it back.
      </p>
      <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
        <X aria-hidden="true" />
        Got it
      </Button>
    </div>
  );
}
