// @vitest-environment node
/**
 * The golden test for planning-poker.similar: a canned answer gives up to
 * three picks with a reason each, a bad pick is dropped, the fallback finds
 * the stories that share title words, the largest input fits a visitor's
 * request in 3-byte text, and the page's input builder sends only ids,
 * titles and points.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import { TOOL_AI_BODY_BUDGET } from "@/lib/ai/contract";
import { jsonBytes } from "@/lib/utils/json-bytes";
import {
  SIMILAR_CANDIDATES_MAX,
  SIMILAR_ID_MAX,
  SIMILAR_NOTES_MAX,
  SIMILAR_TITLE_MAX,
  pokerSimilarFallback,
  pokerSimilarTask,
} from "@/lib/ai/tasks/planning-poker";
import { pokerSimilarInput, sharesLine } from "@/lib/ai/tasks/planning-poker.lite";
import { pokerSimilarPrompt } from "@/lib/ai/tasks/planning-poker.server";
import type { Story } from "@/lib/stores/workspace-types";

const task = pokerSimilarTask;

describe("planning-poker.similar", () => {
  it("is a small, quick task with room for a list", () => {
    expect(task).toMatchObject({ tier: "flash", effort: "low", maxTokens: 4096 });
    expect(task.fallback).toBe(pokerSimilarFallback);
  });

  it("reads a typical model answer", () => {
    const parsed = parseAnswer(
      '```json\n{"matches":[{"id":"story_a1","why":"Both refund a card payment"},{"id":"story_c3","why":"Same order page"}]}\n```',
      task.output
    );
    expect(parsed).toEqual({
      ok: true,
      data: {
        matches: [
          { id: "story_a1", why: "Both refund a card payment" },
          { id: "story_c3", why: "Same order page" },
        ],
      },
    });
  });

  it("drops a pick with no id, shortens an overlong reason, and keeps the rest", () => {
    const parsed = parseAnswer(
      JSON.stringify({
        matches: [{ why: "No id" }, { id: "story_b2", why: "x".repeat(400) }, { id: "a", why: "" }],
      }),
      task.output
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.matches.map((m) => m.id)).toEqual(["story_b2", "a"]);
      expect(parsed.data.matches[0].why.length).toBeLessThanOrEqual(160);
    }
    expect(parseAnswer("no json here", task.output).ok).toBe(false);
  });

  it("falls back to the candidates that share title words, with the words", () => {
    const out = task.fallback(task.input.parse(task.sample));
    expect(task.output.safeParse(out).success).toBe(true);
    expect(out.matches.map((m) => m.id)).toEqual(["story_a1", "story_c3"]);
    expect(out.matches[0].why).toBe("Shares: card, order, refund");
    // Nothing alike: no picks, still a valid answer.
    const none = task.fallback(
      task.input.parse({
        story: { title: "Dark mode toggle" },
        candidates: [{ id: "x", title: "Export the sales report", points: 3 }],
      })
    );
    expect(none).toEqual({ matches: [] });
  });

  it("builds the prompt on the server, the stories listed inside the block", () => {
    expect(buildTaskSystem(task, pokerSimilarPrompt)).toContain("Never invent an id");
    expect(
      buildTaskUser(pokerSimilarPrompt, {
        story: { title: "Refund a card", notes: "Support only" },
        candidates: [{ id: "s1", title: "Card refunds", points: 5 }],
      })
    ).toBe(
      "<user_content>\nStory: Refund a card\nNotes: Support only\nFinished stories:\n- id s1 | 5 points | Card refunds\n</user_content>"
    );
  });

  it("caps its input", () => {
    const ok = task.input.parse(task.sample);
    expect(
      task.input.safeParse({ ...ok, story: { title: "x".repeat(SIMILAR_TITLE_MAX + 1) } }).success
    ).toBe(false);
    expect(
      task.input.safeParse({
        ...ok,
        story: { title: "x", notes: "x".repeat(SIMILAR_NOTES_MAX + 1) },
      }).success
    ).toBe(false);
    expect(task.input.safeParse({ ...ok, candidates: [] }).success).toBe(false);
    const many = Array.from({ length: SIMILAR_CANDIDATES_MAX + 1 }, (_, i) => ({
      id: `s${i}`,
      title: "T",
      points: 3,
    }));
    expect(task.input.safeParse({ ...ok, candidates: many }).success).toBe(false);
    expect(
      task.input.safeParse({ ...ok, candidates: [{ id: "s", title: "T", points: 1001 }] }).success
    ).toBe(false);
  });

  it("fits a visitor's request at every cap, in 3-byte text", () => {
    // CJK costs 3 bytes per counted character: the most a capped string can.
    const wide = (n: number) => "界".repeat(n);
    const input = task.input.parse({
      story: { title: wide(SIMILAR_TITLE_MAX), notes: wide(SIMILAR_NOTES_MAX) },
      candidates: Array.from({ length: SIMILAR_CANDIDATES_MAX }, () => ({
        id: wide(SIMILAR_ID_MAX),
        title: wide(SIMILAR_TITLE_MAX),
        points: 1000,
      })),
    });
    expect(jsonBytes({ task: task.id, input })).toBeLessThanOrEqual(TOOL_AI_BODY_BUDGET);
  });

  it("the ref's fallback refuses input it can't answer validly", () => {
    // Without the schema (the def not loaded yet), an id too long to carry is left out.
    const out = pokerSimilarFallback({
      story: { title: "Refund a card" },
      candidates: [
        { id: "x".repeat(SIMILAR_ID_MAX + 1), title: "Card refunds", points: 3 },
        { id: "ok", title: "Card refunds", points: 3 },
      ],
    });
    expect(out.matches.map((m) => m.id)).toEqual(["ok"]);
    expect(() =>
      pokerSimilarFallback({ story: undefined, candidates: [] } as unknown as Parameters<
        typeof pokerSimilarFallback
      >[0])
    ).toThrow();
    expect(sharesLine(["a".repeat(200)]).length).toBeLessThanOrEqual(160);
  });
});

describe("pokerSimilarInput", () => {
  const done = (id: string, title: string, points: number, extra: Partial<Story> = {}): Story => ({
    id,
    title,
    points,
    status: "done",
    ...extra,
  });

  it("sends the story and the done stories with points, never their notes", () => {
    const input = pokerSimilarInput(
      { title: "  Refund a card  ", notes: "Support only. ".repeat(80) },
      [
        done("s1", "Card refunds", 5, { notes: "Private notes" }),
        done("s2", "Export", 3),
        { id: "s3", title: "Refund flow", points: 3, status: "todo" },
        done("example-s4", "Refund", 3),
        done("x".repeat(SIMILAR_ID_MAX + 1), "Refund card", 3),
        done("s5", "Refund card", 2000),
      ]
    );
    expect(input.story.title).toBe("Refund a card");
    expect(input.story.notes?.length).toBeLessThanOrEqual(SIMILAR_NOTES_MAX);
    expect(input.candidates).toEqual([
      { id: "s1", title: "Card refunds", points: 5 },
      { id: "s2", title: "Export", points: 3 },
    ]);
    expect(task.input.safeParse(input).success).toBe(true);
  });

  it("leaves the notes out when there are none", () => {
    const input = pokerSimilarInput({ title: "Refund" }, [done("s1", "Card refunds", 5)]);
    expect(input.story).toEqual({ title: "Refund" });
  });
});
