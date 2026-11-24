"use client";

/**
 * A Shape Up pitch's appetite: how much time the problem is worth, the
 * budget its solution is shaped to fit (not an estimate). Chips for one,
 * two and six weeks, or another whole number of weeks up to twelve.
 */

import { useState } from "react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PRODUCT_CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { APPETITE_CHIPS, WEEKS_MAX } from "@/lib/product-canvas/fields";
import { withAppetite } from "@/lib/product-canvas/model";
import type { CanvasHandle } from "../boxes";

const weeksText = (n: number) => `${n} ${n === 1 ? "week" : "weeks"}`;

export function AppetitePanel({ handle }: { handle: CanvasHandle }) {
  const { canvas, write, log } = handle;
  const weeks = canvas.appetiteWeeks;
  const [other, setOther] = useState(
    weeks !== undefined && !APPETITE_CHIPS.includes(weeks) ? String(weeks) : ""
  );
  const [problem, setProblem] = useState<string | null>(null);

  const set = (next: number | null) => {
    if (next === (weeks ?? null)) return;
    const w = write((c, now) => withAppetite(c, next, now));
    if (!w.ok) {
      setProblem(w.message);
      return;
    }
    setProblem(null);
    log(PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED, { canvasId: canvas.id, field: "appetite" });
  };
  const commitOther = () => {
    const text = other.trim();
    if (!text) return;
    const n = Number(text);
    set(Number.isFinite(n) ? n : NaN);
  };

  return (
    <SectionCard title="Appetite" contentClassName="space-y-2">
      <p className="text-sm text-sub">
        How much time this problem is worth: the budget the solution is shaped to fit, not an
        estimate of the work.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div role="group" aria-label="Appetite" className="flex flex-wrap gap-2">
          {APPETITE_CHIPS.map((n) => (
            <Button
              key={n}
              type="button"
              size="sm"
              variant={weeks === n ? "toolkit" : "outline"}
              aria-pressed={weeks === n}
              onClick={() => {
                setOther("");
                set(n);
              }}
            >
              {weeksText(n)}
            </Button>
          ))}
        </div>
        <Field label="Other, in weeks" hint={`1 to ${WEEKS_MAX}`} className="w-32">
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={1}
              max={WEEKS_MAX}
              value={other}
              onChange={(e) => setOther(e.target.value)}
              onBlur={commitOther}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitOther();
                }
              }}
            />
          )}
        </Field>
        {weeks !== undefined && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setOther("");
              set(null);
            }}
          >
            Clear
          </Button>
        )}
      </div>
      <p className="text-sm text-text" data-field="appetite">
        {weeks !== undefined ? `Appetite: ${weeksText(weeks)}.` : "No appetite set yet."}
      </p>
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
    </SectionCard>
  );
}
