// @vitest-environment node
/**
 * A story's guess and "Try it this week" line: their shape, what the portal may
 * send, the owner routes that save and list them, the soft page read, the tap
 * maths, and migration 0035 agreeing with all of it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  auth: null as Response | null,
  row: null as Record<string, unknown> | null,
  list: [] as { ep: number }[],
  error: null as { message: string; code?: string } | null,
  updates: [] as unknown[],
  filters: [] as unknown[][],
  selects: [] as string[],
  revalidated: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => h.revalidated.push(p) }));
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
        select: (columns: string) => {
          h.selects.push(columns);
          return chain;
        },
        update: (value: unknown) => {
          h.updates.push(value);
          return chain;
        },
        eq: (...args: unknown[]) => {
          h.filters.push(["eq", ...args]);
          return chain;
        },
        lte: (...args: unknown[]) => {
          h.filters.push(["lte", ...args]);
          return chain;
        },
        not: (...args: unknown[]) => {
          h.filters.push(["not", ...args]);
          return chain;
        },
        order: () => chain,
        abortSignal: () => chain,
        maybeSingle: async () => ({ data: h.error ? null : h.row, error: h.error }),
        returns: async () => ({ data: h.error ? null : h.list, error: h.error }),
      };
      return chain;
    },
  }),
}));

import { GET, PUT } from "@/app/api/comics/stories/[ep]/guess/route";
import { GET as LIST_DRAFTS } from "@/app/api/comics/guess-drafts/route";
import {
  GUESS_LIMITS,
  GUESS_MAX_BYTES,
  SHOW_SHARES_AT,
  TRY_ACTION_MAX,
  checkGuess,
  choicesFor,
  parseTap,
  readGuess,
  readGuessDraft,
  shares,
  tapCounts,
} from "@/lib/comics/guess";
import { getStoryGuess } from "@/lib/comics/store";

const G = {
  question: "What happens next?",
  options: ["She asks the team", "He decides alone", "They wait a week"],
  happened: 0,
};

function req(method: string, url: string, body?: unknown) {
  return new NextRequest(`https://agile.test${url}`, {
    method,
    headers: {
      host: "agile.test",
      origin: "https://agile.test",
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = { params: { ep: "30" } };

beforeEach(() => {
  h.auth = null;
  h.row = { guess: null, try_action: null, extras_draft: null };
  h.list = [];
  h.error = null;
  h.updates = [];
  h.filters = [];
  h.selects = [];
  h.revalidated = [];
});

describe("a guess", () => {
  it("has a question, two to four different options and the one that happened", () => {
    expect(readGuess(G)).toEqual(G);
    expect(readGuess({ ...G, note: "Asking first saved a week." })?.note).toBe(
      "Asking first saved a week."
    );
    expect(readGuess({ ...G, options: ["Only one"] })).toBeNull();
    expect(readGuess({ ...G, options: ["a", "b", "c", "d", "e"] })).toBeNull();
    expect(readGuess({ ...G, options: ["Same", "same "] })).toBeNull();
    expect(readGuess({ ...G, options: ["a", " "] })).toBeNull();
    expect(readGuess({ ...G, happened: 3 })).toBeNull();
    expect(readGuess({ ...G, happened: 1.5 })).toBeNull();
    expect(readGuess({ ...G, question: "" })).toBeNull();
    expect(readGuess({ ...G, question: "x".repeat(GUESS_LIMITS.question + 1) })).toBeNull();
    expect(readGuess({ ...G, note: "x".repeat(GUESS_LIMITS.note + 1) })).toBeNull();
    expect(readGuess([G])).toBeNull();
    expect(readGuess("guess")).toBeNull();
  });

  it("drops an empty note rather than storing it", () => {
    expect(readGuess({ ...G, note: "" })).toEqual(G);
    expect(readGuess({ ...G, note: null })).toEqual(G);
  });
});

describe("what the portal may send", () => {
  it("clears either with null, and names what it refused", () => {
    expect(checkGuess({ guess: null, tryAction: null })).toEqual({
      ok: true,
      guess: null,
      tryAction: null,
    });
    expect(checkGuess({ guess: G, tryAction: "Ask one person first." })).toEqual({
      ok: true,
      guess: G,
      tryAction: "Ask one person first.",
    });
    expect(checkGuess({ guess: { ...G, happened: 9 } })).toEqual({ ok: false, field: "guess" });
    expect(checkGuess({ tryAction: "x".repeat(TRY_ACTION_MAX + 1) })).toEqual({
      ok: false,
      field: "tryAction",
    });
  });

  it("passes a tool on only when one is sent, and only a main tool", () => {
    expect(checkGuess({ guess: null, tryAction: null }).ok && "tryTool" in checkGuess({})).toBe(
      false
    );
    expect(checkGuess({ tryTool: "retro" })).toMatchObject({ ok: true, tryTool: "retro" });
    expect(checkGuess({ tryTool: null })).toMatchObject({ ok: true, tryTool: null });
    expect(checkGuess({ tryTool: "ai-red-team" })).toEqual({ ok: false, field: "tryTool" });
  });

  it("keeps even the longest guess in 3-byte letters under the database's cap", () => {
    const wide = (n: number) => "क".repeat(n);
    const big = {
      question: wide(140),
      options: [wide(120), wide(119) + "a", wide(119) + "b", wide(119) + "c"],
      happened: 0,
      note: wide(280),
    };
    expect(readGuess(big)).not.toBeNull();
    expect(checkGuess({ guess: big }).ok).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeLessThan(GUESS_MAX_BYTES);
  });
});

describe("an import's draft", () => {
  it("keeps only the parts that pass, and is nothing when none do", () => {
    expect(readGuessDraft({ guess: G, tryAction: "Ask first.", tryTool: "retro" })).toEqual({
      guess: G,
      tryAction: "Ask first.",
      tryTool: "retro",
    });
    expect(readGuessDraft({ guess: { ...G, happened: 7 }, tryTool: "ai-red-team" })).toBeNull();
    expect(readGuessDraft({ tryAction: "Ask first." })).toEqual({
      guess: null,
      tryAction: "Ask first.",
      tryTool: null,
    });
    expect(readGuessDraft(null)).toBeNull();
  });
});

describe("the guess route", () => {
  it("refuses anyone but the owner", async () => {
    h.auth = Response.json({ error: "forbidden" }, { status: 403 });
    expect((await GET(req("GET", "/api/comics/stories/30/guess"), params)).status).toBe(403);
    const put = await PUT(req("PUT", "/api/comics/stories/30/guess", { guess: null }), params);
    expect(put.status).toBe(403);
    expect(h.updates).toEqual([]);
  });

  it("hands the portal the live guess and any draft", async () => {
    h.row = { guess: G, try_action: "Ask first.", extras_draft: { guess: G, tryTool: "retro" } };
    const res = await GET(req("GET", "/api/comics/stories/30/guess"), params);
    expect(await res.json()).toEqual({
      guess: G,
      tryAction: "Ask first.",
      draft: { guess: G, tryAction: null, tryTool: "retro" },
    });
  });

  it("saving approves: it writes the live columns, clears the draft and refreshes the page", async () => {
    h.row = { guess: G, try_action: "Ask first.", extras_draft: null };
    const res = await PUT(
      req("PUT", "/api/comics/stories/30/guess", { guess: G, tryAction: "Ask first." }),
      params
    );
    expect(res.status).toBe(200);
    expect(h.updates[0]).toEqual({ guess: G, try_action: "Ask first.", extras_draft: null });
    expect(h.revalidated).toContain("/comics/ep/30");
  });

  it("writes the story's tool only when approving a draft that suggested one", async () => {
    await PUT(
      req("PUT", "/api/comics/stories/30/guess", { guess: G, tryAction: null, tryTool: "retro" }),
      params
    );
    expect(h.updates[0]).toEqual({
      guess: G,
      try_action: null,
      extras_draft: null,
      try_tool: "retro",
    });
  });

  it("names what it refused, and a value the database refused", async () => {
    const bad = await PUT(
      req("PUT", "/api/comics/stories/30/guess", { guess: { ...G, options: [] } }),
      params
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_input", field: "guess" });
    h.error = { message: "violates check constraint", code: "23514" };
    const refused = await PUT(req("PUT", "/api/comics/stories/30/guess", { guess: G }), params);
    expect(await refused.json()).toEqual({ error: "invalid_input", field: "guess" });
  });

  it("says the columns aren't there yet, before migration 0035 runs", async () => {
    h.error = { message: "column comic_stories.guess does not exist" };
    const res = await GET(req("GET", "/api/comics/stories/30/guess"), params);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "guess_unavailable" });
  });

  it("lists the stories with a draft still waiting", async () => {
    h.list = [{ ep: 27 }, { ep: 31 }];
    const res = await LIST_DRAFTS(req("GET", "/api/comics/guess-drafts"), { params: {} });
    expect(await res.json()).toEqual({ eps: [27, 31] });
    expect(h.filters).toContainEqual(["not", "extras_draft", "is", null]);
  });
});

describe("the page's read", () => {
  it("shows the live guess and line of a released weekly story, never a draft", async () => {
    h.row = { guess: G, try_action: "Ask first." };
    expect(await getStoryGuess(30)).toEqual({ guess: G, tryAction: "Ask first." });
    expect(h.selects).toEqual(["guess,try_action"]);
    expect(h.filters).toContainEqual(["eq", "collection", "weekly"]);
  });

  it("reaches four weeks ahead only for the VIP page", async () => {
    await getStoryGuess(30);
    await getStoryGuess(30, { early: true });
    const [now, early] = h.filters
      .filter((f) => f[0] === "lte")
      .map((f) => Date.parse(f[2] as string));
    expect(early - now).toBeGreaterThan(27 * 86_400_000);
  });

  it("is none at all when the read fails, so the story page still works", async () => {
    h.error = { message: "column comic_stories.guess does not exist" };
    expect(await getStoryGuess(30)).toEqual({ guess: null, tryAction: null });
  });
});

describe("taps", () => {
  it("takes a weekly story's number, a kind and a choice", () => {
    expect(parseTap({ ep: 30, kind: "guess", choice: 2 })).toEqual({
      ep: 30,
      kind: "guess",
      choice: 2,
    });
    expect(parseTap({ ep: 26, kind: "guess", choice: 0 })).toBeNull();
    expect(parseTap({ ep: 30, kind: "vote", choice: 0 })).toBeNull();
    expect(parseTap({ ep: 30, kind: "seen", choice: 4 })).toBeNull();
    expect(parseTap({ ep: "30", kind: "seen", choice: 0 })).toBeNull();
    expect(parseTap(null)).toBeNull();
  });

  it("knows how many choices each kind has", () => {
    expect(choicesFor("seen", null)).toBe(2);
    expect(choicesFor("guess", G)).toBe(3);
    expect(choicesFor("guess", null)).toBe(0);
  });

  it("turns rows into one count per choice, ignoring strays", () => {
    expect(
      tapCounts(
        [
          { choice: 2, count: "5" },
          { choice: 0, count: 3 },
          { choice: 7, count: 9 },
        ],
        3
      )
    ).toEqual([3, 0, 5]);
  });

  it("shows whole shares that add up to 100, and none under the threshold", () => {
    expect(shares([1, 1, 1])).toBeNull();
    expect(shares([SHOW_SHARES_AT - 1, 0])).toBeNull();
    expect(shares([7, 7, 7])).toEqual([34, 33, 33]);
    expect(shares([20, 0])).toEqual([100, 0]);
    const s = shares([13, 29, 58])!;
    expect(s.reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("migration 0035", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "supabase/migrations/0035_comic_guess_taps.sql"),
    "utf8"
  );

  it("holds the guess and the line to the same limits as the code", () => {
    expect(sql).toContain(
      `jsonb_array_length(guess -> 'options') between ${GUESS_LIMITS.minOptions} and ${GUESS_LIMITS.maxOptions}`
    );
    expect(sql).toContain(`char_length(try_action) between 1 and ${TRY_ACTION_MAX}`);
  });

  it("counts only weekly stories, two kinds, four choices at most", () => {
    expect(sql).toMatch(/ep\s+int\s+not null check \(ep between 27 and 999\)/);
    expect(sql).toContain("check (kind in ('guess', 'seen'))");
    expect(sql).toContain("check (choice between 0 and 3)");
    const statements = sql.replace(/--.*$/gm, "");
    expect(statements).not.toMatch(/\b(ip|user_agent|cookie|referr?er|timestamptz)\b/i);
  });

  it("is closed to the public API, with the counter for the service role only", () => {
    expect(sql).toContain("alter table public.comic_story_taps enable row level security;");
    expect(sql).toContain("revoke all on table public.comic_story_taps from anon, authenticated;");
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql).toMatch(
      /revoke all on function public\.comic_story_tap\(int, text, smallint\)\s+from public, anon, authenticated;/
    );
    expect(sql).toContain(
      "grant execute on function public.comic_story_tap(int, text, smallint) to service_role;"
    );
    expect(sql).toContain("set search_path = ''");
  });

  it("is safe to run twice", () => {
    expect(sql).toContain("add column if not exists guess jsonb");
    expect(sql).toContain("add column if not exists try_action text");
    expect(sql).toContain("add column if not exists extras_draft jsonb");
    expect(sql).toContain("create table if not exists public.comic_story_taps");
    expect(sql).toContain("create or replace function public.comic_story_tap");
  });
});
