/**
 * Release Readiness's release-notes next step, appended to its eager rule
 * (lib/tools/next-steps.ts calls it with this argument): a release that
 * went out in the last 14 days, links the stories it shipped and has no
 * notes yet. It fires only when a release links stories, so a team that
 * never links any sees no change. Pure and light: no store, no React, no
 * "use client" module, nothing heavier than a date.
 */

import type { ReleaseReadiness, Story } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";
import { isExampleId } from "@/lib/utils/example-id";

/** A release shipped this many days ago or less is still worth notes. */
export const NOTES_STEP_DAYS = 14;

/** What the rule reads from the workspace. */
export interface ReleaseNotesStepsInput {
  /** The Release Readiness document, when there is one. */
  doc: ReleaseReadiness | undefined;
  /** The stories a release can link (example rows left out). */
  stories: readonly Story[];
  /** YYYY-MM-DD. */
  today: string;
}

/** `day` minus `n` days, YYYY-MM-DD (calendar maths in UTC, so no zone moves it). */
function daysBefore(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - n * 86_400_000).toISOString().slice(0, 10);
}

/** Release Readiness's release-notes steps: the newest such release only. */
export function releaseNotesSteps(s: ReleaseNotesStepsInput): NextStep[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.today)) return [];
  const since = daysBefore(s.today, NOTES_STEP_DAYS);
  const known = new Set(s.stories.map((x) => x.id));
  const due = (s.doc?.releases ?? [])
    .filter((r) => !isExampleId(r.id) && r.status === "shipped" && r.shippedDate)
    .filter((r) => {
      const day = (r.shippedDate as string).slice(0, 10);
      return day >= since && day <= s.today;
    })
    .filter((r) => (r.storyIds ?? []).some((id) => known.has(id)))
    .filter((r) => !r.releaseNotes?.text?.trim())
    .sort((a, b) => (b.shippedDate ?? "").localeCompare(a.shippedDate ?? ""))[0];
  if (!due) return [];
  const linked = (due.storyIds ?? []).filter((id) => known.has(id)).length;
  return [
    {
      id: "release-notes",
      label: `Write the release notes for ${due.name}`,
      detail: `It went out on ${(due.shippedDate as string).slice(0, 10)} with ${linked} ${
        linked === 1 ? "story" : "stories"
      } linked, and has no notes yet.`,
      href: "/release-readiness",
    },
  ];
}
