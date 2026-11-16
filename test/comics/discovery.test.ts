// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { StorySummary } from "@/lib/comics/types";

const h = vi.hoisted(() => ({ stories: [] as StorySummary[], fails: false }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/comics/store", () => ({
  listReleasedWeekly: async (limit?: number) => {
    if (h.fails) throw new Error("down");
    return limit ? h.stories.slice(0, limit) : h.stories;
  },
}));

import { GET as feedGET, revalidate as feedRevalidate } from "@/app/(tools)/comics/feed.xml/route";
import comicsSitemap from "@/app/(tools)/comics/sitemap";
import { FEED_ITEM_LIMIT, escapeXml, renderFeed } from "@/lib/comics/feed";
import { THEME_LABELS, themeLabel } from "@/lib/comics/themes";

const story = (ep: number, extra: Partial<StorySummary> = {}): StorySummary => ({
  ep,
  title: `Story ${ep}`,
  lesson: `Lesson ${ep}`,
  castNames: ["Amr"],
  themes: ["T01"],
  cover: { pathSmall: `stories/${ep}/one-768.webp`, width: 1536, height: 1024 },
  releaseAt: "2026-10-26T07:00:00.000Z",
  updatedAt: "2026-10-27T08:00:00.000Z",
  ...extra,
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
  h.stories = [story(28), story(27)];
  h.fails = false;
});

describe("/comics/feed.xml", () => {
  it("is a static RSS document refreshed like the pages", async () => {
    expect(feedRevalidate).toBe(86400);
    const res = await feedGET();
    expect(res.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");
    const xml = await res.text();
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
    expect(xml).toContain("<title>Story 28</title>");
    expect(xml).toContain("<description>Lesson 28</description>");
    expect(xml).toContain("<link>https://agile.amrelharony.com/comics?ep=28</link>");
  });

  it("never carries full panels: one small image per item, and no 1536 file", () => {
    const xml = renderFeed(h.stories);
    const images = xml.match(/<media:thumbnail[^>]*>/g) ?? [];
    expect(images).toHaveLength(2);
    expect(images[0]).toContain(
      "https://ref.supabase.co/storage/v1/object/public/comic-panels/stories/28/one-768.webp"
    );
    expect(xml).not.toContain("1536.webp");
    expect(xml).not.toContain("pathFull");
  });

  it("has nowhere to put dialogue or the rest of a story", () => {
    const leaked = {
      ...story(28),
      panels: [{ pathFull: "x-1536.webp", dialogue: [{ speaker: "Amr", line: "Secret line" }] }],
    };
    const xml = renderFeed([leaked as StorySummary]);
    expect(xml).not.toContain("Secret line");
    expect(xml).not.toContain("x-1536.webp");
  });

  it("escapes markup in every field", () => {
    const xml = renderFeed([
      story(28, {
        title: `Fish & <chips> "quoted" 'single'`,
        lesson: "a < b && c > d",
        cover: { pathSmall: "s/a&b.webp", width: 1, height: 1 },
      }),
    ]);
    expect(xml).toContain(
      "<title>Fish &amp; &lt;chips&gt; &quot;quoted&quot; &apos;single&apos;</title>"
    );
    expect(xml).toContain("<description>a &lt; b &amp;&amp; c &gt; d</description>");
    expect(xml).not.toContain("<chips>");
    expect(xml).toContain("a%26b.webp");
  });

  it("drops characters XML can't hold", () => {
    expect(escapeXml("a\u0000b\u000bc￾d\ne")).toBe("abcd\ne");
  });

  it("leaves out the image when a story has none", () => {
    expect(renderFeed([story(28, { cover: null })])).not.toContain("<media:thumbnail");
  });

  it("limits the items", () => {
    const many = Array.from({ length: FEED_ITEM_LIMIT + 5 }, (_, i) => story(27 + i));
    expect(renderFeed(many).match(/<item>/g)).toHaveLength(FEED_ITEM_LIMIT);
  });

  it("is still valid with no stories", () => {
    const xml = renderFeed([]);
    expect(xml).toContain("</channel>");
    expect(xml).not.toContain("<item>");
  });

  it("throws on an outage, so the last good feed stays up", async () => {
    h.fails = true;
    await expect(feedGET()).rejects.toThrow("down");
  });
});

describe("/comics/sitemap.xml", () => {
  it("lists released weekly stories at their public address, with lastModified", async () => {
    expect(await comicsSitemap()).toEqual([
      {
        url: "https://agile.amrelharony.com/comics?ep=28",
        lastModified: "2026-10-27T08:00:00.000Z",
      },
      {
        url: "https://agile.amrelharony.com/comics?ep=27",
        lastModified: "2026-10-27T08:00:00.000Z",
      },
    ]);
  });
});

describe("theme labels", () => {
  it("names all twelve codes from the canon", () => {
    expect(Object.keys(THEME_LABELS)).toEqual(
      Array.from({ length: 12 }, (_, i) => `T${String(i + 1).padStart(2, "0")}`)
    );
    expect(themeLabel("T01")).toBe("Shared language and direct understanding");
    expect(themeLabel("T99")).toBe("T99");
  });
});

describe("migration 0029", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "supabase/migrations/0029_comic_stories.sql"),
    "utf8"
  );

  it.each(["comic_stories", "comic_entry_counts", "comic_licence_requests"])(
    "%s is closed to the public API",
    (table) => {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`revoke all on table public.${table} from anon, authenticated;`);
    }
  );

  it("adds no policies, on the tables or on storage", () => {
    expect(sql).not.toMatch(/create\s+policy/i);
  });

  it("revokes the counter function from everyone but the service role", () => {
    expect(sql).toMatch(
      /revoke all on function public\.comic_entry_hit\(text, int, int\)\s+from public, anon, authenticated;/
    );
    expect(sql).toContain(
      "grant execute on function public.comic_entry_hit(text, int, int) to service_role;"
    );
  });

  it("stores no IP address or user agent", () => {
    expect(sql).not.toMatch(/^\s*(?:ip|ip_address|client_ip|user_agent)\s+\w/im);
  });

  it("claims the comic-panels bucket, image only and limited in size", () => {
    expect(sql).toContain("'comic-panels'");
    expect(sql).toContain("array['image/webp', 'image/jpeg']");
    expect(sql).toMatch(/on conflict \(id\) do update/);
    expect(sql).not.toMatch(/'comics'/);
  });

  it("doesn't name a reserved word as a column", () => {
    expect(sql).toContain("cast_names");
    expect(sql).not.toMatch(/^\s*cast\s/m);
  });
});
