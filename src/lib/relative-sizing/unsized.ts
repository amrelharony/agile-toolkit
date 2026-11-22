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
 * The backlog's stories with no size yet: in the backlog (not started, in no
 * sprint), with no points above 0, and not the example's. In backlog order.
 * The same test as Refinement's isBacklogUnsized and the Sprint Cockpit's
 * "backlog stories to size", so a count from here matches the number those
 * pages show: a 0-point story still needs a size, and work already started
 * isn't sized here.
 */
export function unsizedBacklog<S extends Story>(stories: readonly S[]): S[] {
  return stories.filter(
    (s) =>
      !s.sprintId &&
      s.status === "backlog" &&
      !(typeof s.points === "number" && Number.isFinite(s.points) && s.points > 0) &&
      !isExampleId(s.id)
  );
}
