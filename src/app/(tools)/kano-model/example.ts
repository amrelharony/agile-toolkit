import { exampleId } from "@/lib/utils/example-id";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { methodRow } from "@/lib/prioritization/binding";
import type { Values } from "@/lib/prioritization/methods";
import { KANO_CLASSES, KANO_COUNT_KEYS, type KanoCounts } from "@/lib/prioritization/methods/kano";
import { FRAMEWORK } from "./model";

const counts = (c: KanoCounts): Values =>
  Object.fromEntries(KANO_CLASSES.map((k) => [KANO_COUNT_KEYS[k], c[k]]));

/**
 * A task app's customer survey: single sign-on that customers expect
 * (Must-be), fast search that pays back the better it gets (Performance),
 * a dark mode that delights (Attractive), an onboarding tour nobody minds
 * (Indifferent), sound effects whose answers contradict each other
 * (Questionable: a question to reword), and a CSV export with one
 * person's answers so far.
 */
const FEATURES: [string, Values][] = [
  ["Single sign-on with Okta", counts({ A: 1, O: 3, M: 9, I: 2, R: 0, Q: 0 })],
  ["Search results in under a second", counts({ A: 2, O: 8, M: 3, I: 2, R: 0, Q: 1 })],
  ["Dark mode", counts({ A: 10, O: 2, M: 0, I: 4, R: 1, Q: 0 })],
  ["Animated onboarding tour", counts({ A: 2, O: 0, M: 1, I: 11, R: 2, Q: 0 })],
  ["Sound effects when a task is done", counts({ A: 1, O: 0, M: 0, I: 2, R: 2, Q: 5 })],
  ["Export the board to CSV", { functional: "must", dysfunctional: "dislike" }],
];

/** The example features (example- ids: Clear example removes exactly these). */
export function buildExample(now: Date = new Date()): PrioritizationItem[] {
  const at = now.toISOString();
  return FEATURES.map(([title, values], i) =>
    methodRow({ id: exampleId(`kano-${i + 1}`), framework: FRAMEWORK, title, values, now: at })
  );
}
