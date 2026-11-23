// @vitest-environment node
/**
 * The privacy page says the forms keep what you typed and the counts keep
 * totals, with no IP address and nothing about your browser, and that the
 * weather's place is neither logged nor sent back. These hold those claims to
 * what the code does, not to what its comments say: the columns the
 * migrations give each table, the rows the routes write for a request that
 * carries an IP address, a user agent and a cookie, and what the weather route
 * logs, asks and answers. A migration that adds a column, or a route that
 * starts writing a header, fails here until the page is checked again.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  key: "privacykey123",
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/squads/server", () => ({
  getSquadAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({ is: async () => ({ count: 0, error: null }) }),
      insert: async (row: Record<string, unknown>) => {
        h.inserts.push({ table, row });
        return { error: null };
      },
    }),
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.rpcs.push({ fn, args });
      // The book's route chains .abortSignal(); the count route awaits the call.
      const result = Promise.resolve({ error: null });
      return Object.assign(result, { abortSignal: () => result });
    },
  }),
}));
vi.mock("@/lib/vip/book-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vip/book-access")>();
  const hashes = [createHash("sha256").update(h.key).digest("hex")];
  return {
    ...actual,
    isVipKey: (raw: string | null | undefined) => actual.isVipKey(raw, hashes),
  };
});

import { POST as postGuestbook } from "@/app/api/comics/guestbook/route";
import { POST as postHit } from "@/app/api/comics/hit/route";
import { POST as postLicence } from "@/app/api/comics/licence/route";
import { GET as getWeather } from "@/app/api/mascot/weather/route";
import { GET as openBookLink } from "@/app/vip/[key]/route";
import { EMPTY_GUESTBOOK_DRAFT } from "@/lib/comics/guestbook";
import { EMPTY_LICENCE_DRAFT } from "@/lib/comics/licence";
import { privacyRows } from "@/lib/site/privacy";
import { VIP_COOKIE } from "@/lib/vip/book-access";
import { VIP_HINT_COOKIE } from "@/lib/vip/constants";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const said = (id: string) => {
  const row = privacyRows().find((r) => r.id === id);
  if (!row) throw new Error(`no "${id}" row`);
  return [...row.leaves, ...row.kept].map((item) => item.text).join(" ");
};

const HOST = "agile.test";
const IP = "203.0.113.77";
const UA = "Mozilla/5.0 (PrivacyCheck)";
const COOKIE = "sb-session=private-cookie-value";
/** What a browser sends with every request, and none of it may be kept. */
const IDENTIFYING = [IP, UA, "PrivacyCheck", "private-cookie-value"];

let n = 0;
/** A request from the site's own page, from a fresh address, carrying all of the above. */
function post(url: string, body: unknown) {
  n += 1;
  return new NextRequest(`https://${HOST}${url}`, {
    method: "POST",
    headers: {
      host: HOST,
      origin: `https://${HOST}`,
      "x-forwarded-for": IP,
      "x-real-ip": `198.51.100.${n}`,
      "user-agent": UA,
      cookie: COOKIE,
    },
    body: JSON.stringify(body),
  });
}

const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

// ── The tables, as the migrations build them ────────────────────────────

const MIGRATIONS = readdirSync(path.join(root, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => read(`supabase/migrations/${name}`).replace(/--.*$/gm, ""));

/** The text between the bracket at `open` and the one that closes it. */
function bracketed(sql: string, open: number): string {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")" && --depth === 0) return sql.slice(open + 1, i);
  }
  throw new Error("unclosed bracket");
}

