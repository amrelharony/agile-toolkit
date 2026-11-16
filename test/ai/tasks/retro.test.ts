// @vitest-environment node
/**
 * Golden tests for the Retro board's AI tasks: retro.surprise_plan (which
 * candidate format fits the sprint, and why) and retro.group_topics (Lean
 * Coffee topics that are the same). The prompt the server builds, a model
 * answer read, a bad one salvaged or refused, and the fallbacks.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import {
  fallbackSurprise,
  fallbackTopicGroups,
  groupTopicsTask,
  surprisePlanTask,
  type SurpriseInput,
} from "@/lib/ai/tasks/retro";
import { groupTopicsPrompt, surprisePlanPrompt } from "@/lib/ai/tasks/retro.server";

const sample = surprisePlanTask.input.parse(surprisePlanTask.sample);

describe("retro.surprise_plan", () => {
  it("is one short answer", () => {
    expect(surprisePlanTask).toMatchObject({ toolId: "retro", tier: "flash", maxTokens: 2048 });
  });

  it("gives the facts and the candidates as data, and asks for one candidate's id", () => {
    const system = buildTaskSystem(surprisePlanTask, surprisePlanPrompt);
    expect(system).toContain("Pick exactly one of the candidate formats, by its id");
    expect(system).toContain("never invent numbers");
    const user = buildTaskUser(surprisePlanPrompt, sample);
    expect(user).toContain("Sprint: Sprint 14");
    expect(user).toContain("Points: 26 of 34 done (say/do close)");
    expect(user).toContain("sailboat | Sailboat | Anchor, Wind, Rocks, Island");
    expect(user).toContain("Formats used lately (not candidates): Start / Stop / Continue");
  });

  it("says when there are no facts", () => {
    const user = buildTaskUser(surprisePlanPrompt, { ...sample, sprint: null, recent: [] });
    expect(user).toContain("No sprint facts.");
    expect(user).not.toContain("Formats used lately");
  });

  it("reads a typical answer and refuses one without a reason", () => {
    const parsed = parseAnswer(
      'Here you go: {"formatId": "4ls", "why": "The team learned a lot this sprint."}',
      surprisePlanTask.output
    );
    expect(parsed).toEqual({
      ok: true,
      data: { formatId: "4ls", why: "The team learned a lot this sprint." },
    });
    expect(parseAnswer('{"formatId": "4ls"}', surprisePlanTask.output).ok).toBe(false);
  });

  it("falls back to the format the facts call for, with its reason", () => {
    const out = fallbackSurprise(sample);
    expect(out.formatId).toBe("sailboat");
    expect(out.why).toContain("Sprint 14 partly met its goal");
    expect(out.why).toContain("Sailboat is built for that.");
  });

  it("falls back to the first candidate when the facts call for none, or for one that isn't a candidate", () => {
    const fine: SurpriseInput = {
      ...sample,
      sprint: { ...sample.sprint!, goal: "met", sayDo: "met", mood: 4.2 },
    };
    expect(fallbackSurprise(fine)).toMatchObject({ formatId: "sailboat" });
    expect(fallbackSurprise(fine).why).toMatch(/fresh way to look back on Sprint 14/);
    const lowMood: SurpriseInput = { ...sample, sprint: { ...sample.sprint!, mood: 2 } };
    // Mood calls for Mad / Sad / Glad, which isn't a candidate here.
    expect(fallbackSurprise(lowMood).formatId).toBe("sailboat");
    const none = fallbackSurprise({ ...sample, sprint: null, recent: [] });
    expect(none.why).toContain("the sprint: Anchor, Wind, Rocks, Island");
    expect(surprisePlanTask.output.safeParse(none).success).toBe(true);
  });
});

describe("retro.group_topics", () => {
  it("lists the topics by id with their votes", () => {
    const user = buildTaskUser(
      groupTopicsPrompt,
      groupTopicsTask.input.parse(groupTopicsTask.sample)
    );
    expect(user).toContain("t1 | 3 | Our standups run too long");
    expect(buildTaskSystem(groupTopicsTask, groupTopicsPrompt)).toContain(
      "a group has at least two topics"
    );
  });

  it("reads groups and drops one with a single topic", () => {
    const parsed = parseAnswer(
      JSON.stringify({
        groups: [
          { title: "Long standups", topicIds: ["t1", "t2"] },
          { title: "Alone", topicIds: ["t5"] },
        ],
      }),
      groupTopicsTask.output
    );
    expect(parsed).toEqual({
      ok: true,
      data: { groups: [{ title: "Long standups", topicIds: ["t1", "t2"] }] },
    });
  });

  it("groups topics that share a word without AI", () => {
    const groups = fallbackTopicGroups(groupTopicsTask.sample.topics);
    const ids = groups.map((g) => g.topicIds.slice().sort());
    expect(ids).toContainEqual(["t1", "t2"]);
    expect(ids).toContainEqual(["t3", "t4"]);
    expect(groups.flatMap((g) => g.topicIds)).not.toContain("t5");
    expect(groupTopicsTask.output.safeParse({ groups }).success).toBe(true);
  });

  it("groups two topics on a small board too, where no word can be called common", () => {
    expect(
      fallbackTopicGroups([
        { id: "a", text: "Standups run too long", votes: 1 },
        { id: "b", text: "Standups overrun daily", votes: 0 },
        { id: "c", text: "Release checklist", votes: 2 },
      ])
    ).toEqual([{ title: "Standups", topicIds: ["a", "b"] }]);
    expect(
      fallbackTopicGroups([
        { id: "a", text: "Standups", votes: 0 },
        { id: "b", text: "Release checklist", votes: 0 },
      ])
    ).toEqual([]);
  });
});
