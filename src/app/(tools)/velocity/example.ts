import { exampleId } from "@/components/tool-frame/example-data";
import type { Sprint } from "./markdown";

/**
 * The example sprints a first visit opens on; Reset and "Load an example"
 * bring them back. Sprint 1 overcommits, Sprint 2 beats a smaller
 * commitment, Sprint 3 lands just short: an average near 32 and a
 * predictability of one in three.
 *
 * The ids are fixed, so server and client render the same DOM, and start
 * with `example-`, so "Clear example" removes exactly these rows. They are
 * never bridged into the workspace as real history while untouched (see
 * isUntouchedSeedSprint in the client).
 */
export function buildExampleSprints(): Sprint[] {
  return [
    { id: exampleId("sprint-1"), name: "Sprint 1", committed: 34, completed: 28 },
    { id: exampleId("sprint-2"), name: "Sprint 2", committed: 30, completed: 32 },
    { id: exampleId("sprint-3"), name: "Sprint 3", committed: 36, completed: 35 },
  ];
}
