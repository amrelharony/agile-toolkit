"use client";

import { Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { fmt } from "@/lib/charts/chart-text";
import type { MoodPulse } from "@/lib/stores/workspace-types";
import { MOOD_SCORES, pulseAverage, pulseTotal } from "@/lib/team/mood";
import { FACES } from "./faces";
import { shortDay } from "./verdict";

/**
 * The team's anonymous pulses, newest first: how many answered, the mean
 * face, the faces as a bar, and Delete with Undo. Counts only, as saved.
 */
export function PulseList({
  pulses,
  readOnly,
  onRemove,
}: {
  pulses: readonly MoodPulse[];
  readOnly: boolean;
  onRemove: (p: MoodPulse) => void;
}) {
  const sorted = [...pulses].sort(
    (a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
  );
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {sorted.map((p) => {
        const n = pulseTotal(p);
        const avg = pulseAverage(p);
        const what = `${shortDay(p.date)}: ${n} ${n === 1 ? "answer" : "answers"}`;
        return (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <span className="min-w-[6rem] text-text">{shortDay(p.date)}</span>
            <span className="text-xs text-sub">
              {n} {n === 1 ? "answer" : "answers"} · average {avg === null ? "—" : fmt(avg)}
              {p.source === "room" ? " · live round" : " · counted by hand"}
            </span>
            <span
              className="flex h-2.5 w-28 overflow-hidden rounded bg-card-hover"
              aria-hidden="true"
            >
              {MOOD_SCORES.map((s) => {
                const k = p.counts[s] ?? 0;
                const face = FACES.find((f) => f.score === s);
                return k > 0 ? (
                  <span key={s} className={face?.bg} style={{ width: `${(k / n) * 100}%` }} />
                ) : null;
              })}
            </span>
            <span className="sr-only">
              {MOOD_SCORES.map((s) => `${p.counts[s] ?? 0} ${FACES[s - 1].label}`).join(", ")}
            </span>
            <IconButton
              label={`Delete the pulse of ${what}`}
              icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
              disabled={readOnly}
              onClick={() => onRemove(p)}
              className="ml-auto"
            />
          </li>
        );
      })}
    </ul>
  );
}
