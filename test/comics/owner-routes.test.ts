// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { OwnerStory, StoredPanel } from "@/lib/comics/story-input";

const ART = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}.webp`;

/** A hand-rolled Supabase double: enough query chain for these routes, nothing more. */
const h = vi.hoisted(() => ({
  auth: null as Response | null,
  adminCalls: 0,
  rows: [] as Record<string, unknown>[],
  writes: [] as { table: string; op: string; value?: unknown; ep?: unknown }[],
  rpc: vi.fn(async () => ({ error: null as { message: string } | null })),
  signed: vi.fn(async (path: string) => ({
    data: { path, token: "tok" },
    error: null as { message: string } | null,
  })),
  revalidated: [] as string[],
  bucket: [] as Record<string, unknown>[],
  removed: [] as string[][],
  entryRows: [] as Record<string, unknown>[],
  visitRows: [] as Record<string, unknown>[],
  since: [] as { table: string; column: string; value: unknown }[],
  missing: new Set<string>(),
  existsThrows: false,
  existsCalls: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => h.revalidated.push(path),
}));
vi.mock("@/lib/auth/require-user", () => ({
  requireAuthorizedUser: async () => {
    if (h.auth) throw h.auth;
    return { user: { id: "owner" }, supabase: {} };
  },
}));

function storyQuery(table: string) {
  const state: { ep?: unknown; op: string; value?: unknown } = { op: "select" };
  const result = () => {
    if (state.op === "update" || state.op === "delete" || state.op === "insert") {
      h.writes.push({ table, op: state.op, value: state.value, ep: state.ep });
    }
    if (state.op === "update" && state.ep !== undefined) {
      const row = h.rows.find((r) => r.ep === state.ep);
      if (!row) return { data: null, error: null };
      Object.assign(row, state.value);
      return { data: row, error: null };
    }
    if (state.op === "insert") {
      const row = {
        source_id: null,
        title: "",
        lesson: "",
        squad_question: "",
        cast_names: [],
        themes: [],
        panels: [],
        share_path: null,
        book_page: null,
        release_at: null,
        updated_at: "2026-11-02T00:00:00.000Z",
        ...(state.value as object),
      };
      h.rows.push(row);
      return { data: row, error: null };
    }
    if (state.ep !== undefined) {
      return { data: h.rows.find((r) => r.ep === state.ep) ?? null, error: null };
    }
    if (table === "comic_entry_counts") return { data: h.entryRows, error: null };
    if (table === "comic_visit_counts") return { data: h.visitRows, error: null };
    return { data: h.rows, error: null };
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    insert: (value: unknown) => {
      state.op = "insert";
      state.value = value;
      return chain;
    },
    update: (value: unknown) => {
      state.op = "update";
      state.value = value;
      return chain;
    },
    delete: () => {
      state.op = "delete";
      return chain;
    },
    eq: (column: string, value: unknown) => {
      if (column === "ep") state.ep = value;
      return chain;
    },
    is: () => chain,
    gte: (column: string, value: unknown) => {
      h.since.push({ table, column, value });
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    range: () => chain,
    returns: () => chain,
    single: async () => result(),
    maybeSingle: async () => result(),
    then: (resolve: (v: unknown) => unknown) => resolve(result()),
  };
  return chain;
}

vi.mock("@/lib/squads/server", () => ({
  getSquadAdminClient: () => {
    h.adminCalls += 1;
    return {
      from: storyQuery,
      rpc: h.rpc,
      storage: {
        from: () => ({
          createSignedUploadUrl: h.signed,
          list: async () => ({ data: h.bucket, error: null }),
          exists: async (path: string) => {
            h.existsCalls.push(path);
            if (h.existsThrows) throw new Error("storage is down");
            return { data: !h.missing.has(path), error: null };
          },
          remove: async (paths: string[]) => {
            h.removed.push(paths);
            return { error: null };
          },
        }),
      },
    };
  },
}));

import * as uploadUrl from "@/app/api/comics/upload-url/route";
import * as stories from "@/app/api/comics/stories/route";
import * as story from "@/app/api/comics/stories/[ep]/route";
import * as release from "@/app/api/comics/stories/[ep]/release/route";
import * as reorder from "@/app/api/comics/queue/reorder/route";
import * as schedule from "@/app/api/comics/queue/schedule/route";
import * as unused from "@/app/api/comics/unused-art/route";
import * as entries from "@/app/api/comics/entries/route";
import * as licence from "@/app/api/comics/licence-requests/route";
import * as licenceOne from "@/app/api/comics/licence-requests/[id]/route";
import * as notes from "@/app/api/comics/guestbook-notes/route";
import * as noteOne from "@/app/api/comics/guestbook-notes/[id]/route";
import * as extras from "@/app/api/comics/stories/[ep]/extras/route";

const HOST = "agile.test";
const UUID = "11111111-1111-4111-8111-111111111111";

function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`https://${HOST}${path}`, {
    method,
    headers: { host: HOST, ...(method === "GET" ? {} : { origin: `https://${HOST}` }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

type Handler = (req: NextRequest, ctx: never) => Promise<Response>;
const call = (handler: unknown, request: NextRequest, params: object = {}) =>
  (handler as Handler)(request, { params } as never);

const panel = (over: Partial<StoredPanel> = {}): StoredPanel => ({
  pathFull: ART(1),
  pathSmall: ART(2),
  width: 1536,
  height: 1024,
  alt: "Two colleagues at a printer.",
  dialogue: [],
  signs: [],
  needsReview: false,
  creditCorner: "bottom-right",
  ...over,
});

function row(ep: number, over: Record<string, unknown> = {}) {
  return {
    ep,
    collection: ep <= 26 ? "book" : "weekly",
    source_id: null,
    title: `Story ${ep}`,
    lesson: "",
    squad_question: "",
    cast_names: [],
    themes: [],
    panels: [panel()],
    share_path: ART(3),
    book_page: null,
    release_at: null,
    first_released_at: null,
    updated_at: "2026-11-01T00:00:00.000Z",
    ...over,
  };
}

const PAST = "2026-01-01T07:00:00.000Z";
const FUTURE = "2099-01-05T07:00:00.000Z";

beforeEach(() => {
  h.auth = null;
  h.adminCalls = 0;
  h.rows = [];
  h.writes = [];
  h.revalidated = [];
  h.bucket = [];
  h.removed = [];
  h.entryRows = [];
  h.visitRows = [];
  h.since = [];
  h.missing = new Set();
  h.existsThrows = false;
  h.existsCalls = [];
  h.rpc.mockClear();
  h.rpc.mockResolvedValue({ error: null });
  h.signed.mockClear();
});

/** Every owner route and method. A new one must be added here. */
const ROUTES: [string, unknown, string, object?][] = [
  ["POST /upload-url", uploadUrl.POST, "POST"],
  ["GET /stories", stories.GET, "GET"],
  ["POST /stories", stories.POST, "POST"],
  ["PATCH /stories/27", story.PATCH, "PATCH", { ep: "27" }],
  ["DELETE /stories/27", story.DELETE, "DELETE", { ep: "27" }],
  ["PUT /stories/27/release", release.PUT, "PUT", { ep: "27" }],
  ["POST /queue/reorder", reorder.POST, "POST"],
  ["POST /queue/schedule", schedule.POST, "POST"],
  ["GET /unused-art", unused.GET, "GET"],
  ["POST /unused-art", unused.POST, "POST"],
  ["GET /entries", entries.GET, "GET"],
  ["GET /licence-requests", licence.GET, "GET"],
  ["PATCH /licence-requests/id", licenceOne.PATCH, "PATCH", { id: UUID }],
  ["DELETE /licence-requests/id", licenceOne.DELETE, "DELETE", { id: UUID }],
  ["GET /guestbook-notes", notes.GET, "GET"],
  ["PATCH /guestbook-notes/id", noteOne.PATCH, "PATCH", { id: UUID }],
  ["DELETE /guestbook-notes/id", noteOne.DELETE, "DELETE", { id: UUID }],
  ["GET /stories/27/extras", extras.GET, "GET", { ep: "27" }],
  ["PUT /stories/27/extras", extras.PUT, "PUT", { ep: "27" }],
];

/**
 * The public forms, the middleware's exact-match bypasses (isBypassPath). Each
 * checks its own Origin and limits; nothing else under api/comics may skip the
 * owner check.
 */
const PUBLIC = ["POST /guestbook", "POST /hit", "POST /licence"];

const METHOD = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";

/**
 * Every HTTP method a route file under api/comics exports, as "PATCH /stories/[ep]",
 * split by whether ownerRoute wraps it. A re-export counts as not wrapped.
 */
function routesOnDisk(): { owner: string[]; other: string[] } {
  const root = path.resolve(__dirname, "../../src/app/api/comics");
  const owner: string[] = [];
  const other: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^route\.[jt]sx?$/.test(entry.name)) {
        const source = readFileSync(full, "utf8");
        const route = path.relative(root, dir).split(path.sep).join("/");
        const declared = new RegExp(
          `^export\\s+(?:const|async\\s+function|function)\\s+(${METHOD})\\b(.*)$`,
          "gm"
        );
        for (const [, method, rest] of Array.from(source.matchAll(declared))) {
          (/^\s*(?::[^=]*)?=\s*ownerRoute\b/.test(rest) ? owner : other).push(
            `${method} /${route}`
          );
        }
        const reexported = new RegExp(`^export\\s*\\{[^}]*\\b(${METHOD})\\b`, "gm");
        for (const [, method] of Array.from(source.matchAll(reexported))) {
          other.push(`${method} /${route}`);
        }
      }
    }
  };
  walk(root);
  return { owner: owner.sort(), other: other.sort() };
}

