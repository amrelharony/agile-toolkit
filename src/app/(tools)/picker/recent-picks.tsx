"use client";

/**
 * The last thirty picks, newest first: spins, rolls, flips, numbers and role
 * turns, with what each came from. Clearing them offers Undo.
 */

import { CaseUpper, Coins, Dices, Disc3, Eraser, Hash, HelpCircle, UserCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { timeAgo, type PickKind, type PickerRecent } from "@/lib/picker/model";

const ICON: Record<PickKind, LucideIcon> = {
  wheel: Disc3,
  dice: Dices,
  coin: Coins,
  "yes-no": HelpCircle,
  number: Hash,
  letter: CaseUpper,
  role: UserCheck,
};

const KIND_LABEL: Record<PickKind, string> = {
  wheel: "Spin",
  dice: "Dice",
  coin: "Coin",
  "yes-no": "Yes or no",
  number: "Number",
  letter: "Letter",
  role: "Role",
};

export function RecentPicks({
  recent,
  now,
  onClear,
}: {
  recent: readonly PickerRecent[];
  now: Date;
  onClear: () => void;
}) {
  return (
    <section
      aria-labelledby="picker-recent-heading"
      className="space-y-2 rounded-lg border border-border bg-card p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="picker-recent-heading" className="text-base font-semibold text-text">
          Recent picks
        </h2>
        {recent.length > 0 && (
          <Button type="button" size="sm" variant="ghost" className="gap-1.5" onClick={onClear}>
            <Eraser aria-hidden="true" />
            Clear
          </Button>
        )}
      </div>
      {recent.length === 0 ? (
        <p className="text-sm text-sub">
          Nothing picked yet. Every spin, roll and flip lands here.
        </p>
      ) : (
        <ul className="divide-y divide-rule">
          {recent.map((r) => {
            const Icon = ICON[r.kind];
            return (
              <li key={r.id} className="flex items-center gap-3 py-1.5">
                <Icon className="h-4 w-4 shrink-0 text-sub" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text">
                    <span className="sr-only">{KIND_LABEL[r.kind]}: </span>
                    <span className="font-medium">{r.result}</span>
                    {r.detail && <span className="text-sub"> · {r.detail}</span>}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-sub">{timeAgo(r.at, now)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
