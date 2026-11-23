/**
 * Example Mapping's data-aware next steps (lib/tools/next-steps.ts calls
 * `exampleMappingSteps`). Newest map first, the example's maps left out, at
 * most one step of each kind:
 *   1. a map with open questions: answer them;
 *   2. a ready map whose examples aren't on its story yet: send them;
 *   3. a sent map whose story has no size: size it in Refinement.
 * Pure: no store, no React, no "use client" module.
 */

import type { ExampleMap, Story } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";
import { isExampleId } from "@/lib/utils/example-id";
import { EXAMPLE_MAPPING_PATH, newestFirst, readMaps, shortText } from "./model";

/** What the rule reads from the workspace. */
export interface ExampleMappingStepsInput {
  maps: readonly ExampleMap[] | undefined;
  stories: readonly Story[];
}

const mapHref = (id: string) => `${EXAMPLE_MAPPING_PATH}?map=${encodeURIComponent(id)}`;

const hasPoints = (s: Story) =>
  typeof s.points === "number" && Number.isFinite(s.points) && s.points > 0;

/** Example Mapping's next steps. */
export function exampleMappingSteps(s: ExampleMappingStepsInput): NextStep[] {
  const maps = newestFirst(readMaps(s.maps ?? []).filter((m) => !isExampleId(m.id)));
  const stories = new Map((s.stories ?? []).map((st) => [st.id, st]));
  const out: NextStep[] = [];

  const asking = maps.find((m) => m.questions.some((q) => q.status === "open"));
  if (asking) {
    const n = asking.questions.filter((q) => q.status === "open").length;
    out.push({
      id: "example-mapping-answer-questions",
      label: `Answer the ${n === 1 ? "open question" : `${n} open questions`} on “${shortText(asking.title)}”`,
      detail: "A story with open questions isn't ready to build.",
      href: mapHref(asking.id),
    });
  }

  const unsent = maps.find((m) => {
    if (m.verdict !== "ready" || !m.storyId) return false;
    const story = stories.get(m.storyId);
    if (!story || story.status === "done") return false;
    const structured = m.examples.some((e) => e.given && e.when && e.then);
    return !m.sentAt || (structured && !(story.gwt?.length ?? 0));
  });
  if (unsent) {
    out.push({
      id: "example-mapping-send-to-story",
      label: `Send “${shortText(unsent.title)}”'s examples to the story`,
      detail: "The map says it's ready: put its rules and examples on the story.",
      href: mapHref(unsent.id),
    });
  }

  const unsized = maps.find((m) => {
    if (!m.sentAt || !m.storyId) return false;
    const story = stories.get(m.storyId);
    return Boolean(story && story.status !== "done" && !hasPoints(story));
  });
  if (unsized) {
    out.push({
      id: "example-mapping-size-story",
      label: `Size “${shortText(unsized.title)}” in Refinement`,
      detail: "Its rules and examples are on the story, but it has no size yet.",
      href: "/refinement",
    });
  }
  return out;
}