describe("every owner route", () => {
  it("is in the list above, so none skips the checks below", () => {
    const listed = ROUTES.map(([name]) =>
      name.replace(/\/27(?=\/|$)/, "/[ep]").replace(/\/id$/, "/[id]")
    ).sort();
    expect(listed).toEqual(routesOnDisk().owner);
  });

  it("is everything but the public forms: a new route goes through ownerRoute or is listed", () => {
    expect(routesOnDisk().other).toEqual(PUBLIC);
  });

  it.each(ROUTES)("%s answers 401 to someone signed out", async (_n, handler, method, params) => {
    h.auth = Response.json({ error: "unauthenticated" }, { status: 401 });
    const res = await call(
      handler,
      req(method, "/api/comics/x", method === "GET" ? undefined : {}),
      params
    );
    expect(res.status).toBe(401);
    expect(h.adminCalls).toBe(0);
  });

  it.each(ROUTES)("%s answers 403 to anyone else", async (_n, handler, method, params) => {
    h.auth = Response.json({ error: "not_authorized" }, { status: 403 });
    const res = await call(
      handler,
      req(method, "/api/comics/x", method === "GET" ? undefined : {}),
      params
    );
    expect(res.status).toBe(403);
    expect(h.adminCalls).toBe(0);
  });

  it.each(ROUTES.filter(([, , method]) => method !== "GET"))(
    "%s refuses a write from another site",
    async (_n, handler, method, params) => {
      const res = await call(
        handler,
        req(method, "/api/comics/x", {}, { origin: "https://evil.example" }),
        params
      );
      expect(res.status).toBe(403);
      expect(h.adminCalls).toBe(0);
    }
  );
});