/** Splits on the commas that aren't inside brackets. */
function topLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "(") depth++;
    else if (body[i] === ")") depth--;
    else if (body[i] === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

const NOT_A_COLUMN = new Set(["constraint", "primary", "unique", "check", "foreign", "exclude"]);

interface Column {
  name: string;
  type: string;
}

/** Every column a table has after all the migrations: created, added, renamed, dropped. */
function columnsOf(table: string): Column[] {
  const columns = new Map<string, string>();
  const name = `(?:public\\.)?"?${table}"?`;
  for (const sql of MIGRATIONS) {
    const create = new RegExp(
      `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${name}\\s*\\(`,
      "gi"
    );
    for (const m of Array.from(sql.matchAll(create))) {
      for (const part of topLevel(bracketed(sql, m.index! + m[0].length - 1))) {
        const [col, type = ""] = part.replace(/"/g, "").split(/\s+/);
        if (!NOT_A_COLUMN.has(col.toLowerCase()))
          columns.set(col.toLowerCase(), type.toLowerCase());
      }
    }
    const alter = new RegExp(
      `alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${name}\\s([^;]*);`,
      "gi"
    );
    for (const m of Array.from(sql.matchAll(alter))) {
      const actions = m[1].replace(/"/g, "");
      const adds = actions.matchAll(
        /\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(\w+)\s+(\w+)/gi
      );
      for (const [, col, type] of Array.from(adds)) {
        if (!NOT_A_COLUMN.has(col.toLowerCase()))
          columns.set(col.toLowerCase(), type.toLowerCase());
      }
      const renames = actions.matchAll(/\brename\s+(?:column\s+)?(\w+)\s+to\s+(\w+)/gi);
      for (const [, from, to] of Array.from(renames)) {
        const type = columns.get(from.toLowerCase());
        if (type === undefined) continue;
        columns.delete(from.toLowerCase());
        columns.set(to.toLowerCase(), type);
      }
      const drops = actions.matchAll(/\bdrop\s+column\s+(?:if\s+exists\s+)?(\w+)/gi);
      for (const [, col] of Array.from(drops)) columns.delete(col.toLowerCase());
    }
  }
  return Array.from(columns, ([col, type]) => ({ name: col, type }));
}

/** A column that could hold something about a person's browser or connection. */
const ABOUT_THE_BROWSER =
  /(?:^|_)(?:ip|ips|inet|addr|address|user_agent|ua|agent|cookie|session|fingerprint|device|referr?er|headers?|geo|lat|lon|city|country)(?:_|$)/i;

/** The columns each table the page speaks for has, today. Change one and re-read the page. */
const TABLES: Record<string, string[]> = {
  comic_licence_requests: [
    "id",
    "name",
    "company",
    "email",
    "intended_use",
    "team_size",
    "message",
    "created_at",
    "handled_at",
  ],
  comic_guestbook: ["id", "name", "message", "created_at", "approved_at"],
  comic_visit_counts: ["month", "path", "src", "ep", "count"],
  comic_entry_counts: ["day", "entry", "ep", "building", "count"],
  comic_story_taps: ["ep", "kind", "choice", "count"],
  comic_story_stats: ["ep", "week", "metric", "bucket", "count"],
};

/** The columns a person's answers go in: all but the id and the timestamps. */
const typed = (table: string) =>
  columnsOf(table)
    .map((c) => c.name)
    .filter((c) => c !== "id" && !c.endsWith("_at"));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "1");
  h.inserts.length = 0;
  h.rpcs.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("what the tables can hold", () => {
  it("reads the columns the migrations give a table", () => {
    // A check that the reader works: a table with columns added later on.
    const stories = columnsOf("comic_stories").map((c) => c.name);
    for (const col of ["ep", "first_released_at", "quiz", "guess", "print_shortlist"]) {
      expect(stories).toContain(col);
    }
    expect(columnsOf("no_such_table")).toEqual([]);
  });

  it.each(Object.entries(TABLES))(
    "%s has the columns it had when the page was written",
    (table, cols) => {
      expect(
        columnsOf(table)
          .map((c) => c.name)
          .sort(),
        table
      ).toEqual([...cols].sort());
    }
  );

  it.each(Object.keys(TABLES))("%s has nowhere to put an IP address or a user agent", (table) => {
    for (const col of columnsOf(table)) {
      expect(col.name, `${table}.${col.name}`).not.toMatch(ABOUT_THE_BROWSER);
      expect(col.type, `${table}.${col.name}`).not.toMatch(/^(?:inet|cidr|macaddr)/);
    }
  });

  it("which is what the page says of each", () => {
    expect(said("licence")).toContain("No IP address and nothing about your browser.");
    expect(said("guestbook")).toContain("No IP address and nothing about your browser.");
    expect(said("comics-kudos")).toContain(
      "Nothing about you: no cookies, no account and no IP address."
    );
    expect(said("book-link")).toContain(
      "one is added to that day's anonymous count of new readers."
    );
  });
});

describe("what the routes write", () => {
  it("the licence form keeps exactly what the person typed, in the table's own columns", async () => {
    const draft = {
      name: "Sara Ali",
      company: "Acme",
      email: "sara@acme.example",
      intendedUse: "Slides for an internal training course",
      teamSize: "40",
      message: "Hello",
    };
    expect(Object.keys(draft)).toEqual(Object.keys(EMPTY_LICENCE_DRAFT));
    const res = await postLicence(post("/api/comics/licence", draft));
    expect(res.status).toBe(204);
    expect(h.inserts).toHaveLength(1);
    const [{ table, row }] = h.inserts;
    expect(table).toBe("comic_licence_requests");
    expect(Object.keys(row).sort()).toEqual(Object.keys(EMPTY_LICENCE_DRAFT).map(snake).sort());
    expect(Object.keys(row).sort()).toEqual(typed(table).sort());
    for (const value of IDENTIFYING) expect(JSON.stringify(row)).not.toContain(value);
  });

  it("the guestbook keeps the name and the note, and nothing else", async () => {
    const res = await postGuestbook(
      post("/api/comics/guestbook", { name: "Sara", message: "The approvals story is my office." })
    );
    expect(res.status).toBe(204);
    expect(h.inserts).toHaveLength(1);
    const [{ table, row }] = h.inserts;
    expect(table).toBe("comic_guestbook");
    expect(Object.keys(row).sort()).toEqual(Object.keys(EMPTY_GUESTBOOK_DRAFT).sort());
    expect(Object.keys(row).sort()).toEqual(typed(table).sort());
    for (const value of IDENTIFYING) expect(JSON.stringify(row)).not.toContain(value);
  });

  it("a comics or kudos count passes the page, the printed piece and the episode, and nothing else", async () => {
    const res = await postHit(post("/api/comics/hit", { path: "/comics", src: "poster", ep: 12 }));
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(h.rpcs).toEqual([
      { fn: "comic_visit_hit", args: { p_path: "/comics", p_src: "poster", p_ep: 12 } },
    ]);
    for (const value of IDENTIFYING) expect(JSON.stringify(h.rpcs)).not.toContain(value);
  });

  it("the book's link counts a new reader with no key, cookie or IP, and sets its two cookies", async () => {
    const res = await openBookLink(
      new NextRequest(`https://${HOST}/vip/${h.key}`, {
        headers: { "x-forwarded-for": IP, "user-agent": UA },
      }),
      { params: { key: h.key } }
    );
    expect(h.rpcs).toEqual([
      { fn: "comic_entry_hit", args: { p_entry: "vip", p_ep: 0, p_building: 0 } },
    ]);
    for (const value of [...IDENTIFYING, h.key]) {
      expect(JSON.stringify(h.rpcs)).not.toContain(value);
    }
    expect(
      res.cookies
        .getAll()
        .map((cookie) => cookie.name)
        .sort()
    ).toEqual([VIP_COOKIE, VIP_HINT_COOKIE].sort());
    expect(said("book-link")).toContain("Your browser keeps two cookies");
  });
});

describe("Amr's weather", () => {
  const FORECAST = {
    utc_offset_seconds: 7200,
    current: {
      temperature_2m: 22.5,
      apparent_temperature: 21.5,
      weather_code: 1,
      is_day: 1,
      wind_speed_10m: 9,
      wind_gusts_10m: 14,
    },
    daily: { sunrise: ["2026-11-10T06:15"], sunset: ["2026-11-10T17:02"] },
  };
  const LAT = "30.0444";
  const LON = "31.2357";

  it("asks for a rounded place, answers with the weather alone and logs nothing", async () => {
    const asked: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        asked.push({ url, init });
        return Response.json(url.includes("air-quality") ? { current: { dust: 3 } } : FORECAST);
      })
    );
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {})
    );

    const res = await getWeather(
      new NextRequest(`https://${HOST}/api/mascot/weather`, {
        headers: {
          "x-vercel-ip-latitude": LAT,
          "x-vercel-ip-longitude": LON,
          "x-vercel-ip-city": "Cairo",
          "x-vercel-ip-country": "EG",
          "x-forwarded-for": IP,
          "user-agent": UA,
        },
      })
    );
    expect(res.status).toBe(200);

    // Open-Meteo hears the place rounded to a tenth of a degree, and nothing else.
    expect(asked.length).toBeGreaterThan(0);
    for (const { url, init } of asked) {
      expect(url).toMatch(/^https:\/\/(?:api|air-quality-api)\.open-meteo\.com\//);
      expect(url).toContain("latitude=30&longitude=31.2&");
      for (const value of [LAT, LON, "Cairo", "EG", ...IDENTIFYING]) {
        expect(url).not.toContain(value);
      }
      expect(init?.headers).toBeUndefined();
    }

    // The answer is the weather: no place, rounded or not.
    const text = await res.text();
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(body.temp).toBe(22.5);
    for (const key of Object.keys(body)) {
      expect(key).not.toMatch(/lat|lon|place|city|country|region|where|ip/i);
    }
    for (const value of [LAT, LON, "31.2", "Cairo", "EG", ...IDENTIFYING]) {
      expect(text).not.toContain(value);
    }

    for (const log of logs) expect(log).not.toHaveBeenCalled();
    expect(said("weather")).toContain(
      "The place is not stored or logged, and only the weather comes back."
    );
  });

  it("stores the place nowhere: neither file can reach a database", () => {
    for (const file of [
      "src/app/api/mascot/weather/route.ts",
      "src/lib/agent/mascot/context/weather-server.ts",
    ]) {
      const imports = Array.from(read(file).matchAll(/from\s+["']([^"']+)["']/g)).map((m) => m[1]);
      expect(imports.length, file).toBeGreaterThan(0);
      for (const source of imports) expect(source, file).not.toMatch(/supabase|squads|store|db/i);
    }
  });
});
