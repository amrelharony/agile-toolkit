// @vitest-environment node
/**
 * The golden test for kickoff.draft: a canned model answer gives the
 * expected lines, an unknown section or an over-long line is dropped or
 * salvaged, a malformed answer is refused (the page then offers the
 * fallback), the fallback is valid for every format with and without a
 * brief, the input never holds a name, and the largest input fits the
 * request budget in 3-byte text.
 */

import { describe, expect, it } from "vitest";
import { TOOL_AI_BODY_BUDGET } from "@/lib/ai/contract";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import {
  KICKOFF_DRAFT_ITEMS_MAX,
  firstSentence,
  kickoffDraftFallback,
  kickoffDraftInputFor,
  kickoffDraftTask,
} from "@/lib/ai/tasks/kickoff";
import { kickoffDraftTask as kickoffDraftRef } from "@/lib/ai/tasks/kickoff.lite";
import { kickoffDraftPrompt } from "@/lib/ai/tasks/kickoff.server";
import { KICKOFF_FORMAT_DEFS, KICKOFF_FORMAT_LIST, SUGGESTED_SLIDERS } from "@/lib/kickoff/formats";
import { draftItemsFor } from "@/lib/kickoff/model";
import { KICKOFF_FORMATS, TOOL_LIST_MAX, type Kickoff } from "@/lib/stores/workspace-types";
import { jsonBytes } from "@/lib/utils/json-bytes";

const task = kickoffDraftTask;
const AT = "2026-11-20T09:00:00.000Z";

