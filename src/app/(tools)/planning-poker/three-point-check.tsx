"use client";

/**
 * The host's Three-point check after Reveal (numeric decks only): a best,
 * likely and worst case picked from the deck, weighed into an expected size
 * and the card it rounds up to (lib/estimation/three-point). "Use {card}"
 * picks that card in Accept estimate; the host still presses Accept, so
 * there is one way to commit an estimate.
 *
 * The cases start from the lowest, middle and highest vote, and the label
 * asks the host to change them: votes show how far apart people are, not
 * how unsure each one is.
 */

import { useId, useState } from "react";
import { Calculator, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  cardAtOrAbove,
  formatPoints,
  numericCards,
  threePoint,
  threePointNote,
  validateThreePoint,
  type ThreePointDraft,
  type ThreePointField,
  type ThreePointStart,
} from "@/lib/estimation/three-point";

/** A native select sized like <Input>: 44px on touch, 36px for a mouse at md+. */
const SELECT_CLASS =
  "flex h-11 w-full min-w-0 rounded-md border border-input bg-card px-2 font-data text-base text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring pointer-fine:md:h-9 pointer-fine:md:text-sm";

const FIELDS: readonly { field: ThreePointField; label: string }[] = [
  { field: "optimistic", label: "Best case" },
  { field: "likely", label: "Likely" },
  { field: "pessimistic", label: "Worst case" },
];

export function ThreePointCheck({
  deck,
  start,
  onUse,
}: {
  deck: readonly string[];
  start: ThreePointStart;
  /** The host chose the card the check rounds up to. */
  onUse: (card: string, expected: number) => void;
}) {
  const id = useId();
  const panelId = `${id}-panel`;
  const errorId = (field: ThreePointField) => `${id}-${field}-error`;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ThreePointDraft>(() => ({ ...start }));
  const cards = numericCards(deck);

  const checked = validateThreePoint(draft);
  const result = checked.ok ? threePoint(checked.values) : null;
  const card = result ? cardAtOrAbove(deck, result.expected) : null;
  const errors: Partial<Record<ThreePointField, string>> = checked.ok ? {} : checked.errors;
  // Each case out of order has its own message (8, 5, 3 breaks both likely
  // and worst), and each select is described by its own.
  const failing = FIELDS.filter(({ field }) => errors[field]);

  return (
    <div className="rounded-lg border border-border bg-surface-deep">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Calculator className="h-4 w-4 shrink-0 text-sub" aria-hidden="true" />
        <span className="flex-1">Three-point check</span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-sub transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div id={panelId} className="space-y-3 border-t border-border p-3">
          <p className="text-xs text-sub">
            Starts from the lowest, middle and highest vote. Change them to the best, likely and
            worst case.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {FIELDS.map(({ field, label }) => (
              <div key={field} className="min-w-0 space-y-1">
                <label htmlFor={`${id}-${field}`} className="block text-xs text-sub">
                  {label}
                </label>
                <select
                  id={`${id}-${field}`}
                  className={SELECT_CLASS}
                  value={draft[field]}
                  aria-invalid={errors[field] ? true : undefined}
                  aria-describedby={errors[field] ? errorId(field) : undefined}
                  onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                >
                  {cards.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {failing.length > 0 && (
            <div role="alert" className="space-y-1">
              {failing.map(({ field }) => (
                <p key={field} id={errorId(field)} className="text-xs text-danger">
                  {errors[field]}
                </p>
              ))}
            </div>
          )}
          {/* The status line stays mounted while the panel is open, empty
              when the cases don't add up, so a screen reader reads the new
              size once they do (a live region inserted with its text often
              goes unread). */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p role="status" className="min-w-0 flex-1 basis-48 text-sm text-text">
              {result && card !== null && (
                <>
                  Expected{" "}
                  <span className="font-data font-bold">{formatPoints(result.expected)}</span>{" "}
                  points, about {formatPoints(result.low)} to {formatPoints(result.high)}: rounds up
                  to <span className="font-data font-bold">{card}</span>.{" "}
                  <span className="text-sub">{threePointNote(result)}</span>
                </>
              )}
            </p>
            {result && card !== null && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="pointer-coarse:min-h-11"
                onClick={() => onUse(card, result.expected)}
              >
                Use {card}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
