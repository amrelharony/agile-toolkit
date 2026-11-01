"use client";

import { useRef } from "react";
import { History, Inbox, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toScale } from "@/lib/risks/model";
import type { TechDebtItem } from "@/lib/stores/workspace-types";
import type { TechDebtConflict, TechDebtConflictField } from "@/lib/tech-debt/legacy";
import { INTEREST_RATE_MAX } from "@/lib/tech-debt/model";
import { DEBT_EFFORT_STEPS, DEBT_IMPACT_STEPS } from "./scales";

const FIELD_LABEL: Readonly<Record<TechDebtConflictField, string>> = {
  title: "Title",
  description: "Description",
  area: "Area",
  impact: "Impact",
  effort: "Effort",
  interestRate: "Interest per sprint",
};

/** A conflict's value as the page shows it: a rating with what it means, the rate, or the text. */
export function conflictText(field: TechDebtConflictField, v: string | number): string {
  if (field === "impact" || field === "effort") {
    const steps = field === "impact" ? DEBT_IMPACT_STEPS : DEBT_EFFORT_STEPS;
    const n = toScale(v);
    const meaning = steps.find((s) => s.value === n)?.meaning;
    return meaning ? `${n} (${meaning})` : String(v);
  }
  if (field === "interestRate") return `${v} a sprint`;
  return String(v);
}

/**
 * The field as the tracker holds it now, read as the move compared it: a
 * rating on the 1–5 scale, a rate in 0–100, or the trimmed text; null when
 * it holds nothing.
 */
export function currentValue(
  t: TechDebtItem,
  field: TechDebtConflictField
): string | number | null {
  if (field === "impact" || field === "effort") return toScale(t[field]);
  if (field === "interestRate") {
    const r = t.interestRate;
    return typeof r === "number" && Number.isFinite(r)
      ? Math.max(0, Math.min(INTEREST_RATE_MAX, r))
      : null;
  }
  const v = t[field];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * The item with the old Tech Debt page's value for one field: a rating on
 * the 1–5 scale, a rate in 0–100 (as the move compared them), else the
 * text.
 */
export function withBlobValue(t: TechDebtItem, c: TechDebtConflict): TechDebtItem {
  if (c.field === "impact" || c.field === "effort") {
    const n = toScale(c.blob);
    return n === null ? t : { ...t, [c.field]: n };
  }
  if (c.field === "interestRate") {
    const n = Number(c.blob);
    return Number.isFinite(n)
      ? { ...t, interestRate: Math.max(0, Math.min(INTEREST_RATE_MAX, n)) }
      : t;
  }
  return { ...t, [c.field]: String(c.blob) };
}

/**
 * Shown once, after the move: items whose values differed between the
 * old Tech Debt page (edited after a Push) and the workspace (an agent's
 * edit). The move kept the workspace's; each field offers the old page's
 * value with "Use this instead" (with Undo) or "Keep". The old value stays
 * in the old page's storage, the backup.
 *
 * "In the tracker now" is read from the tracker as it is, not as the move
 * found it: a value edited on the row (or by an agent) while the notice is
 * open shows here, so "Use this instead" never overwrites a value the team
 * can't see, and one that now matches the old page's has nothing left to
 * choose and goes. Settling one moves focus to the next, or to
 * `afterLast()` once none is left, never to the page's body.
 */
export function ConflictNotice({
  conflicts,
  records,
  onKeep,
  onUseOld,
  afterLast,
}: {
  conflicts: readonly TechDebtConflict[];
  records: readonly TechDebtItem[];
  onKeep: (c: TechDebtConflict) => void;
  onUseOld: (c: TechDebtConflict) => void;
  /** Where focus goes once the last conflict is settled. */
  afterLast: () => HTMLElement | null;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const shown = conflicts.flatMap((c) => {
    const t = records.find((x) => x.id === c.id);
    const now = t ? currentValue(t, c.field) : null;
    return t && now !== c.blob ? [{ c, t, now }] : [];
  });
  if (shown.length === 0) return null;

  // The pressed button goes with its conflict: once React has re-rendered,
  // focus the Keep of the one that took its place (or the new last one).
  const settle = (act: (c: TechDebtConflict) => void, c: TechDebtConflict, at: number) => {
    act(c);
    requestAnimationFrame(() => {
      const keeps = listRef.current?.querySelectorAll<HTMLElement>("[data-conflict-keep]");
      const next = keeps && keeps.length > 0 ? keeps[Math.min(at, keeps.length - 1)] : null;
      (next ?? afterLast())?.focus();
    });
  };
  return (
    <section
      aria-label="Edited on the old Tech Debt page"
      className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-4"
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
        <History className="h-4 w-4 text-warning" aria-hidden="true" />
        {shown.length === 1
          ? "One value was edited on the old Tech Debt page"
          : `${shown.length} values were edited on the old Tech Debt page`}
      </h2>
      <p className="text-xs text-sub">
        The tracker kept the value under &ldquo;In the tracker now&rdquo;. Keep it, or use the old
        page&apos;s value instead.
      </p>
      <ul ref={listRef} className="space-y-3">
        {shown.map(({ c, t, now }, at) => {
          const field = FIELD_LABEL[c.field].toLowerCase();
          return (
            <li
              key={`${c.id}-${c.field}`}
              className="space-y-2 rounded-md border border-border bg-card p-3"
            >
              <p className="text-sm font-medium text-text">
                {t.title || "Untitled item"}
                <span className="font-normal text-sub"> · {FIELD_LABEL[c.field]}</span>
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="min-w-0">
                  <p className="text-xs text-sub">In the tracker now</p>
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
                  aria-label={`Keep the ${field} in the tracker: ${t.title}`}
                  onClick={() => settle(onKeep, c, at)}
                >
                  Keep
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  // Starts with the visible text, so a voice-control user can say what they see.
                  aria-label={`Use this instead: the old page's ${field} for ${t.title}`}
                  onClick={() => settle(onUseOld, c, at)}
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

/** How many of the items that appeared the notice names; the rest are counted. */
export const APPEARED_NAMED = 5;

/**
 * Shown once, after the move: the items only the workspace held (an
 * agent's; the old page never listed them) that are now on the page,
 * which is the one store, each named with a link to its row so the team
 * can find it among the others. Each can be deleted, with Undo, like any
 * other item; one deleted leaves the notice, which goes once none is left.
 */
export function AppearedNotice({
  items,
  onDismiss,
}: {
  items: readonly Pick<TechDebtItem, "id" | "title">[];
  onDismiss: () => void;
}) {
  const count = items.length;
  if (count <= 0) return null;
  const named = items.slice(0, APPEARED_NAMED);
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
            ? "1 item the old Tech Debt page didn't list is now here"
            : `${count} items the old Tech Debt page didn't list are now here`}
          : an agent added them to the workspace. Delete any you don&apos;t need; Undo brings it
          back.
        </p>
        <ul aria-label="Now on the page" className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {named.map((t) => (
            <li key={t.id} className="min-w-0 max-w-full">
              <a
                href={`#debt-${t.id}`}
                className="break-words underline underline-offset-2 hover:text-accent"
              >
                {t.title.trim() || "Untitled item"}
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