const kickoff = (over: Partial<Kickoff> & Pick<Kickoff, "format">): Kickoff => ({
  id: "kickoff_1",
  title: "Tap to pay",
  sections: {},
  status: "draft",
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

describe("kickoff.draft", () => {
  it("is a reasoning task for the owner and visitors alike, with its ref", () => {
    expect(task).toMatchObject({
      id: "kickoff.draft",
      toolId: "kickoff",
      tier: "full",
      effort: "low",
      maxTokens: 6144,
    });
    expect(task.ownerOnly).toBeUndefined();
    expect(kickoffDraftRef.id).toBe(task.id);
    expect(kickoffDraftRef.fallback).toBe(task.fallback);
  });

  it("reads a typical model answer, which the page then files by section", () => {
    const answer = `Here is a draft:
\`\`\`json
{"items": [
  {"section": "why", "text": "Shop owners pay for a card machine they'd rather not carry"},
  {"section": "out-of-scope", "text": "iPhones in the first release, maybe"},
  {"section": "worries", "text": "Certification takes longer than planned"}
], "sliders": ["Team stays the same"]}
\`\`\``;
    const parsed = parseAnswer(answer, task.output);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.items).toHaveLength(3);
    expect(parsed.data.sliders).toEqual(["Team stays the same"]);
    const { lines, dropped } = draftItemsFor(
      KICKOFF_FORMAT_DEFS.inception,
      parsed.data.items,
      kickoff({ format: "inception" })
    );
    expect(dropped).toBe(0);
    expect(lines.map((l) => l.sectionId)).toEqual(["why", "out-of-scope", "worries"]);
  });

  it("salvages an over-long line, and the page drops a section the format doesn't have", () => {
    const parsed = parseAnswer(
      JSON.stringify({
        items: [
          { section: "why", text: "x".repeat(300) },
          { section: "invented", text: "A section nobody asked for" },
          { section: "people", text: "Ana" },
        ],
      }),
      task.output
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.items[0].text).toHaveLength(200);
    const { lines } = draftItemsFor(
      KICKOFF_FORMAT_DEFS["team-canvas"],
      parsed.data.items,
      kickoff({ format: "team-canvas" })
    );
    // "why" isn't a Team Canvas section, nor is "invented"; the team's people never take drafts.
    expect(lines).toEqual([]);
  });

  it("refuses a malformed answer, so the page answers with the fallback", () => {
    expect(parseAnswer("I can't help with that.", task.output).ok).toBe(false);
    expect(parseAnswer('{"lines": "nope"}', task.output).ok).toBe(false);
  });

  it.each(KICKOFF_FORMATS.flatMap((f) => [[f, "with a brief"] as const, [f, "without"] as const]))(
    "falls back to valid lines for %s, %s",
    (format, brief) => {
      const input = task.input.parse({
        format,
        title: "Tap to pay",
        brief: brief === "without" ? "" : "Let shop owners take cards on their phone. More later.",
        existing: [],
        ...(KICKOFF_FORMAT_DEFS[format].hasSliders ? { sliders: ["Scope", "Date"] } : {}),
      });
      const out = kickoffDraftFallback(input);
      expect(task.output.safeParse(out).success).toBe(true);
      expect(out.items.length).toBeGreaterThan(0);
      expect(out.items.length).toBeLessThanOrEqual(KICKOFF_DRAFT_ITEMS_MAX);
      const def = KICKOFF_FORMAT_DEFS[format];
      expect(out.items.some((i) => i.section === "people")).toBe(false);
      if (brief === "without") {
        expect(out.items.every((i) => /\[/.test(i.text))).toBe(true);
      } else {
        expect(out.items[0]).toEqual({
          section: def.lead,
          text: "Let shop owners take cards on their phone.",
        });
      }
      if (def.hasSliders) expect(out.sliders).toEqual([...SUGGESTED_SLIDERS]);
      else expect(out.sliders).toBeUndefined();
    }
  );

  it("leaves out starter lines already there, and extra sliders already on the list", () => {
    const starter = KICKOFF_FORMAT_DEFS["trade-offs"].sections[0].starter!;
    const out = kickoffDraftFallback(
      task.input.parse({
        format: "trade-offs",
        title: "T",
        brief: "",
        existing: [starter],
        sliders: ["Scope", "easy to use"],
      })
    );
    expect(out.items).toEqual([]);
    expect(out.sliders).toEqual(["Team stays the same", "Tech we choose"]);
    expect(firstSentence("  One.  Two! ")).toBe("One.");
    expect(firstSentence("")).toBe("");
  });

  it("builds its input from the kickoff with no names: no participants, owners or people", () => {
    const k = kickoff({
      format: "team-canvas",
      brief: "A new squad.",
      participants: ["Ana", "Bo"],
      sections: {
        purpose: [{ id: "p", text: "Make paying easy" }],
        people: [{ id: "a", text: "Product Owner", owner: "Ana" }],
        needs: [{ id: "n", text: "Reviews in half a day", owner: "Bo" }],
      },
    });
    const input = kickoffDraftInputFor(k, { goal: "Pay anywhere", vision: "" });
    expect(input).toEqual({
      format: "team-canvas",
      title: "Tap to pay",
      brief: "A new squad.",
      goal: "Pay anywhere",
      existing: ["Make paying easy", "Reviews in half a day"],
    });
    expect(JSON.stringify(input)).not.toMatch(/Ana|Bo\b|Product Owner/);
    expect(task.input.safeParse(input).success).toBe(true);
  });

  it("keeps the first six lines of each section and 60 in all", () => {
    const many = Object.fromEntries(
      KICKOFF_FORMAT_DEFS.inception.sections.map((d) => [
        d.id,
        Array.from({ length: d.kind === "list" ? d.max : 1 }, (_, i) => ({
          id: `${d.id}-${i}`,
          text: `${d.id} line ${i}`,
        })),
      ])
    );
    const input = kickoffDraftInputFor(
      kickoff({ format: "inception", sections: many, sliders: [] })
    );
    expect(input.existing.filter((l) => l.startsWith("why "))).toHaveLength(6);
    expect(input.existing.length).toBeLessThanOrEqual(60);
    expect(input.sliders).toEqual([]);
  });

  it("fits the request budget at its caps in 3-byte text", () => {
    const three = (n: number) => "界".repeat(n);
    const largest = {
      format: "problem-framing" as const,
      title: three(200),
      brief: three(2000),
      goal: three(1000),
      vision: three(2000),
      existing: Array.from({ length: 60 }, () => three(200)),
      sliders: Array.from({ length: TOOL_LIST_MAX.kickoffSliders }, () => three(60)),
    };
    expect(task.input.safeParse(largest).success).toBe(true);
    expect(jsonBytes({ task: task.id, input: largest })).toBeLessThanOrEqual(TOOL_AI_BODY_BUDGET);
  });

  it("builds the prompt on the server from the catalog, the data inside the block", () => {
    const system = buildTaskSystem(task, kickoffDraftPrompt);
    expect(system).toContain("section set to the section id");
    expect(system).toContain("Never invent names, dates or numbers");
    expect(system).toContain("maybe");
    const user = buildTaskUser(kickoffDraftPrompt, task.input.parse(task.sample));
    expect(user.startsWith("<user_content>")).toBe(true);
    expect(user).toContain("Format: Inception deck");
    expect(user).toContain("- why: Why we're doing this (a list of up to 8 lines).");
    expect(user).toContain("- pitch: The idea in two sentences (a list of 1 line).");
    expect(user).toContain("Trade-offs on the list:\n- Scope");
    const canvas = buildTaskUser(
      kickoffDraftPrompt,
      task.input.parse({ format: "team-canvas", title: "Squad", brief: "", existing: [] })
    );
    // The team's people are never offered to the model.
    expect(canvas).not.toContain("- people:");
    expect(canvas).toContain("Brief from the team: (none)");
  });

  it("caps its input", () => {
    const ok = { format: "inception", title: "T", brief: "", existing: [] };
    expect(task.input.safeParse(ok).success).toBe(true);
    expect(task.input.safeParse({ ...ok, format: "idea" }).success).toBe(false);
    expect(task.input.safeParse({ ...ok, brief: "x".repeat(2001) }).success).toBe(false);
    expect(
      task.input.safeParse({ ...ok, existing: Array.from({ length: 61 }, () => "x") }).success
    ).toBe(false);
    expect(() => kickoffDraftFallback({ ...ok, format: "idea" } as never)).toThrow();
  });

  it("drafts every format the catalog has", () => {
    expect(KICKOFF_FORMAT_LIST.map((f) => f.id)).toEqual([...KICKOFF_FORMATS]);
  });
});
