"use client";

import { useState } from "react";
import { History, Pencil, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { ResetButton } from "@/components/shared/reset-button";
import { ResortChip } from "@/components/shared/resort-chip";
import { SectionCard } from "@/components/shared/section-card";
import { LoadExampleButton } from "@/components/tool-frame/example-data";
import { IconButton } from "@/components/ui/icon-button";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { useStableOrder } from "@/hooks/use-stable-order";
import { icebreakers } from "@/lib/constants/icebreakers";
import { plural } from "@/lib/charts/chart-text";
import { RECENT_DAYS, daysAgo, daysAgoText } from "../filter";
import type { IcebreakerUse } from "../store";
import { dayOfUse } from "../uses";
import { MarkUsedForm } from "./featured-card";

const nameOf = new Map(icebreakers.map((ib) => [ib.id, ib.name]));
const newestFirst = (a: IcebreakerUse, b: IcebreakerUse) =>
  Date.parse(b.usedAt) - Date.parse(a.usedAt);
const keyOf = (u: IcebreakerUse) => u.id;

/** "22 Oct 2026" */
const dayText = (usedAt: string) =>
  new Date(usedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/**
 * The team's icebreaker history, newest first: what the "used recently"
 * filter reads. Each use can be re-dated or removed (with Undo), and the
 * whole history cleared behind a confirm (with Undo too).
 */
export function RecentlyUsed({
  uses,
  now,
  today,
  canLoadExample,
  onLoadExample,
  onSelect,
  onChangeDate,
  onRemove,
  onClear,
  onRestore,
}: {
  uses: readonly IcebreakerUse[];
  now: Date;
  today: string;
  /** Offer the example: only on a page nobody has used yet. */
  canLoadExample: boolean;
  onLoadExample: () => void;
  onSelect: (icebreakerId: string) => void;
  onChangeDate: (use: IcebreakerUse, usedAt: string) => void;
  onRemove: (use: IcebreakerUse) => void;
  onClear: () => void;
  onRestore: (uses: IcebreakerUse[]) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const { refFor, returnTo } = useReturnFocus();
  // A re-dated use stays where it was until Re-sort, so the row being
  // edited doesn't jump away.
  const { ordered, isStale, resort } = useStableOrder(uses, keyOf, newestFirst);

  if (uses.length === 0) {
    return (
      <EmptyState
        icon={History}
        action={canLoadExample ? <LoadExampleButton onLoad={onLoadExample} /> : undefined}
      >
        No icebreakers used yet. Start one&apos;s timer or mark it as used, and the picker can skip
        what the team did in the last {RECENT_DAYS / 7} weeks.
      </EmptyState>
    );
  }

  const close = (id: string) => {
    setEditingId(null);
    returnTo(`edit:${id}`);
  };

  return (
    <SectionCard
      title={`Recently used (${uses.length})`}
      icon={History}
      actions={
        <ResetButton
          label="Clear history"
          title="Clear the icebreaker history?"
          description={`Forget ${plural(uses.length, "recorded use")}. Favorites stay.`}
          confirmLabel="Clear history"
          doneLabel="Cleared the icebreaker history"
          // Both run from the toast with the list as it was when confirmed.
          onReset={onClear}
          onUndo={() => onRestore([...uses])}
        />
      }
    >
      <ResortChip isStale={isStale} onResort={resort} what="Dates" />
      <ul className="divide-y divide-border" aria-label="Icebreakers used, newest first">
        {ordered.map((u) => {
          const name = nameOf.get(u.icebreakerId) ?? u.icebreakerId;
          const recent = daysAgo(u.usedAt, now) < RECENT_DAYS;
          return (
            <li key={u.id} className="py-2.5">
              {editingId === u.id ? (
                <MarkUsedForm
                  today={today}
                  initialDay={dayOfUse(u.usedAt)}
                  submitLabel="Save date"
                  onSave={(usedAt) => {
                    onChangeDate(u, usedAt);
                    close(u.id);
                  }}
                  onCancel={() => close(u.id)}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <button
                    type="button"
                    onClick={() => onSelect(u.icebreakerId)}
                    className="min-w-0 flex-1 basis-40 text-left text-sm font-medium text-text hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                  >
                    {name}
                  </button>
                  <span className="text-xs text-sub">
                    {dayText(u.usedAt)} · {daysAgoText(u.usedAt, now)}
                    {recent && <span className="sr-only"> (recent)</span>}
                  </span>
                  <span className="flex shrink-0 items-center">
                    <IconButton
                      ref={refFor(`edit:${u.id}`)}
                      label={`Change the date of ${name}`}
                      icon={<Pencil className="h-4 w-4" />}
                      className="text-sub hover:text-text"
                      onClick={() => setEditingId(u.id)}
                    />
                    <IconButton
                      label={`Remove ${name} from the history`}
                      icon={<Trash2 className="h-4 w-4" />}
                      className="text-sub hover:text-danger"
                      onClick={() => onRemove(u)}
                    />
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
