// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/squads/server", () => ({ getSquadAdminClient: () => h.client }));

import {
  getReleasedStory,
  getStoryExtras,
  listReleasedEps,
  listReleasedWeekly,
  listStudyCards,
} from "@/lib/comics/store";
import { NO_EXTRAS } from "@/lib/comics/extras";

type Row = Record<string, unknown>;

const PANEL = {
  pathFull: "s/1-1536.webp",
  pathSmall: "s/1-768.webp",
  width: 1536,
  height: 1024,
  alt: "Two colleagues at a whiteboard.",
  dialogue: [{ speaker: "Amr", line: "Which one first?" }],
  signs: ["Priority one"],
};

const row = (ep: number, collection: string, release_at: string | null): Row => ({
  ep,
  collection,
  title: `Story ${ep}`,
  lesson: `Lesson ${ep}`,
  squad_question: `Question ${ep}`,
  cast_names: ["Amr"],
  themes: ["T01"],
  panels: [PANEL, { ...PANEL, pathSmall: "s/2-768.webp", pathFull: "s/2-1536.webp" }],
  share_path: null,
  book_page: collection === "book" ? 9 : null,
  release_at,
  updated_at: "2026-10-01T00:00:00.000Z",
});

const PAST = "2026-10-01T07:00:00.000Z";
const OLDER = "2026-09-01T07:00:00.000Z";
const FUTURE = "2999-01-01T07:00:00.000Z";

const QUIZ = [{ question: "What comes first?", options: ["Everything", "One job"], answer: 1 }];
const EXTRAS = { quiz: QUIZ, try_tool: "retro-actions" };

const ROWS = [
  row(1, "book", PAST),
  row(2, "book", null),
  row(27, "weekly", OLDER),
  { ...row(28, "weekly", PAST), ...EXTRAS },
  { ...row(29, "weekly", FUTURE), ...EXTRAS },
  { ...row(30, "weekly", null), ...EXTRAS },
];

/**
 * Just enough PostgREST to run the store's queries over rows, so these tests
 * check which rows come back rather than which methods were called.
 */
function fakeClient(rows: Row[], signals: AbortSignal[] = []) {
  return {
    from: () => {
      let result = [...rows];
      let select = "";
      let single = false;
      const builder = {
        select(columns: string) {
          select = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          result = result.filter((r) => r[column] === value);
          return builder;
        },
        lte(column: string, value: string) {
          result = result.filter((r) => r[column] !== null && String(r[column]) <= value);
          return builder;
        },
        order(column: string, opts: { ascending: boolean }) {
          const dir = opts.ascending ? 1 : -1;
          const sorted = [...result];
          sorted.sort((a, b) => (String(a[column]) < String(b[column]) ? -dir : dir));
          // Later orders only break ties here, and the test data has none.
          if (column === "ep" && !opts.ascending) return builder;
          result = sorted;
          return builder;
        },
        limit(n: number) {
          result = result.slice(0, n);
          return builder;
        },
        abortSignal(signal: AbortSignal) {
          signals.push(signal);
          return builder;
        },
        returns: () => builder,
        maybeSingle() {
          single = true;
          return builder;
        },
        then(resolve: (value: unknown) => void) {
          const shaped = result.map((r) =>
            select.includes("cover:panels->0")
              ? { ...r, panels: undefined, cover: (r.panels as unknown[])[0] }
              : r
          );
          resolve({ data: single ? (shaped[0] ?? null) : shaped, error: null });
        },
      };
      return builder;
    },
  };
}

/** Whatever the query, supabase-js answers with { error } and doesn't throw. */
function failingClient() {
  const answer = { data: null, error: { message: "connection refused" } };
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "lte", "order", "limit", "abortSignal", "returns"]) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = () => Promise.resolve(answer);
  builder.then = (resolve: (value: unknown) => void) => resolve(answer);
  return { from: () => builder };
}

