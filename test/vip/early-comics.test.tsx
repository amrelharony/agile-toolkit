/**
 * Early comics: the service-role reads that only VIP pages call, the page around
 * them, and the guarantee that nothing public can reach an unreleased story. The
 * store runs for real over a small fake of PostgREST.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

const KEY = "testkey12345";
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-02T12:00:00.000Z");

const h = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  client: null as unknown,
  redirected: null as string | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/squads/server", () => ({ getSquadAdminClient: () => h.client }));
vi.mock("@/lib/vip/book-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vip/book-access")>();
  const hashes = [createHash("sha256").update("testkey12345").digest("hex")];
  return {
    ...actual,
    isVipKey: (raw: string | null | undefined) => actual.isVipKey(raw, hashes),
  };
});
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      name === "agile-toolkit:vip" && h.cookie !== undefined
        ? { name, value: h.cookie }
        : undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
  redirect: (to: string) => {
    h.redirected = to;
    throw new Error("NEXT_REDIRECT");
  },
}));

import EarlyComicsPage, { metadata } from "@/app/(tools)/comics/early/page";
import robots from "@/app/robots";
import { getEarlyStory, listEarlyWeekly, listReleasedWeekly } from "@/lib/comics/store";

type Row = Record<string, unknown>;

const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

const row = (ep: number, collection: string, release_at: string | null): Row => ({
  ep,
  collection,
  title: `Story ${ep}`,
  lesson: `Lesson ${ep}`,
  squad_question: `Question ${ep}`,
  cast_names: ["Amr"],
  themes: ["T01"],
  panels: [
    {
      pathFull: `s/${ep}-1536.webp`,
      pathSmall: `s/${ep}-768.webp`,
      width: 1536,
      height: 1024,
      alt: `Panel of ${ep}`,
      dialogue: [],
      signs: [],
    },
  ],
  share_path: null,
  book_page: null,
  release_at,
  updated_at: iso(-30),
});

const ROWS = [
  row(1, "book", iso(-40)),
  row(2, "book", iso(3)), // A book episode scheduled ahead: not a weekly story.
  row(27, "weekly", iso(-7)), // Released.
  row(30, "weekly", iso(1)),
  row(31, "weekly", iso(8)),
  row(32, "weekly", iso(27.9)),
  row(33, "weekly", iso(28.5)), // Just past the window.
  row(34, "weekly", iso(90)), // Far ahead.
  row(35, "weekly", null), // A draft.
];

/** Just enough PostgREST: filters over rows, with SQL's rule that NULL matches nothing. */
function fakeClient(rows: Row[]) {
  return {
    from: () => {
      let result = [...rows];
      let select = "";
      let single = false;
      const compare = (column: string, test: (value: string) => boolean) => {
        result = result.filter((r) => r[column] !== null && test(String(r[column])));
        return builder;
      };
      const builder = {
        select(columns: string) {
          select = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          result = result.filter((r) => r[column] === value);
          return builder;
        },
        gt: (column: string, value: string) => compare(column, (v) => v > value),
        lte: (column: string, value: string) => compare(column, (v) => v <= value),
        order(column: string, opts: { ascending: boolean }) {
          if (column !== "release_at") return builder;
          const dir = opts.ascending ? 1 : -1;
          result = [...result].sort((a, b) => (String(a[column]) < String(b[column]) ? -dir : dir));
          return builder;
        },
        limit: () => builder,
        abortSignal: () => builder,
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.client = fakeClient(ROWS);
  h.cookie = KEY;
  h.redirected = null;
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("listEarlyWeekly", () => {
  it("lists only weekly stories in the next 28 days, soonest first", async () => {
    expect((await listEarlyWeekly()).map((s) => s.ep)).toEqual([30, 31, 32]);
  });

  it("never lists a draft, a released story or one further ahead", async () => {
    const eps = (await listEarlyWeekly()).map((s) => s.ep);
    for (const ep of [35, 27, 33, 34, 2]) expect(eps).not.toContain(ep);
  });

  it("carries a card's worth of art, never the whole story", async () => {
    const [first] = await listEarlyWeekly();
    expect(first.cover?.pathSmall).toBe("s/30-768.webp");
    expect(first).not.toHaveProperty("panels");
  });
});

describe("getEarlyStory", () => {
  it("finds a story in the window", async () => {
    const found = await getEarlyStory(31);
    expect(found.status).toBe("early");
    if (found.status === "early") expect(found.story.panels).toHaveLength(1);
  });

  it("calls a released story released, without its content", async () => {
    expect(await getEarlyStory(27)).toEqual({ status: "released" });
    expect(await getEarlyStory(1)).toEqual({ status: "released" });
  });

  it.each([
    ["a draft", 35],
    ["a story past the window", 33],
    ["one far ahead", 34],
    ["a book episode scheduled ahead", 2],
    ["a number with no story", 99],
  ])("finds nothing for %s", async (_what, ep) => {
    expect(await getEarlyStory(ep)).toEqual({ status: "none" });
  });
});

describe("/comics/early", () => {
  const open = (ep?: string) =>
    EarlyComicsPage({ searchParams: ep === undefined ? {} : { ep } }) as Promise<ReactElement>;

  it("lists the next four weeks, linking to the early page", async () => {
    render(await open());
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toEqual(expect.arrayContaining(["/comics/early?ep=30", "/comics/early?ep=32"]));
    expect(screen.queryByText("Story 33")).toBeNull();
    expect(screen.queryByText("Story 35")).toBeNull();
    expect(screen.getByText("Story 30")).toBeInTheDocument();
    expect(screen.getByText("Out Tuesday 3 November")).toBeInTheDocument();
  });

  it("reads an early story with the normal reader", async () => {
    render(await open("31"));
    expect(screen.getByRole("heading", { level: 1, name: "Story 31" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Panel of 31" })).toBeInTheDocument();
    expect(screen.getByText("Lesson 31")).toBeInTheDocument();
    expect(screen.getByText("Question 31")).toBeInTheDocument();
    expect(screen.getByText(/private property of this website/)).toBeInTheDocument();
  });

  it("sends a released number to its public address", async () => {
    await expect(open("27")).rejects.toThrow("NEXT_REDIRECT");
    expect(h.redirected).toBe("/comics?ep=27");
  });

  it.each(["33", "34", "35", "99"])("shows nothing for ep %s", async (ep) => {
    const { container } = render(await open(ep));
    expect(container.innerHTML).not.toContain(`Story ${ep}`);
    expect(container.innerHTML).not.toContain(`s/${ep}-`);
    expect(screen.getByText("This comic isn't ready to read ahead")).toBeInTheDocument();
  });

  it("answers the same for a draft and for a story further ahead", async () => {
    const draft = render(await open("35")).container.innerHTML;
    cleanup();
    expect(render(await open("34")).container.innerHTML).toBe(draft);
  });

  it("treats a junk number as the list", async () => {
    render(await open("not-a-number"));
    expect(screen.getByText("Story 30")).toBeInTheDocument();
  });

  it("gives a locked visitor no titles, art or counts", async () => {
    h.cookie = undefined;
    for (const ep of [undefined, "31", "27", "35"]) {
      const { container } = render(await open(ep));
      expect(container.innerHTML).not.toMatch(/Story \d|Lesson \d|s\/\d+-|<img/);
      expect(screen.getByText("VIP access comes with the printed book")).toBeInTheDocument();
      cleanup();
    }
    expect(h.redirected).toBeNull();
  });

  it("is noindex and disallowed in robots.txt, for AI crawlers too", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    const { rules } = robots();
    for (const group of rules as { disallow: string[] }[]) {
      expect(group.disallow).toContain("/comics/early");
    }
  });
});

describe("the public side", () => {
  const src = (file: string) => readFileSync(path.join(process.cwd(), "src", file), "utf8");

  it("public reads don't see an unreleased story", async () => {
    const eps = (await listReleasedWeekly()).map((s) => s.ep);
    expect(eps).toEqual([27]);
  });

  it.each([
    "app/(tools)/comics/page.tsx",
    "app/(tools)/comics/sitemap.ts",
    "app/(tools)/comics/feed.xml/route.ts",
    "app/(tools)/comics/ep/[n]/page.tsx",
    "app/(tools)/comics/poster/[n]/page.tsx",
    "lib/comics/feed.ts",
  ])("%s never calls an early read", (file) => {
    expect(src(file)).not.toMatch(/listEarlyWeekly|getEarlyStory/);
  });

  it.each(["app/(tools)/comics/ep/[n]/page.tsx", "app/(tools)/comics/poster/[n]/page.tsx"])(
    "%s carries the same Read ahead link",
    (file) => {
      expect(src(file)).toContain("<ReadAheadLink />");
    }
  );

  it("the Read ahead link goes to /comics/early with no prefetch", async () => {
    const { ReadAheadLink } = await import("@/app/(tools)/comics/components/read-ahead-link");
    render(<ReadAheadLink />);
    const link = screen.getByRole("link", { name: "Read ahead" });
    expect(link).toHaveAttribute("href", "/comics/early");
    expect(link).toHaveAttribute("rel", "nofollow");
  });
});

describe("the middleware", () => {
  async function run(url: string) {
    const { middleware } = await import("@/middleware");
    return middleware(new NextRequest(`https://agile.test${url}`));
  }

  it("rewrites /comics?ep=NN and leaves /comics/early?ep=NN alone", async () => {
    const story = await run("/comics?ep=30");
    expect(story.headers.get("x-middleware-rewrite")).toContain("/comics/ep/30");
    for (const url of ["/comics/early", "/comics/early?ep=30", "/comics/early?ep=30&b=1"]) {
      const res = await run(url);
      expect(res.headers.get("x-middleware-rewrite"), url).toBeNull();
      expect(res.headers.get("location"), url).toBeNull();
    }
  });

  it("doesn't send /comics/early anywhere as an internal page", async () => {
    const { comicInternalRedirect, comicRewritePath } = await import("@/lib/comics/entry");
    expect(comicInternalRedirect("/comics/early")).toBeNull();
    expect(comicRewritePath(new URLSearchParams("ep=30"))).toBe("/comics/ep/30");
  });
});
