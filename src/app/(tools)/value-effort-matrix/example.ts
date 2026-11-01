import { exampleId } from "@/lib/utils/example-id";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { methodRow } from "@/lib/prioritization/binding";
import { FRAMEWORK } from "./model";

/**
 * A product team's next-quarter candidates for a task-tracking app. Two
 * Quick Wins (saved filters, triage shortcuts), two Big Bets worth planning
 * (offline mobile, SSO), a Fill-In, two Time Wasters and one idea still to
 * place, so every quadrant and the tray have something in them.
 */
const ROWS: [string, { value: number; effort: number } | null][] = [
  ["Saved filters on the board", { value: 13, effort: 3 }],
  ["Keyboard shortcuts for triage", { value: 8, effort: 2 }],
  ["Offline mode for the mobile app", { value: 20, effort: 9 }],
  ["Single sign-on with Okta and Entra ID", { value: 13, effort: 7 }],
  ["Rename “Archive” to “Close” in menus", { value: 2, effort: 1 }],
  ["Custom colour themes per workspace", { value: 3, effort: 8 }],
  ["Rebuild the reporting engine", { value: 5, effort: 10 }],
  ["Slack digest of overdue tasks", null],
];

/** The example rows (example- ids: Clear example removes exactly these). */
export function buildExample(now: Date = new Date()): PrioritizationItem[] {
  const at = now.toISOString();
  return ROWS.map(([title, place], i) =>
    methodRow({
      id: exampleId(`ve-${i + 1}`),
      framework: FRAMEWORK,
      title,
      values: place ? { value: place.value, effort: place.effort } : {},
      now: at,
    })
  );
}
