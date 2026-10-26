"use client";

import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Decision } from "@/lib/stores/workspace-types";
import type { DecisionLogConflict, DecisionLogTextField } from "@/lib/decisions/legacy-log";
import { decisionLabel } from "@/lib/decisions/model";

const FIELD_LABEL: Readonly<Record<DecisionLogTextField, string>> = {
  title: "Title",
  context: "Context",
  decision: "What was decided",
  consequences: "Consequences",
  alternatives: "Options considered",
};

const text = (v: string | string[]) => (Array.isArray(v) ? v.join("\n") : v);

/**
 * The record with the old Decision Log page's text for one field. For the
 * options, the old page's lines become the options (a choice still on one
 * of them is kept; one on an option that is gone is dropped).
 */
export function withOldText(d: Decision, c: DecisionLogConflict): Decision {
  if (c.field !== "alternatives") return { ...d, [c.field]: text(c.blob) };
  const lines = Array.isArray(c.blob) ? c.blob : [c.blob];
  const options = lines.map((t, i) => ({ id: `${d.id}-a${i}`, text: t }));
  const next: Decision = { ...d, alternatives: lines };
  if (d.options) next.options = options;
  const keep = (next.options ?? options).some((o) => o.id === d.chosenOptionId);
  if (!keep) delete next.chosenOptionId;
  return next;
}

/**
 * Shown once, after the move: records whose text differed between the old
 * Decision Log page (edited after a Push) and the workspace. The move kept
 * the workspace's; each field offers the old page's text instead, with
 * Undo. Once settled, or when the page is left, it isn't shown again: the
 * old text stays in the old page's storage as the backup.
 */
export function ConflictNotice({
  conflicts,
  records,
  onKeep,
  onUseOld,
}: {
  conflicts: readonly DecisionLogConflict[];
  records: readonly Decision[];
  onKeep: (c: DecisionLogConflict) => void;
  onUseOld: (c: DecisionLogConflict) => void;
}) {
  const shown = conflicts.filter((c) => records.some((d) => d.id === c.id));
  if (shown.length === 0) return null;
  return (
    <section
      aria-label="Edited on the old Decision Log page"
      className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-4"
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
        <History className="h-4 w-4 text-warning" aria-hidden="true" />
        {shown.length === 1
          ? "One record was edited on the old Decision Log page"
          : `${shown.length} fields were edited on the old Decision Log page`}
      </h2>
      <p className="text-xs text-sub">
        The log kept the text below on the left. Keep it, or use the old page&apos;s text instead.
      </p>
      <ul className="space-y-3">
        {shown.map((c) => {
          const d = records.find((x) => x.id === c.id)!;
          const name = `${decisionLabel(d)} · ${d.title || "Untitled"}`;
          return (
            <li
              key={`${c.id}-${c.field}`}
              className="space-y-2 rounded-md border border-border bg-card p-3"
            >
              <p className="text-sm font-medium text-text">
                This record was edited on the old Decision Log page: {name}
                <span className="font-normal text-sub"> · {FIELD_LABEL[c.field]}</span>
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="min-w-0">
                  <p className="text-xs text-sub">In the log now</p>
                  <p className="whitespace-pre-wrap break-words text-sm text-text">
                    {text(c.workspace)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-sub">On the old page</p>
                  <p className="whitespace-pre-wrap break-words text-sm text-text">
                    {text(c.blob)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => onKeep(c)}>
                  Keep this text
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => onUseOld(c)}>
                  Use the old text
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
