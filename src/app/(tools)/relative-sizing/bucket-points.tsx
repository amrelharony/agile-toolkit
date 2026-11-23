"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SIZING_LIMITS, type SizingBoard } from "@/lib/relative-sizing/state";

const without = (o: Record<string, string>, key: string) => {
  const out = { ...o };
  delete out[key];
  return out;
};

/**
 * "Map sizes to points": the points Save sizes writes for each bucket. A
 * T-shirt or letter set starts with none, so it opens by itself; a number
 * set starts with its numbers, which the team can change. A field saves
 * when it loses focus or on Enter, and an empty one clears the bucket's
 * points.
 */
export function BucketPoints({
  board,
  onSet,
}: {
  board: SizingBoard;
  /** A bucket's new points (undefined: none). */
  onSet: (bucketId: string, points: number | undefined) => void;
}) {
  const missing = board.buckets.filter((b) => b.points === undefined).length;
  const [open, setOpen] = useState(missing > 0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const panelId = useId();

  const forget = (id: string) => {
    setDrafts((d) => without(d, id));
    setErrors((e) => without(e, id));
  };
  const commit = (id: string) => {
    const raw = drafts[id];
    if (raw === undefined) return;
    const text = raw.trim();
    const points = text === "" ? undefined : Number(text);
    if (
      points !== undefined &&
      (!Number.isFinite(points) || points < 0 || points > SIZING_LIMITS.pointsMax)
    ) {
      setErrors((e) => ({ ...e, [id]: `Points go from 0 to ${SIZING_LIMITS.pointsMax}.` }));
      return;
    }
    onSet(id, points);
    forget(id);
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        Map sizes to points
        {missing > 0 && !open && (
          <span className="text-xs font-normal text-sub">
            ({missing} {missing === 1 ? "bucket has" : "buckets have"} none)
          </span>
        )}
      </Button>
      {open && (
        <fieldset id={panelId} className="space-y-2">
          <legend className="text-sm text-sub">
            The points each bucket writes to its stories. Leave one empty to skip it.
          </legend>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {board.buckets.map((b) => (
              <Field
                key={b.id}
                label={
                  <>
                    <span className="sr-only">Points for</span> {b.label}
                  </>
                }
                error={errors[b.id]}
                className="min-w-0"
              >
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={SIZING_LIMITS.pointsMax}
                    step="any"
                    value={drafts[b.id] ?? (b.points !== undefined ? String(b.points) : "")}
                    onChange={(e) => setDrafts((d) => ({ ...d, [b.id]: e.target.value }))}
                    onBlur={() => commit(b.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commit(b.id);
                      }
                    }}
                  />
                )}
              </Field>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
