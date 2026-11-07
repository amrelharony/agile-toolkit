// @vitest-environment node
/**
 * What the print campaign's counter records for each printed link, what the
 * route lets through, and that migration 0034's checks agree with both.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRINT_SOURCES } from "@/lib/comics/entry";
import campaign from "@/lib/comics/print-campaign.json";
import { VISIT_PATHS, isValidVisit, parseVisit, visitFor, type Visit } from "@/lib/comics/visits";

/** The page a printed link opens, and the visit it records. */
function visitOf(href: string): Visit {
  const url = new URL(href);
  return visitFor(url.pathname as Visit["path"], url.searchParams);
}

describe("each printed link counts as its own piece", () => {
  it.each(campaign.episodes.map((e) => [e.ep, e.qr_poster, e.qr_kudos]))(
    "episode %s: its poster and its kudos card",
    (ep, poster, kudos) => {
      expect(visitOf(poster)).toEqual({ path: "/comics", src: "poster", ep: Number(ep) });
      expect(visitOf(kudos)).toEqual({ path: "/comics", src: "kudos", ep: Number(ep) });
    }
  );

  it("the open kudos cards, the book, the wall sign and the guide", () => {
    expect(visitOf(campaign.kudos.qr_open_cards)).toEqual({
      path: "/comics",
      src: "kudos",
      ep: 0,
    });
    expect(visitOf(campaign.book.qr_book)).toEqual({ path: "/comics", src: "book", ep: 0 });
    expect(visitOf(campaign.kudos.qr_wall_sign)).toEqual({ path: "/kudos", src: "sign", ep: 0 });
    expect(visitOf(campaign.kudos.qr_guide)).toEqual({ path: "/kudos", src: "guide", ep: 0 });
  });

  it("an old building poster counts as that episode's poster", () => {
    expect(visitOf("https://x.test/comics?ep=12&b=3")).toEqual({
      path: "/comics",
      src: "poster",
      ep: 12,
    });
  });

  it("keeps the piece and drops an episode it can't carry", () => {
    expect(visitOf("https://x.test/comics?ep=05&src=book")).toEqual({
      path: "/comics",
      src: "book",
      ep: 0,
    });
    expect(visitOf("https://x.test/kudos?ep=40&src=guide")).toEqual({
      path: "/kudos",
      src: "guide",
      ep: 0,
    });
  });

  it("the comics' own button to kudos", () => {
    expect(visitOf("https://x.test/kudos?ep=07&src=comics")).toEqual({
      path: "/kudos",
      src: "comics",
      ep: 7,
    });
  });
});

describe("anything else counts as no printed piece", () => {
  it.each([
    ["no query", "https://x.test/comics", { path: "/comics", src: "none", ep: 0 }],
    ["a weekly story", "https://x.test/comics?ep=140", { path: "/comics", src: "none", ep: 140 }],
    [
      "an unknown src",
      "https://x.test/comics?ep=05&src=tv",
      { path: "/comics", src: "none", ep: 5 },
    ],
    [
      "a repeated src",
      "https://x.test/comics?ep=05&src=poster&src=kudos",
      { path: "/comics", src: "none", ep: 5 },
    ],
    [
      "a poster for a weekly story",
      "https://x.test/comics?ep=40&src=poster",
      { path: "/comics", src: "none", ep: 40 },
    ],
    [
      "the wall sign on /comics",
      "https://x.test/comics?src=sign",
      { path: "/comics", src: "none", ep: 0 },
    ],
    [
      "a poster on /kudos",
      "https://x.test/kudos?ep=05&src=poster",
      { path: "/kudos", src: "none", ep: 5 },
    ],
    [
      "a weekly story on /kudos",
      "https://x.test/kudos?ep=40",
      { path: "/kudos", src: "none", ep: 0 },
    ],
    [
      "a bad episode",
      "https://x.test/comics?ep=abc&src=poster",
      { path: "/comics", src: "none", ep: 0 },
    ],
  ])("%s", (_label, href, visit) => {
    expect(visitOf(href)).toEqual(visit);
  });

  it("and whatever an address says, the visit it records is one the route takes", () => {
    const hrefs = [
      "https://x.test/comics?ep=999&src=kudos",
      "https://x.test/comics?ep=1000",
      "https://x.test/kudos?ep=26&src=sign",
      "https://x.test/kudos?ep=27&src=comics",
      "https://x.test/comics?ep=0&src=poster",
      "https://x.test/comics?b=3",
    ];
    for (const href of hrefs) {
      const visit = visitOf(href);
      expect(isValidVisit(visit)).toBe(true);
      expect(parseVisit(JSON.parse(JSON.stringify(visit)))).toEqual(visit);
    }
  });
});

describe("parseVisit", () => {
  it("takes exactly a valid visit", () => {
    expect(parseVisit({ path: "/kudos", src: "guide", ep: 0 })).toEqual({
      path: "/kudos",
      src: "guide",
      ep: 0,
    });
  });

  it.each([
    ["an extra key", { path: "/kudos", src: "guide", ep: 0, name: "Sara" }],
    ["a missing key", { path: "/kudos", src: "guide" }],
    ["a string episode", { path: "/comics", src: "poster", ep: "5" }],
    ["an unknown page", { path: "/", src: "none", ep: 0 }],
    ["an inherited page", { path: "toString", src: "none", ep: 0 }],
    ["an unknown source", { path: "/comics", src: "direct", ep: 0 }],
    ["a string", "/comics"],
    ["null", null],
  ])("refuses %s", (_label, body) => {
    expect(parseVisit(body)).toBeNull();
  });
});

describe("migration 0034", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "supabase/migrations/0034_print_campaign_counts.sql"),
    "utf8"
  );
  const listIn = (column: string) => {
    const match = sql.match(new RegExp(`check \\(${column} in \\(([^)]*)\\)\\)`));
    return match ? Array.from(match[1].matchAll(/'([^']+)'/g), (m) => m[1]) : [];
  };

  it("stores exactly the pages and sources the code sends", () => {
    expect(listIn("path")).toEqual([...VISIT_PATHS]);
    expect(listIn("src")).toEqual([...PRINT_SOURCES, "none"]);
    expect(sql).toMatch(/ep\s+int\s+not null default 0 check \(ep between 0 and 999\)/);
  });

  it("keeps nothing finer than the month", () => {
    expect(sql).toContain("check (month = date_trunc('month', month)::date)");
    expect(sql).toContain("date_trunc('month', now() at time zone 'utc')::date");
    // The header says what isn't kept; the statements must not keep it.
    const statements = sql.replace(/--.*$/gm, "");
    expect(statements).not.toMatch(/\b(ip|user_agent|cookie|referr?er|timestamptz)\b/i);
  });

  it("is closed to the public API, with the counter for the service role only", () => {
    expect(sql).toContain("alter table public.comic_visit_counts enable row level security;");
    expect(sql).toContain(
      "revoke all on table public.comic_visit_counts from anon, authenticated;"
    );
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql).toMatch(
      /revoke all on function public\.comic_visit_hit\(text, text, int\)\s+from public, anon, authenticated;/
    );
    expect(sql).toContain(
      "grant execute on function public.comic_visit_hit(text, text, int) to service_role;"
    );
    expect(sql).toContain("set search_path = ''");
  });

  it("adds a card's book episode to kudos, and is safe to run twice", () => {
    expect(sql).toContain(
      "add column if not exists episode smallint check (episode between 1 and 26)"
    );
    expect(sql).toContain("create table if not exists public.comic_visit_counts");
    expect(sql).toContain("create or replace function public.comic_visit_hit");
  });
});
