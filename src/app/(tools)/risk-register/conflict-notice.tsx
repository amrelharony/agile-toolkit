"use client";

import { useRef } from "react";
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
 * The field as the register holds it now, read as the move compared it: a
 * rating on the 1–5 scale, or the trimmed text; null when it holds nothing.
 */
export function currentValue(r: Risk, field: RiskConflictField): string | number | null {
  if (field === "probability" || field === "impact") return toScale(r[field]);
  const v = r[field];
  return typeof v === "string" && v.trim() ? v.trim() : null;
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
 *
 * "In the register now" is read from the register as it is, not as the
 * move found it: a value edited on the row (or by an agent) while the
 * notice is open shows here, so "Use this instead" never overwrites a
 * value the team can't see, and one that now matches the old page's has
 * nothing left to choose and goes. Settling one moves focus to the next,
 * or to `afterLast()` once none is left, never to the page's body.
 */
export function ConflictNotice({
  conflicts,
  records,
  onKeep,
  onUseOld,
  afterLast,
}: {
  conflicts: readonly RiskRegisterConflict[];
  records: readonly Risk[];
  onKeep: (c: RiskRegisterConflict) => void;
  onUseOld: (c: RiskRegisterConflict) => void;
  /** Where focus goes once the last conflict is settled. */
  afterLast: () => HTMLElement | null;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const shown = conflicts.flatMap((c) => {
    const r = records.find((x) => x.id === c.id);
    const now = r ? currentValue(r, c.field) : null;
    return r && now !== c.blob ? [{ c, r, now }] : [];
  });
  if (shown.length === 0) return null;

  // The pressed button goes with its conflict: once React has re-rendered,
  // focus the Keep of the one that took its place (or the new last one).
  const settle = (act: (c: RiskRegisterConflict) => void, c: RiskRegisterConflict, at: number) => {
    act(c);
    requestAnimationFrame(() => {
      const keeps = listRef.current?.querySelectorAll<HTMLElement>("[data-conflict-keep]");
      const next = keeps && keeps.length > 0 ? keeps[Math.min(at, keeps.length - 1)] : null;
      (next ?? afterLast())?.focus();
    });
  };
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
      <ul ref={listRef} className="space-y-3">
        {shown.map(({ c, r, now }, at) => (
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
                  {now === null ? "Empty" : conflictText(c.field, now)}
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
                data-conflict-keep=""
                aria-label={`Keep the ${FIELD_LABEL[c.field].toLowerCase()} in the register: ${r.title}`}
                onClick={() => settle(onKeep, c, at)}
              >
                Keep
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                // Starts with the visible text, so a voice-control user can say what they see.
                aria-label={`Use this instead: the old page's ${FIELD_LABEL[c.field].toLowerCase()} for ${r.title}`}
                onClick={() => settle(onUseOld, c, at)}
              >
                Use this instead
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** How many of the risks that appeared the notice names; the rest are counted. */
export const APPEARED_NAMED = 5;

/**
 * Shown once, after the move: the risks only the workspace held (the old
 * page never listed them) that are now in the register, which is the one
 * store, each named with a link to its row so the team can find it among
 * the others. Each can be deleted, with Undo, like any other risk; one
 * deleted leaves the notice, which goes once none is left.
 */
export function AppearedNotice({
  risks,
  onDismiss,
}: {
  risks: readonly Pick<Risk, "id" | "title">[];
  onDismiss: () => void;
}) {
  const count = risks.length;
  if (count <= 0) return null;
  const named = risks.slice(0, APPEARED_NAMED);
  const more = count - named.length;
  return (
    <div
      role="status"
      className="flex flex-wrap items-start gap-3 rounded-lg border border-info/30 bg-info/10 px-4 py-2.5 text-sm text-text"
    >
      <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <p>
          {count === 1
            ? "1 risk the old register page didn't list is now in the register"
            : `${count} risks the old register page didn't list are now in the register`}
          : added by an agent, sent from a premortem, or deleted on the old page after a Push.
          Delete any you don&apos;t need; Undo brings it back.
        </p>
        <ul aria-label="Now in the register" className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {named.map((r) => (
            <li key={r.id} className="min-w-0 max-w-full">
              <a
                href={`#risk-${r.id}`}
                className="break-words underline underline-offset-2 hover:text-accent"
              >
                {r.title.trim() || "Untitled risk"}
              </a>
            </li>
          ))}
          {more > 0 && <li className="text-sub">and {more} more</li>}
        </ul>
      </div>
      <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
        <X aria-hidden="true" />
        Got it
      </Button>
    </div>
  );
}