beforeEach(() => {
  h.client = fakeClient(ROWS);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public reads", () => {
  it("returns a released story", async () => {
    const story = await getReleasedStory(28);
    expect(story).toMatchObject({
      ep: 28,
      collection: "weekly",
      title: "Story 28",
      squadQuestion: "Question 28",
      castNames: ["Amr"],
    });
    expect(story?.panels[0]).toMatchObject({
      pathSmall: "s/1-768.webp",
      dialogue: [{ speaker: "Amr", line: "Which one first?" }],
      signs: ["Priority one"],
    });
  });

  it.each([
    ["a scheduled story", 29],
    ["a weekly draft", 30],
    ["a book draft", 2],
    ["an unknown number", 99],
  ])("hides %s", async (_label, ep) => {
    expect(await getReleasedStory(ep)).toBeNull();
  });

  it("lists only released weekly stories, newest first", async () => {
    const list = await listReleasedWeekly();
    expect(list.map((s) => s.ep)).toEqual([28, 27]);
  });

  it("never lists a book episode", async () => {
    expect((await listReleasedWeekly()).some((s) => s.ep === 1)).toBe(false);
  });

  it("gives a gallery card one small image and no way to the full panels", async () => {
    const [card] = await listReleasedWeekly();
    expect(card.cover).toEqual({ pathSmall: "s/1-768.webp", width: 1536, height: 1024 });
    expect(JSON.stringify(card)).not.toContain("1536.webp");
    expect(JSON.stringify(card)).not.toContain("Which one first?");
  });

  it("honours a limit", async () => {
    expect((await listReleasedWeekly(1)).map((s) => s.ep)).toEqual([28]);
  });

  it("lists released numbers by collection", async () => {
    expect(await listReleasedEps("weekly")).toEqual([27, 28]);
    expect(await listReleasedEps("book")).toEqual([1]);
  });

  it("drops a panel missing its art", async () => {
    h.client = fakeClient([
      { ...row(28, "weekly", PAST), panels: [PANEL, { alt: "No art" }, null, "junk"] },
    ]);
    expect((await getReleasedStory(28))?.panels).toHaveLength(1);
  });

  it("makes flashcards of released weekly stories only, oldest first", async () => {
    expect(await listStudyCards()).toEqual([
      { ep: 27, title: "Story 27", lesson: "Lesson 27", question: "Question 27" },
      { ep: 28, title: "Story 28", lesson: "Lesson 28", question: "Question 28" },
    ]);
  });

  it("gives a released story its quiz and its own tool", async () => {
    expect(await getStoryExtras(28)).toEqual({ quiz: QUIZ, tryTool: "retro-actions" });
  });

  it.each([
    ["a scheduled story's", 29],
    ["a draft's", 30],
  ])("keeps %s quiz and tool to itself", async (_label, ep) => {
    expect(await getStoryExtras(ep)).toEqual(NO_EXTRAS);
  });

  it("puts a deadline on every read", async () => {
    const signals: AbortSignal[] = [];
    h.client = fakeClient(ROWS, signals);
    await getReleasedStory(28);
    await listReleasedWeekly();
    await listReleasedEps("weekly");
    await listStudyCards();
    await getStoryExtras(28);
    expect(signals).toHaveLength(5);
    for (const signal of signals) expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe("when Supabase fails at runtime", () => {
  beforeEach(() => {
    h.client = failingClient();
  });

  it("throws rather than rendering empty, so the last good page stays up", async () => {
    await expect(getReleasedStory(28)).rejects.toThrow("connection refused");
    await expect(listReleasedWeekly()).rejects.toThrow("connection refused");
    await expect(listReleasedEps("weekly")).rejects.toThrow("connection refused");
    await expect(listStudyCards()).rejects.toThrow("connection refused");
  });

  it("reads a story's extras as none instead: the story read beside it keeps the last copy", async () => {
    expect(await getStoryExtras(28)).toEqual(NO_EXTRAS);
  });

  it("throws when the service role client is missing too", async () => {
    h.client = null;
    await expect(listReleasedWeekly()).rejects.toThrow("not configured");
  });

  it("throws when the request itself throws", async () => {
    h.client = {
      from: () => {
        throw new TypeError("fetch failed");
      },
    };
    await expect(listReleasedWeekly()).rejects.toThrow("fetch failed");
  });
});

describe("during the production build", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
  });

  it("returns empty on an error, so a placeholder Supabase can't fail CI", async () => {
    h.client = failingClient();
    expect(await getReleasedStory(28)).toBeNull();
    expect(await listReleasedWeekly()).toEqual([]);
    expect(await listReleasedEps("weekly")).toEqual([]);
    expect(await listStudyCards()).toEqual([]);
  });

  it("returns empty with no client at all", async () => {
    h.client = null;
    expect(await listReleasedWeekly()).toEqual([]);
  });

  it("still reads real rows when Supabase answers", async () => {
    expect((await listReleasedWeekly()).map((s) => s.ep)).toEqual([28, 27]);
  });
});
