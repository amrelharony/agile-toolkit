/**
 * Example Mapping's next steps (lib/example-mapping/next-steps): open
 * questions first, a ready map not on its story yet, then a sent story
 * with no size; the example's maps never count, and nothing applies to a
 * quiet workspace.
 */

import { describe, expect, it } from "vitest";
import { exampleMappingSteps } from "@/lib/example-mapping/next-steps";
import { getNextStepRule, loadNextStepRule } from "@/lib/tools/next-steps";
import {
  emptyWorkspace,
  type ExampleMap,
  type Story,
  type Workspace,
} from "@/lib/stores/workspace-types";

const map = (over: Partial<ExampleMap> = {}): ExampleMap => ({
  id: "exmap_a",
  title: "Pay with a saved card",
  rules: [{ id: "r1", text: "Expired cards are refused" }],
  examples: [],
  questions: [],
  createdAt: "2026-11-20T09:00:00.000Z",
  updatedAt: "2026-11-20T09:00:00.000Z",
  ...over,
});
const story = (over: Partial<Story> = {}): Story => ({
  id: "st1",
  title: "Pay with a saved card",
  status: "backlog",
  ...over,
});
const ids = (s: { id: string }[]) => s.map((x) => x.id);

describe("exampleMappingSteps", () => {
  it("says nothing with no maps", () => {
    expect(exampleMappingSteps({ maps: undefined, stories: [] })).toEqual([]);
  });

  it("points at the newest map with open questions, by its id", () => {
    const steps = exampleMappingSteps({
      maps: [
        map({ id: "exmap_old", questions: [{ id: "q", text: "?", status: "open" }] }),
        map({
          id: "exmap_new",
          title: "Refund a payment",
          updatedAt: "2026-11-21T09:00:00.000Z",
          questions: [
            { id: "q1", text: "Who?", status: "open" },
            { id: "q2", text: "When?", status: "open" },
          ],
        }),
      ],
      stories: [],
    });
    expect(steps[0]).toMatchObject({
      id: "example-mapping-answer-questions",
      label: "Answer the 2 open questions on “Refund a payment”",
      href: "/example-mapping?map=exmap_new",
    });
  });

  it("asks to send a ready map's examples to its story, then to size the sent story", () => {
    const ready = map({
      storyId: "st1",
      verdict: "ready",
      examples: [{ id: "e1", ruleId: "r1", text: "A", given: "g", when: "w", then: "t" }],
    });
    expect(ids(exampleMappingSteps({ maps: [ready], stories: [story()] }))).toEqual([
      "example-mapping-send-to-story",
    ]);
    const sent = { ...ready, sentAt: "2026-11-21T09:00:00.000Z" };
    const withGwt = story({ gwt: [{ id: "g", given: "g", when: "w", then: "t" }] });
    expect(ids(exampleMappingSteps({ maps: [sent], stories: [withGwt] }))).toEqual([
      "example-mapping-size-story",
    ]);
    expect(exampleMappingSteps({ maps: [sent], stories: [{ ...withGwt, points: 3 }] })).toEqual([]);
  });

  it("leaves the example's maps and done stories out", () => {
    expect(
      exampleMappingSteps({
        maps: [map({ id: "example-map", questions: [{ id: "q", text: "?", status: "open" }] })],
        stories: [],
      })
    ).toEqual([]);
    const sent = map({ storyId: "st1", sentAt: "2026-11-21T09:00:00.000Z" });
    expect(exampleMappingSteps({ maps: [sent], stories: [story({ status: "done" })] })).toEqual([]);
  });

  it("is the rule next-steps.ts runs for the page", async () => {
    await loadNextStepRule("example-mapping");
    const rule = getNextStepRule("example-mapping")!;
    const ws = {
      ...emptyWorkspace,
      exampleMaps: [map({ questions: [{ id: "q", text: "?", status: "open" }] })],
    } as Workspace;
    expect(ids(rule.steps(rule.select(ws)))).toEqual(["example-mapping-answer-questions"]);
  });
});