describe("POST /api/comics/upload-url", () => {
  it.each([
    ["image/webp", /\.webp$/],
    ["image/jpeg", /\.jpg$/],
  ])("signs an unguessable path for %s", async (contentType, extension) => {
    const res = await call(uploadUrl.POST, req("POST", "/", { contentType }));
    expect(res.status).toBe(200);
    const { path, token } = await res.json();
    expect(path).toMatch(/^[0-9a-f-]{36}\./);
    expect(path).toMatch(extension);
    expect(token).toBe("tok");
  });

  it.each(["image/png", "image/svg+xml", "text/html", "constructor", 7, undefined])(
    "refuses %s",
    async (contentType) => {
      const res = await call(uploadUrl.POST, req("POST", "/", { contentType }));
      expect(res.status).toBe(400);
      expect(h.signed).not.toHaveBeenCalled();
    }
  );
});

describe("creating a story", () => {
  it("takes the next weekly number and is always a draft", async () => {
    h.rows = [row(27), row(40)];
    const res = await call(
      stories.POST,
      req("POST", "/", { title: "New", releaseAt: FUTURE, release_at: FUTURE })
    );
    expect(res.status).toBe(201);
    const { story: created } = (await res.json()) as { story: OwnerStory };
    expect(created.ep).toBe(41);
    expect(created.collection).toBe("weekly");
    expect(created.releaseAt).toBeNull();
    expect(h.revalidated).toContain("/comics/ep/41");
  });

  it("refuses a field over its limit", async () => {
    const res = await call(stories.POST, req("POST", "/", { title: "x".repeat(121) }));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("title");
    expect(h.writes).toEqual([]);
  });

  it("refuses a path no upload URL could have handed out", async () => {
    const res = await call(
      stories.POST,
      req("POST", "/", {
        panels: [panel({ pathFull: "../../secret.webp" })],
      })
    );
    expect(res.status).toBe(400);
  });

  it("refuses art that isn't in storage", async () => {
    h.missing = new Set([ART(1)]);
    const res = await call(stories.POST, req("POST", "/", { title: "T", panels: [panel()] }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("art_missing");
    expect(body.paths).toEqual([ART(1)]);
    expect(h.writes).toEqual([]);
  });

  it("checks nothing when there's no art yet", async () => {
    await call(stories.POST, req("POST", "/", { title: "T" }));
    expect(h.existsCalls).toEqual([]);
  });
});

describe("publishing", () => {
  it("is refused while a panel has no description", async () => {
    h.rows = [row(27, { panels: [panel(), panel({ alt: "  " })] })];
    const res = await call(release.PUT, req("PUT", "/", { releaseAt: FUTURE }), { ep: "27" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("incomplete_story");
    expect(body.problems).toEqual(["Panel 2 has no description."]);
    expect(h.writes).toEqual([]);
  });

  it("is refused while a panel has no art", async () => {
    h.rows = [row(27, { panels: [panel({ pathFull: "", pathSmall: "" })] })];
    const res = await call(release.PUT, req("PUT", "/", { releaseAt: FUTURE }), { ep: "27" });
    expect(res.status).toBe(409);
    expect((await res.json()).problems).toEqual(["Panel 1 has no art."]);
  });

  it("schedules a complete story and refreshes its concrete paths", async () => {
    h.rows = [row(27)];
    const res = await call(release.PUT, req("PUT", "/", { releaseAt: FUTURE }), { ep: "27" });
    expect(res.status).toBe(200);
    expect(h.rows[0].release_at).toBe(FUTURE);
    expect(h.revalidated).toEqual(
      expect.arrayContaining([
        "/comics",
        "/comics/ep/27",
        "/comics/feed.xml",
        "/comics/sitemap.xml",
      ])
    );
  });

  it("refreshes the story's own page and the list", async () => {
    h.rows = [row(27)];
    await call(release.PUT, req("PUT", "/", { releaseAt: PAST }), { ep: "27" });
    expect(h.revalidated).toEqual(expect.arrayContaining(["/comics", "/comics/ep/27"]));
    expect(h.revalidated.some((p: string) => p.includes("/poster/"))).toBe(false);
  });

  it("unpublishes without checking anything, keeping the number", async () => {
    h.rows = [row(27, { release_at: PAST, panels: [] })];
    const res = await call(release.PUT, req("PUT", "/", { releaseAt: null }), { ep: "27" });
    expect(res.status).toBe(200);
    expect(h.rows[0].release_at).toBeNull();
  });

  it("stops for panels still marked for review, unless told to go ahead", async () => {
    h.rows = [row(27, { panels: [panel({ needsReview: true }), panel()] })];
    const refused = await call(release.PUT, req("PUT", "/", { releaseAt: FUTURE }), { ep: "27" });
    expect(refused.status).toBe(409);
    const body = await refused.json();
    expect(body.error).toBe("needs_review");
    expect(body.panels).toBe(1);
    expect(h.writes).toEqual([]);

    // Only a real yes counts.
    const truthy = await call(
      release.PUT,
      req("PUT", "/", { releaseAt: FUTURE, allowUnreviewed: "true" }),
      { ep: "27" }
    );
    expect(truthy.status).toBe(409);

    const allowed = await call(
      release.PUT,
      req("PUT", "/", { releaseAt: FUTURE, allowUnreviewed: true }),
      { ep: "27" }
    );
    expect(allowed.status).toBe(200);
    expect(h.rows[0].release_at).toBe(FUTURE);
  });

  it("unpublishes a story with unreviewed panels without asking", async () => {
    h.rows = [row(27, { release_at: PAST, panels: [panel({ needsReview: true })] })];
    const res = await call(release.PUT, req("PUT", "/", { releaseAt: null }), { ep: "27" });
    expect(res.status).toBe(200);
  });

  it("is refused when a picture has gone from storage", async () => {
    h.rows = [row(27)];
    h.missing = new Set([ART(3)]);
    const res = await call(release.PUT, req("PUT", "/", { releaseAt: FUTURE }), { ep: "27" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("art_missing");
    expect(body.paths).toEqual([ART(3)]);
    expect(h.writes).toEqual([]);
  });

  it("answers 503 rather than publish when storage can't be asked", async () => {
    h.rows = [row(27)];
    h.existsThrows = true;
    const res = await call(release.PUT, req("PUT", "/", { releaseAt: FUTURE }), { ep: "27" });
    expect(res.status).toBe(503);
    expect(h.writes).toEqual([]);
  });

  it("refuses a date it can't read", async () => {
    h.rows = [row(27)];
    const res = await call(release.PUT, req("PUT", "/", { releaseAt: "soon" }), { ep: "27" });
    expect(res.status).toBe(400);
  });
});

describe("editing", () => {
  it("won't let a live story lose a description", async () => {
    h.rows = [row(27, { release_at: PAST })];
    const res = await call(story.PATCH, req("PATCH", "/", { panels: [panel({ alt: "" })] }), {
      ep: "27",
    });
    expect(res.status).toBe(409);
    expect(h.writes).toEqual([]);
  });

  it("lists replaced art and deletes nothing", async () => {
    h.rows = [row(27)];
    const res = await call(
      story.PATCH,
      req("PATCH", "/", { panels: [panel({ pathFull: ART(8), pathSmall: ART(9) })] }),
      { ep: "27" }
    );
    expect(res.status).toBe(200);
    expect((await res.json()).replacedPaths).toEqual([ART(1), ART(2)]);
    expect(h.removed).toEqual([]);
  });

  it("refuses new art whose files have gone, as a draft held for days can have", async () => {
    h.rows = [row(27)];
    h.missing = new Set([ART(8)]);
    const res = await call(
      story.PATCH,
      req("PATCH", "/", { panels: [panel({ pathFull: ART(8), pathSmall: ART(9) })] }),
      { ep: "27" }
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("art_missing");
    expect(body.paths).toEqual([ART(8)]);
    expect(h.writes).toEqual([]);
  });

  it("checks only the art an edit brings in", async () => {
    h.rows = [row(27)];
    await call(story.PATCH, req("PATCH", "/", { title: "New title", panels: [panel()] }), {
      ep: "27",
    });
    expect(h.existsCalls).toEqual([]);
    await call(
      story.PATCH,
      req("PATCH", "/", { panels: [panel({ pathFull: ART(8) })], sharePath: ART(7) }),
      { ep: "27" }
    );
    expect(h.existsCalls.sort()).toEqual([ART(7), ART(8)].sort());
  });

  it("can't change a story's source id or a weekly story's book page", async () => {
    h.rows = [row(27, { source_id: "AAW-N001" })];
    await call(story.PATCH, req("PATCH", "/", { sourceId: "other", bookPage: 9 }), { ep: "27" });
    expect(h.rows[0].source_id).toBe("AAW-N001");
    expect(h.rows[0].book_page).toBeNull();
  });
});

describe("deleting", () => {
  it("removes a draft", async () => {
    h.rows = [row(27)];
    const res = await call(story.DELETE, req("DELETE", "/"), { ep: "27" });
    expect(res.status).toBe(200);
    expect(h.writes.map((w) => w.op)).toEqual(["delete"]);
  });

  it.each([PAST, FUTURE])("refuses a story with a date (%s)", async (releaseAt) => {
    h.rows = [row(27, { release_at: releaseAt })];
    const res = await call(story.DELETE, req("DELETE", "/"), { ep: "27" });
    expect(res.status).toBe(409);
    expect(h.writes).toEqual([]);
  });

  it("refuses a story that has been out, even unpublished", async () => {
    h.rows = [row(27, { first_released_at: PAST })];
    const res = await call(story.DELETE, req("DELETE", "/"), { ep: "27" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("was_released");
    expect(h.writes).toEqual([]);
  });
});

describe("reordering the queue", () => {
  it("swaps unreleased weekly stories in one transaction", async () => {
    h.rows = [row(30), row(31)];
    const res = await call(reorder.POST, req("POST", "/", { order: [31, 30] }));
    expect(res.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith("comic_reorder_queue", {
      p_slots: [30, 31],
      p_stories: [31, 30],
    });
    expect(h.revalidated).toEqual(expect.arrayContaining(["/comics/ep/30", "/comics/ep/31"]));
  });

  it("can't touch a released story", async () => {
    h.rows = [row(30, { release_at: PAST }), row(31)];
    const res = await call(reorder.POST, req("POST", "/", { order: [31, 30] }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("not_in_queue");
    expect(body.ep).toBe(30);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it.each([null, FUTURE])("can't touch a story that has been out (date now %s)", async (date) => {
    h.rows = [row(30, { release_at: date, first_released_at: PAST }), row(31)];
    const res = await call(reorder.POST, req("POST", "/", { order: [31, 30] }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("not_in_queue");
    expect(body.ep).toBe(30);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("can't put an unreviewed draft into a dated slot", async () => {
    h.rows = [row(30, { release_at: FUTURE }), row(31, { panels: [panel({ needsReview: true })] })];
    const res = await call(reorder.POST, req("POST", "/", { order: [31, 30] }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("needs_review");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("can't touch a book episode", async () => {
    h.rows = [row(12), row(31)];
    const res = await call(reorder.POST, req("POST", "/", { order: [31, 12] }));
    expect(res.status).toBe(409);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("can't put an unfinished story into a dated slot", async () => {
    h.rows = [row(30, { release_at: FUTURE }), row(31, { panels: [panel({ alt: "" })] })];
    const res = await call(reorder.POST, req("POST", "/", { order: [31, 30] }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("incomplete_story");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it.each([[[30]], [[30, 30]], ["30,31"], [[30, 31.5]]])("refuses order %j", async (order) => {
    h.rows = [row(30), row(31)];
    const res = await call(reorder.POST, req("POST", "/", { order }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/comics/queue/schedule", () => {
  it("writes the previewed dates", async () => {
    h.rows = [row(27), row(28)];
    const res = await call(
      schedule.POST,
      req("POST", "/", {
        items: [
          { ep: 27, releaseAt: FUTURE },
          { ep: 28, releaseAt: FUTURE },
        ],
      })
    );
    expect(res.status).toBe(200);
    expect(h.rows.map((r) => r.release_at)).toEqual([FUTURE, FUTURE]);
  });

  it("writes nothing if any story isn't ready", async () => {
    h.rows = [row(27), row(28, { panels: [panel({ alt: "" })] })];
    const res = await call(
      schedule.POST,
      req("POST", "/", {
        items: [
          { ep: 27, releaseAt: FUTURE },
          { ep: 28, releaseAt: FUTURE },
        ],
      })
    );
    expect(res.status).toBe(409);
    expect(h.writes).toEqual([]);
  });

  it("writes nothing while a story has unreviewed panels, unless told to go ahead", async () => {
    h.rows = [row(27), row(28, { panels: [panel({ needsReview: true })] })];
    const items = [
      { ep: 27, releaseAt: FUTURE },
      { ep: 28, releaseAt: FUTURE },
    ];
    const refused = await call(schedule.POST, req("POST", "/", { items }));
    expect(refused.status).toBe(409);
    const body = await refused.json();
    expect(body.error).toBe("needs_review");
    expect(body.ep).toBe(28);
    expect(h.writes).toEqual([]);

    const allowed = await call(schedule.POST, req("POST", "/", { items, allowUnreviewed: true }));
    expect(allowed.status).toBe(200);
    expect(h.rows.map((r) => r.release_at)).toEqual([FUTURE, FUTURE]);
  });

  it("won't redate a story that has been out and was unpublished", async () => {
    h.rows = [row(27, { first_released_at: PAST })];
    const res = await call(
      schedule.POST,
      req("POST", "/", { items: [{ ep: 27, releaseAt: FUTURE }] })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_in_queue");
    expect(h.writes).toEqual([]);
  });

  it("won't redate a released story", async () => {
    h.rows = [row(27, { release_at: PAST })];
    const res = await call(
      schedule.POST,
      req("POST", "/", { items: [{ ep: 27, releaseAt: FUTURE }] })
    );
    expect(res.status).toBe(409);
    expect(h.writes).toEqual([]);
  });
});

describe("unused art", () => {
  const OLD = "2026-01-01T00:00:00.000Z";

  it("lists only old files no story uses, and removes nothing by itself", async () => {
    h.rows = [row(27)];
    h.bucket = [
      { name: ART(1), created_at: OLD },
      { name: ART(7), created_at: OLD, metadata: { size: 100 } },
      { name: ART(8), created_at: new Date().toISOString() },
      { name: ".emptyFolderPlaceholder", created_at: OLD },
    ];
    const res = await call(unused.GET, req("GET", "/"));
    const { files } = await res.json();
    expect(files).toEqual([{ path: ART(7), size: 100, createdAt: OLD }]);
    expect(h.removed).toEqual([]);
  });

  it("deletes what was asked for, except a file a story uses by now", async () => {
    h.rows = [row(27)];
    h.bucket = [
      { name: ART(1), created_at: OLD },
      { name: ART(7), created_at: OLD },
    ];
    const res = await call(unused.POST, req("POST", "/", { paths: [ART(1), ART(7)] }));
    expect((await res.json()).removed).toBe(1);
    expect(h.removed).toEqual([[ART(7)]]);
  });

  it("won't delete a file too young to be listed, however it's asked", async () => {
    h.bucket = [
      { name: ART(7), created_at: new Date().toISOString() },
      { name: ART(8), created_at: OLD },
    ];
    const res = await call(unused.POST, req("POST", "/", { paths: [ART(7), ART(8)] }));
    expect((await res.json()).removed).toBe(1);
    expect(h.removed).toEqual([[ART(8)]]);
  });

  it("refuses a path outside the art names", async () => {
    const res = await call(unused.POST, req("POST", "/", { paths: ["../other-bucket/file.png"] }));
    expect(res.status).toBe(400);
    expect(h.removed).toEqual([]);
  });
});

describe("GET /api/comics/entries", () => {
  it("answers each month's visits by printed piece and episode, with VIP activations", async () => {
    h.visitRows = [
      { month: "2026-11-01", path: "/comics", src: "poster", ep: 12, count: 4 },
      { month: "2026-11-01", path: "/comics", src: "kudos", ep: 12, count: "2" },
      { month: "2026-11-01", path: "/kudos", src: "sign", ep: 0, count: 5 },
      { month: "2026-10-01", path: "/comics", src: "none", ep: 0, count: 7 },
    ];
    h.entryRows = [{ day: "2026-11-03", count: 1 }];
    const res = await call(entries.GET, req("GET", "/api/comics/entries"));
    const { months, summary } = await res.json();
    expect(months).toBe(12);
    expect(summary.map((m: { month: string }) => m.month)).toEqual(["2026-11-01", "2026-10-01"]);
    expect(summary[0]).toMatchObject({
      total: 12,
      vip: 1,
      bySource: { poster: 4, kudos: 2, sign: 5, none: 0 },
      byEpisode: [{ ep: 12, poster: 4, kudos: 2 }],
    });
    expect(summary[1]).toMatchObject({ total: 7, vip: 0, byEpisode: [] });
  });

  it("reads both tables from the first day of the earliest month asked for", async () => {
    await call(entries.GET, req("GET", "/api/comics/entries?months=3"));
    expect(h.since.map((s) => [s.table, s.column])).toEqual([
      ["comic_visit_counts", "month"],
      ["comic_entry_counts", "day"],
    ]);
    const [visits, vip] = h.since.map((s) => s.value);
    expect(visits).toMatch(/^\d{4}-\d{2}-01$/);
    expect(vip).toBe(visits);
  });

  it.each(["0", "61", "2.5", "a year"])("asks for a year when months is %s", async (months) => {
    const res = await call(entries.GET, req("GET", `/api/comics/entries?months=${months}`));
    expect((await res.json()).months).toBe(12);
  });
});

describe("licence requests", () => {
  it("refuses an id that isn't a uuid", async () => {
    const res = await call(licenceOne.DELETE, req("DELETE", "/"), { id: "1 or 1=1" });
    expect(res.status).toBe(400);
    expect(h.writes).toEqual([]);
  });

  it("wants a real yes or no for handled", async () => {
    const res = await call(licenceOne.PATCH, req("PATCH", "/", { handled: "yes" }), { id: UUID });
    expect(res.status).toBe(400);
  });
});
