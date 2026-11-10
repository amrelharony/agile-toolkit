// @vitest-environment node
/**
 * /llms.txt: what the site is, its limits stated exactly, and links to the
 * core Scrum tools, as plain text for an assistant. Built from the registry
 * and the live-room rules, so these check it against them, not against a copy.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { GET, dynamic } from "@/app/llms.txt/route";
import { getSectionForTool } from "@/lib/constants/sections";
import { getToolById, tools } from "@/lib/constants/tools";
import { VISITOR_LIMITS, VISITOR_TOOLS } from "@/lib/realtime/visitor-rooms";
import { CORE_SCRUM_TOOLS } from "@/lib/seo/core-tools";
import { llmsTxt } from "@/lib/seo/llms";
import { SITE_METADATA } from "@/lib/seo/site-metadata";
import { defaultToolCount, getShelfTools } from "@/lib/tools/catalog";

const BASE = "https://agile.amrelharony.com";

/** Every link in the file, as [label, url]. */
function links(text: string): [string, string][] {
  return Array.from(text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g), (m) => [m[1], m[2]]);
}

/** The bullet lines under a "## " heading. */
function section(text: string, heading: string): string[] {
  const start = text.indexOf(`## ${heading}\n`);
  expect(start, heading).toBeGreaterThan(-1);
  const rest = text.slice(start + heading.length + 4);
  const end = rest.search(/^## /m);
  return (end === -1 ? rest : rest.slice(0, end)).split("\n").filter((l) => l.startsWith("- "));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/llms.txt", () => {
  it("is served as plain text, built once with the site", async () => {
    expect(dynamic).toBe("force-static");
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe(llmsTxt());
  });

  it("opens with what the site is, in the llms.txt layout", () => {
    const [title, blank, summary] = llmsTxt().split("\n");
    expect(title).toBe("# Agile Toolkit");
    expect(blank).toBe("");
    expect(summary).toMatch(/^> Free tools for Scrum Masters and agile teams/);
    expect(llmsTxt()).toContain(`Site: ${BASE}\n`);
    expect(String(SITE_METADATA.metadataBase)).toBe(`${BASE}/`);
    // Plain text: no HTML, and it ends with a newline.
    expect(llmsTxt()).not.toMatch(/<[a-z!/]/i);
    expect(llmsTxt().endsWith("\n")).toBe(true);
  });

  it("says there is no account and that data stays in one browser", () => {
    const [account, data] = section(llmsTxt(), "Limits");
    expect(account).toBe(
      "- No account: every tool here is free and works without signing up or signing in."
    );
    expect(data).toMatch(/^- Data stays in one browser: /);
    expect(data).toContain("saved in that browser only");
    expect(data).toContain("nothing syncs to another browser or device");
    expect(data).toContain("backup file");
  });

  it("states the live-room limits as the rooms enforce them, when rooms are on", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
    const limits = section(llmsTxt(), "Limits");
    expect(limits).toHaveLength(3);
    const rooms = limits[2];
    expect(VISITOR_LIMITS.maxMembers).toBe(20);
    expect(VISITOR_LIMITS.hardTtlMs).toBe(3 * 60 * 60 * 1000);
    expect(rooms).toContain("up to 20 people, the host included");
    expect(rooms).toContain("closes after 3 hours at most");
    expect(rooms).toContain("the site stores none of it");
    // Every tool that can run a room, by the name on its page, and no other.
    for (const id of VISITOR_TOOLS) expect(rooms, id).toContain(getToolById(id)!.name);
    expect(rooms).toMatch(/run Planning Poker or Retro Board live from a shared link/);
  });

  it("promises no live room when this build has rooms off", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "");
    const text = llmsTxt();
    expect(section(text, "Limits")).toHaveLength(2);
    expect(text).not.toMatch(/live room|Live rooms|shared link/);
  });

  it("links every core Scrum tool by its name, under its section, with what it does", () => {
    const text = llmsTxt();
    const lines = section(text, "Core Scrum tools");
    expect(lines).toHaveLength(CORE_SCRUM_TOOLS.length);
    CORE_SCRUM_TOOLS.forEach(({ id }, i) => {
      const tool = getToolById(id)!;
      expect(lines[i], id).toBe(`- [${tool.name}](${BASE}${tool.path}): ${tool.description}.`);
      // Its section's heading comes before it.
      const heading = text.indexOf(`### ${getSectionForTool(id)!.label}\n`);
      expect(heading, id).toBeGreaterThan(-1);
      expect(heading, id).toBeLessThan(text.indexOf(lines[i]));
    });
    expect(text).toContain('Under "How this works"');
  });

  it("points to the rest with the counts the site itself gives", () => {
    const rest = section(llmsTxt(), "Everything else");
    expect(rest).toEqual([
      `- [All tools](${BASE}/): the ${defaultToolCount()} tools for Scrum Masters and agile teams, by section.`,
      `- [More tools](${BASE}/more-tools): ${getShelfTools().length} tools for neighbouring work, such as AI product management, security, reliability and strategy.`,
      `- [Team](${BASE}/team): the people on a team and the agreements they work by.`,
      `- [What leaves your browser](${BASE}/privacy): what each part of the site sends from the browser and what is kept, who runs the site and how to reach him, and what a security team can check.`,
      `- [Sitemap](${BASE}/sitemap.xml): every public page.`,
    ]);
  });

  it("links only public pages that the sitemap lists and AI crawlers may read", () => {
    const listed = new Set(sitemap().map((entry) => entry.url));
    const closed = [robots().rules].flat().flatMap((rule) => rule.disallow ?? []);
    const urls = links(llmsTxt()).map(([, url]) => url);
    expect(urls.length).toBe(CORE_SCRUM_TOOLS.length + 5);
    for (const url of urls) {
      expect(url.startsWith(`${BASE}/`), url).toBe(true);
      const pathname = new URL(url).pathname;
      if (pathname !== "/sitemap.xml") expect(listed.has(url), url).toBe(true);
      expect(
        closed.filter((prefix) => pathname.startsWith(prefix)),
        url
      ).toEqual([]);
    }
    // Neither the comic nor the book, and no tool kept for the book's readers.
    const vip = tools.filter((t) => t.access === "vip").map((t) => `${BASE}${t.path}`);
    for (const url of [`${BASE}/comics`, `${BASE}/book`, ...vip]) expect(urls).not.toContain(url);
  });

  it("is written plainly: no em dashes, no line of bare jargon left empty", () => {
    const text = llmsTxt();
    expect(text).not.toMatch(/[—–]/);
    expect(text).not.toMatch(/undefined|null|NaN|\[object/);
    expect(text).not.toMatch(/\n{3,}/);
  });
});
