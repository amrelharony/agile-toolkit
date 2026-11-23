"use client";

/**
 * The guide's Three-point check: type a best, likely and worst case and see
 * the expected size, its spread, and on a points scale the card it rounds up
 * to (lib/estimation/three-point), or that it's past the largest card and
 * wants splitting. Nothing is saved and the export doesn't change: it's a
 * quick sum for a story the team is unsure about. Planning Poker's host
 * gets the same check after Reveal, starting from the votes.
 */

import { useId, useState } from "react";
import { Calculator, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { EstimationScale } from "@/lib/constants/scales";
import { cn } from "@/lib/utils";
import {
  THREE_POINT_MAX,
  cardAtOrAbove,
  formatPoints,
  isAboveDeck,
  numericCards,
  threePoint,
  threePointNote,
  validateThreePoint,
  type ThreePointDraft,
  type ThreePointField,
} from "@/lib/estimation/three-point";

const FIELDS: readonly { field: ThreePointField; label: string }[] = [
  { field: "optimistic", label: "Best case" },
  { field: "likely", label: "Likely" },
  { field: "pessimistic", label: "Worst case" },
];

const EMPTY: ThreePointDraft = { optimistic: "", likely: "", pessimistic: "" };

export function ThreePointCard({ scale }: { scale: EstimationScale }) {
  const id = useId();
  const panelId = `${id}-panel`;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ThreePointDraft>(EMPTY);
  // A field says what's wrong once it has been typed in or left.
  const [touched, setTouched] = useState<Partial<Record<ThreePointField, true>>>({});

  const checked = validateThreePoint(draft);
  const result = checked.ok ? threePoint(checked.values) : null;
  const errors = checked.ok ? {} : checked.errors;
  const deck = scale.values.map(String);
  const numeric = numericCards(deck).length > 0;
  const card = result && numeric ? cardAtOrAbove(deck, result.expected) : null;
  // Past the largest card the top card would understate it: say so instead.
  const pastDeck = result !== null && isAboveDeck(deck, result.expected);

  return (
    <section
      aria-label="Three-point check"
      className="mb-6 rounded-lg border border-border bg-card"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg px-4 text-left text-sm font-medium text-text hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Calculator className="h-4 w-4 shrink-0 text-sub" aria-hidden="true" />
        <span className="flex-1">Three-point check</span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-sub transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div id={panelId} className="space-y-3 border-t border-border p-4">
          <p className="text-xs text-sub">
            For a story the team is unsure about: type the best, likely and worst case in points.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {FIELDS.map(({ field, label }) => {
              const error = touched[field] ? errors[field] : undefined;
              const errorId = `${id}-${field}-error`;
              return (
                <div key={field} className="min-w-0 space-y-1">
                  <label htmlFor={`${id}-${field}`} className="block text-xs text-sub">
                    {label}
                  </label>
                  <Input
                    id={`${id}-${field}`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={THREE_POINT_MAX}
                    step="any"
                    value={draft[field]}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    onChange={(e) => {
                      const value = e.target.value;
                      setDraft((d) => ({ ...d, [field]: value }));
                      if (value.trim() !== "") setTouched((t) => ({ ...t, [field]: true }));
                    }}
                    onBlur={() => setTouched((t) => ({ ...t, [field]: true }))}
                    className="font-data"
                  />
                  {error && (
                    <p id={errorId} className="text-xs text-danger">
                      {error}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <p role="status" className="text-sm text-text">
            {result && (
              <>
                Expected{" "}
                <span className="font-data font-bold">{formatPoints(result.expected)}</span> points,
                about {formatPoints(result.low)} to {formatPoints(result.high)}.{" "}
                {card !== null && pastDeck ? (
                  <>
                    That&rsquo;s more than the largest card on the {scale.name} scale (
                    <span className="font-data font-bold">{card}</span>): split the story.
                  </>
                ) : card !== null ? (
                  <>
                    On the {scale.name} scale that&rsquo;s{" "}
                    <span className="font-data font-bold">{card}</span>.
                  </>
                ) : (
                  "Pick a numeric scale to see the card."
                )}{" "}
                <span className="text-sub">{threePointNote(result)}</span>
              </>
            )}
          </p>
        </div>
      )}
    </section>
  );
}
