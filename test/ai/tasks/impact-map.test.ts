// @vitest-environment node
/**
 * The golden test for impact-map.draft: a canned model answer gives the
 * expected actors, a partial or crowded answer is salvaged and a bad one
 * refused (the page then offers the fallback), the fallback answers every
 * input with a valid draft, and the largest input fits the route's body.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import { TOOL_AI_BODY_BUDGET } from "@/lib/ai/contract";
import { jsonBytes } from "@/lib/utils/json-bytes";
import {
  GENERIC_ACTORS,
  IMPACT_DRAFT_ACTORS_MAX,
  fallbackImpactMap,
  impactMapDraftTask,
} from "@/lib/ai/tasks/impact-map";
import { impactMapDraftTask as ref } from "@/lib/ai/tasks/impact-map.lite";
import { impactMapDraftPrompt } from "@/lib/ai/tasks/impact-map.server";

const task = impactMapDraftTask;
const base = { context: "", personas: [], actors: [] };

describe("impact-map.draft", () => {
  it("is a reasoning task for the owner and visitors alike, with its ref's fallback", () => {
    expect(task).toMatchObject({
      id: "impact-map.draft",
      toolId: "impact-map",
      tier: "full",
      effort: "high",
      maxTokens: 8192,
    });
    expect(task.ownerOnly).toBeUndefined();
    expect(ref.fallback).toBe(task.fallback);
  });

  it("reads a typical model answer", () => {
    const answer = `Here is a draft:
\`\`\`json
{"actors": [
  {"name": "Busy parent", "persona": "Busy parent", "impacts": [
    {"text": "Skip a week instead of cancelling", "deliverables": ["Pause button", "Reminder email"]}
  ]},
  {"name": "Office lunch buyers", "impacts": [{"text": "Order for the team weekly", "deliverables": []}]}
]}
\`\`\``;
    const parsed = parseAnswer(answer, task.output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.actors).toHaveLength(2);
      expect(parsed.data.actors[0].persona).toBe("Busy parent");
      expect(parsed.data.actors[0].impacts[0].deliverables).toEqual([
        "Pause button",
        "Reminder email",
      ]);
      expect(parsed.data.actors[1].persona).toBeUndefined();
    }
  });

  it("salvages a crowded or partly broken answer, and refuses one with no actors", () => {
    const crowded = JSON.stringify({
      actors: [
        ...Array.from({ length: 7 }, (_, i) => ({
          name: i === 0 ? "x".repeat(300) : `Actor ${i}`,
          impacts: Array.from({ length: 5 }, (_, j) => ({
            text: `Impact ${j}`,
            deliverables: ["a", "b", "c", "d"],
          })),
        })),
        { name: "No impacts", impacts: [] },
      ],
    });
    const parsed = parseAnswer(crowded, task.output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.actors.length).toBeLessThanOrEqual(IMPACT_DRAFT_ACTORS_MAX);
      expect(parsed.data.actors[0].name.length).toBeLessThanOrEqual(120);
      for (const a of parsed.data.actors) {
        expect(a.impacts.length).toBeLessThanOrEqual(3);
        for (const i of a.impacts) expect(i.deliverables.length).toBeLessThanOrEqual(3);
      }
      expect(task.output.safeParse(parsed.data).success).toBe(true);
    }
    expect(parseAnswer('{"actors": []}', task.output).ok).toBe(false);
    expect(parseAnswer("I can't help with that.", task.output).ok).toBe(false);
  });

  it("falls back to the library's personas, else four kinds of people, three impacts each", () => {
    const withPersonas = fallbackImpactMap({
      ...base,
      goal: "Grow repeat orders by 20% by June.",
      personas: [
        { name: "Busy parent", role: "Cooks on weeknights" },
        { name: "Student", role: "Cooks on a budget" },
      ],
    });
    expect(task.output.safeParse(withPersonas).success).toBe(true);
    expect(withPersonas.actors.map((a) => [a.name, a.persona])).toEqual([
      ["Busy parent", "Busy parent"],
      ["Student", "Student"],
    ]);
    expect(withPersonas.actors[0].impacts.map((i) => i.text)).toEqual([
      "Start doing what “grow repeat orders by 20% by June” needs",
      "Do it more often, or with less help",
      "Stop doing what gets in the way",
    ]);
    expect(withPersonas.actors[0].impacts.every((i) => i.deliverables.length === 0)).toBe(true);

    const generic = fallbackImpactMap({
      ...base,
      goal: "Grow",
      actors: ["people who use it every day"],
    });
    expect(generic.actors.map((a) => a.name)).toEqual(GENERIC_ACTORS.slice(1));
    expect(generic.actors.every((a) => a.persona === undefined)).toBe(true);
  });

  it("answers a 200-character goal, and a map that has every actor already, within the caps", () => {
    const long = fallbackImpactMap({ ...base, goal: "g".repeat(200), actors: [...GENERIC_ACTORS] });
    expect(task.output.safeParse(long).success).toBe(true);
    expect(long.actors.length).toBeGreaterThan(0);
    for (const i of long.actors[0].impacts) expect(i.text.length).toBeLessThanOrEqual(200);
  });

  it("fits the route's body at its largest input, in 3-byte text", () => {
    const s = (n: number) => "語".repeat(n);
    const input = task.input.parse({
      goal: s(200),
      measure: s(200),
      context: s(2000),
      personas: Array.from({ length: 12 }, () => ({ name: s(200), role: s(200) })),
      actors: Array.from({ length: 12 }, () => s(200)),
    });
    expect(jsonBytes({ task: task.id, input })).toBeLessThanOrEqual(TOOL_AI_BODY_BUDGET);
  });

  it("builds the prompt on the server, the data inside the block", () => {
    const system = buildTaskSystem(task, impactMapDraftPrompt);
    expect(system).toContain("never a feature");
    expect(system).toContain("never invent persona names");
    const user = buildTaskUser(
      impactMapDraftPrompt,
      task.input.parse({
        goal: "G",
        measure: "M",
        context: "C",
        personas: [{ name: "P", role: "R" }],
        actors: ["A"],
      })
    );
    expect(user).toBe(
      "<user_content>\nGoal: G\nMeasure: M\nContext: C\nPersonas:\n- P: R\nActors already on the map:\n- A\n</user_content>"
    );
  });

  it("caps its input", () => {
    expect(task.input.safeParse({ ...base, goal: "" }).success).toBe(false);
    expect(task.input.safeParse({ ...base, goal: "x".repeat(201) }).success).toBe(false);
    expect(
      task.input.safeParse({ ...base, goal: "g", actors: Array.from({ length: 13 }, () => "a") })
        .success
    ).toBe(false);
  });
});
