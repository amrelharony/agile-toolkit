/**
 * The backlog's unsized stories: the batch Relative Sizing sizes together
 * (`/relative-sizing?stories=unsized`), and what Refinement's link and next
 * step count. Pure; imports only isExampleId. Relative Sizing's builder owns
 * it after the base, keeping these exports.
 */

import type { Story } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";

/** The fewest unsized stories worth sizing together rather than one by one. */
export const UNSIZED_BATCH_MIN = 5;

/**
 * The backlog's stories with no size yet: not done, in no sprint, with no
 * points, and not the example's. In backlog order.
 */
export function unsizedBacklog<S extends Story>(stories: readonly S[]): S[] {
  return stories.filter(
    (s) =>
      s.status !== "done" &&
      !s.sprintId &&
      (typeof s.points !== "number" || !Number.isFinite(s.points)) &&
      !isExampleId(s.id)
  );
}
