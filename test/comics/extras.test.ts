// @vitest-environment node
/**
 * A story's quiz and own tool: what the portal may send, what a page shows,
 * the owner route, and the read that hides them before migration 0033 runs.
 */

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  auth: null as Response | null,
  row: { quiz: null, try_tool: null } as { quiz: unknown; try_tool: unknown } | null,
  error: null as { message: string } | null,
  updates: [] as unknown[],
  revalidated: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => h.revalidated.push(path) }));
vi.mock("@/lib/auth/require-user", () => ({
  requireAuthorizedUser: async () => {
    if (h.auth) throw h.auth;
    return { user: { id: "owner" }, supabase: {} };
  },
}));
vi.mock("@/lib/squads/server", () => ({
  getSquadAdminClient: () => ({
    from: (table: string) => {
      expect(table).toBe("comic_stories");
      const chain: Record<string, unknown> = {
        select: () => chain,
        update: (value: unknown) => {
          h.updates.push(value);
          return chain;
        },
        eq: () => chain,
        lte: () => chain,
        abortSignal: () => chain,
        maybeSingle: async () => ({ data: h.error ? null : h.row, error: h.error }),
      };
      return chain;
    },
  }),
}));

import { GET, PUT } from "@/app/api/comics/stories/[ep]/extras/route";
import { QUIZ_LIMITS, checkExtras, pickableTool, readQuiz } from "@/lib/comics/extras";
import { getStoryExtras } from "@/lib/comics/store";
import { toolForStory } from "@/lib/comics/try-tool";

const Q = { question: "What comes first?", options: ["All of it", "One job"], answer: 1 };

function req(method: string, body?: unknown) {
  return new NextRequest("https://agile.test/api/comics/stories/30/extras", {
    method,
    headers: {
      host: "agile.test",
      origin: "https://agile.test",
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  h.auth = null;
  h.row = { quiz: null, try_tool: null };
  h.error = null;
  h.updates = [];
  h.revalidated = [];
});

describe("a quiz", () => {
  it("takes one to three questions of two to four options with a right one", () => {
    expect(readQuiz([Q])).toEqual([Q]);
    expect(readQuiz([{ ...Q, explain: "Finish one first." }])?.[0].explain).toBe(
      "Finish one first."
    );
    expect(readQuiz([])).toBeNull();
    expect(readQuiz([Q, Q, Q, Q])).toBeNull();
    expect(readQuiz([{ ...Q, options: ["Only one"] }])).toBeNull();
    expect(readQuiz([{ ...Q, options: ["a", "b", "c", "d", "e"] }])).toBeNull();
    expect(readQuiz([{ ...Q, answer: 2 }])).toBeNull();
    expect(readQuiz([{ ...Q, answer: 0.5 }])).toBeNull();
    expect(readQuiz([{ ...Q, question: " " }])).toBeNull();
    expect(readQuiz([{ ...Q, question: "x".repeat(QUIZ_LIMITS.question + 1) }])).toBeNull();
  });

  it("is shown whole or not at all", () => {
    expect(readQuiz([Q, { ...Q, answer: 9 }])).toBeNull();
    expect(readQuiz("not a quiz")).toBeNull();
  });

  it("is held to the same size in the migration", () => {
    const sql = readFileSync("supabase/migrations/0033_comic_guestbook_quiz.sql", "utf8");
    expect(sql).toContain(`jsonb_array_length(quiz) between 1 and ${QUIZ_LIMITS.questions}`);
  });
});

describe("a story's own tool", () => {
  it("is a main tool only", () => {
    expect(pickableTool("retro")?.id).toBe("retro");
    expect(pickableTool("ai-red-team")).toBeNull(); // on the More tools shelf
    expect(pickableTool("squad-session")).toBeNull(); // for VIPs
    expect(pickableTool("comics")).toBeNull(); // reading
    expect(pickableTool("nope")).toBeNull();
  });

  it("wins over the theme's, and falls back to it", () => {
    expect(toolForStory("retro", ["T10"])?.id).toBe("retro");
    expect(toolForStory(null, ["T10"])?.id).toBe("decision-log");
    expect(toolForStory("ai-red-team", ["T10"])?.id).toBe("decision-log");
  });
});

describe("what the portal may send", () => {
  it("clears either with null, and refuses a broken one by name", () => {
    expect(checkExtras({ quiz: null, tryTool: null })).toEqual({
      ok: true,
      extras: { quiz: null, tryTool: null },
    });
    expect(checkExtras({ quiz: [Q], tryTool: "kudos" })).toEqual({
      ok: true,
      extras: { quiz: [Q], tryTool: "kudos" },
    });
    expect(checkExtras({ quiz: [{ ...Q, answer: 5 }] })).toEqual({ ok: false, field: "quiz" });
    expect(checkExtras({ tryTool: "ai-red-team" })).toEqual({ ok: false, field: "tryTool" });
  });
});

describe("the extras route", () => {
  it("refuses anyone but the owner", async () => {
    h.auth = Response.json({ error: "forbidden" }, { status: 403 });
    expect((await GET(req("GET"), { params: { ep: "30" } })).status).toBe(403);
    expect((await PUT(req("PUT", { quiz: null }), { params: { ep: "30" } })).status).toBe(403);
    expect(h.updates).toEqual([]);
  });

  it("saves both and refreshes the story's pages", async () => {
    h.row = { quiz: [Q], try_tool: "kudos" };
    const res = await PUT(req("PUT", { quiz: [Q], tryTool: "kudos" }), { params: { ep: "30" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ extras: { quiz: [Q], tryTool: "kudos" } });
    expect(h.updates[0]).toMatchObject({ quiz: [Q], try_tool: "kudos" });
    expect(h.revalidated).toContain("/comics/ep/30");
  });

  it("names what it refused", async () => {
    const res = await PUT(req("PUT", { quiz: [{ ...Q, options: [] }] }), { params: { ep: "30" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_input", field: "quiz" });
  });

  it("says the columns aren't there yet, before migration 0033 runs", async () => {
    h.error = { message: "column comic_stories.quiz does not exist" };
    const res = await GET(req("GET"), { params: { ep: "30" } });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "extras_unavailable" });
  });
});

describe("the page's read", () => {
  it("shows a whole quiz and a main tool", async () => {
    h.row = { quiz: [Q], try_tool: "kudos" };
    expect(await getStoryExtras(30)).toEqual({ quiz: [Q], tryTool: "kudos" });
  });

  it("drops a tool that's since been shelved or removed", async () => {
    h.row = { quiz: null, try_tool: "ai-red-team" };
    expect(await getStoryExtras(30)).toEqual({ quiz: null, tryTool: null });
  });

  it("is none at all when the read fails, so the story page still works", async () => {
    h.error = { message: "column comic_stories.quiz does not exist" };
    expect(await getStoryExtras(30)).toEqual({ quiz: null, tryTool: null });
  });
});
