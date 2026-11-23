// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { accumulateMetadata } from "next/dist/lib/metadata/resolve-metadata";
import { getToolById, tools } from "@/lib/constants/tools";
import { CORE_SCRUM_TOOLS, coreSearchName } from "@/lib/seo/core-tools";
import { SITE_METADATA } from "@/lib/seo/site-metadata";
import {
  SITE_TITLE_SUFFIX,
  TITLE_MAX,
  TITLE_OFFER,
  searchTitle,
  toolMetadata,
} from "@/lib/seo/tool-metadata";
import { toolShareMetadata } from "@/lib/seo/tool-share";

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...pageFiles(full));
    else if (name === "page.tsx") out.push(full);
  }
  return out;
}

const pages = pageFiles(path.join(process.cwd(), "src", "app"));

describe("page metadata", () => {
  it("never repeats the site name the layout template already appends", () => {
    const offenders = pages.filter((f) =>
      /^\s{2}title:\s*"[^"]*Agile Toolkit"/m.test(readFileSync(f, "utf8"))
    );
    expect(offenders.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });

  it("only builds metadata for tools that exist", () => {
    for (const f of pages) {
      for (const m of Array.from(readFileSync(f, "utf8").matchAll(/toolMetadata\("([^"]+)"/g))) {
        expect(getToolById(m[1]), `${f}: unknown tool "${m[1]}"`).toBeDefined();
      }
    }
  });

  it("gives every tool page a description", () => {
    const toolPages = pages.filter((f) => f.includes(`${path.sep}(tools)${path.sep}`));
    const missing = toolPages.filter((f) => {
      const src = readFileSync(f, "utf8");
      return !/description[:,\s]/.test(src) && !src.includes("toolMetadata(");
    });
    expect(missing.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });
});

/**
 * What a browser tab, a search result and a link preview show for a tool's
 * page: the root layout, the tool's own layout and its page, resolved by
 * Next's own metadata code, the way the page is rendered.
 */
async function shownTitles(toolId: string) {
  const tool = getToolById(toolId)!;
  const resolved = await accumulateMetadata(
    [
      [SITE_METADATA, null, null],
      [toolShareMetadata(toolId), null, null],
      [toolMetadata(toolId), null, null],
    ],
    { pathname: tool.path, trailingSlash: false, isStandaloneMode: false }
  );
  return {
    page: resolved.title?.absolute,
    openGraph: resolved.openGraph?.title?.absolute,
    twitter: resolved.twitter?.title?.absolute,
  };
}

const pageSource = (toolId: string) =>
  readFileSync(
    path.join(process.cwd(), "src/app/(tools)", getToolById(toolId)!.path, "page.tsx"),
    "utf8"
  );

describe("the core Scrum tools", () => {
  it("are 15 to 20 tools, each named once", () => {
    expect(CORE_SCRUM_TOOLS.length).toBeGreaterThanOrEqual(15);
    expect(CORE_SCRUM_TOOLS.length).toBeLessThanOrEqual(20);
    const ids = CORE_SCRUM_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = CORE_SCRUM_TOOLS.map((t) => t.searchName.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("are tools anyone can open from the main navigation", () => {
    for (const { id } of CORE_SCRUM_TOOLS) {
      const tool = getToolById(id);
      expect(tool, id).toBeDefined();
      expect(tool!.access, id).toBeUndefined();
      expect(tool!.shelf, id).toBeUndefined();
      expect(tool!.kind ?? "tool", id).toBe("tool");
      expect(tool!.pendingApproval, id).toBeUndefined();
    }
  });

  it("have a search name in plain sentence case that leaves room for the offer", () => {
    for (const { id, searchName } of CORE_SCRUM_TOOLS) {
      expect(searchName, id).toMatch(/^[A-Z][A-Za-z ]+$/);
      expect(searchName, id).not.toMatch(/\s{2,}|\s$/);
      // With ": free, no sign-up" it fits a search result, site name or not.
      expect(`${searchName}${TITLE_OFFER}`.length, id).toBeLessThanOrEqual(TITLE_MAX);
    }
  });

  it("know their search name by tool id, and no other tool's", () => {
    expect(coreSearchName("retro")).toBe("Retro board online");
    expect(coreSearchName("wsjf")).toBeUndefined();
    expect(coreSearchName("no-such-tool")).toBeUndefined();
  });
});

describe("a core Scrum tool's title", () => {
  it.each([
    ["planning-poker", "Planning Poker online: free, no sign-up | Agile Toolkit"],
    ["retro", "Retro board online: free, no sign-up | Agile Toolkit"],
    ["burndown", "Sprint burndown chart: free, no sign-up | Agile Toolkit"],
  ])("%s is titled by what people search for", async (id, title) => {
    expect((await shownTitles(id)).page).toBe(title);
  });

  it("follows the one pattern, in 60 characters at most", async () => {
    for (const { id, searchName } of CORE_SCRUM_TOOLS) {
      const { page } = await shownTitles(id);
      const offer = `${searchName}: free, no sign-up`;
      const full = `${offer} | Agile Toolkit`;
      // The site name is the first thing to go when the whole title is too long.
      expect(page, id).toBe(full.length <= 60 ? full : offer);
      expect(page!.length, id).toBeLessThanOrEqual(60);
    }
  });

  it("drops the site name first when the whole title would be too long", async () => {
    // 28 characters: with the offer and the site name it would be 62.
    expect(coreSearchName("refinement")).toBe("Backlog refinement checklist");
    expect((await shownTitles("refinement")).page).toBe(
      "Backlog refinement checklist: free, no sign-up"
    );
  });

  it("is the link preview's title too", async () => {
    for (const { id } of CORE_SCRUM_TOOLS) {
      const { page, openGraph, twitter } = await shownTitles(id);
      expect(page, id).toContain(TITLE_OFFER);
      expect(openGraph, id).toBe(page);
      expect(twitter, id).toBe(page);
    }
  });

  it("comes from the registry: the page sets no title of its own", () => {
    for (const { id } of CORE_SCRUM_TOOLS) {
      const src = pageSource(id);
      expect(src, id).toContain(`toolMetadata("${id}")`);
      expect(src, id).not.toMatch(/\btitle:/);
    }
  });
});

describe("searchTitle", () => {
  /**
   * The title a page shows for a search name, once the root layout's template
   * has run: the root layout, a tool's layout (it sets no title) and the page.
   */
  async function shown(searchName: string): Promise<string | undefined> {
    const resolved = await accumulateMetadata(
      [
        [SITE_METADATA, null, null],
        [{}, null, null],
        [{ title: searchTitle(searchName) }, null, null],
      ],
      { pathname: "/", trailingSlash: false, isStandaloneMode: false }
    );
    return resolved.title?.absolute;
  }

  it("leaves the site name to the layout's template when the title fits", async () => {
    expect(SITE_TITLE_SUFFIX).toBe(" | Agile Toolkit");
    expect(TITLE_MAX).toBe(60);
    expect(searchTitle("Retro board online")).toBe("Retro board online: free, no sign-up");
    expect(await shown("Retro board online")).toBe(
      "Retro board online: free, no sign-up | Agile Toolkit"
    );
  });

  it("fits a title of exactly 60 characters whole", async () => {
    const name = "Definition of Done builder";
    expect(`${name}${TITLE_OFFER}${SITE_TITLE_SUFFIX}`).toHaveLength(60);
    expect(searchTitle(name)).toBe(`${name}${TITLE_OFFER}`);
    expect(await shown(name)).toBe(`${name}${TITLE_OFFER}${SITE_TITLE_SUFFIX}`);
  });

  it("keeps the template off a title one character too long, so the site name goes", async () => {
    const name = "Definition of Done builders";
    expect(searchTitle(name)).toEqual({ absolute: `${name}${TITLE_OFFER}` });
    expect(await shown(name)).toBe(`${name}${TITLE_OFFER}`);
  });

  it("lets a name too long even for that stand alone, with no site name put back", async () => {
    // 50 characters: the offer would make it 68, and the site name alone 66.
    const name = "A search name far too long to sit beside the offer";
    expect(name).toHaveLength(50);
    expect(searchTitle(name)).toEqual({ absolute: name });
    expect(await shown(name)).toBe(name);
  });

  it("never shows a title over 60 characters for a name that fits in 60 itself", async () => {
    for (let length = 1; length <= TITLE_MAX; length++) {
      const name = "N".repeat(length);
      const title = await shown(name);
      expect(title, `${length} characters`).toContain(name);
      expect(title!.length, `${length} characters`).toBeLessThanOrEqual(TITLE_MAX);
    }
  });
});

describe("every other tool's title", () => {
  it("is its own name, with the site name after it", async () => {
    const core = new Set(CORE_SCRUM_TOOLS.map((t) => t.id));
    for (const tool of tools.filter((t) => !core.has(t.id))) {
      expect(toolMetadata(tool.id).title, tool.id).toBe(tool.name);
    }
    const { page, openGraph, twitter } = await shownTitles("wsjf");
    expect(page).toBe("WSJF Calculator | Agile Toolkit");
    expect(openGraph).toBe(page);
    expect(twitter).toBe(page);
  });

  it("keeps a page's own overrides", () => {
    expect(toolMetadata("wsjf", { description: "Its own line." }).description).toBe(
      "Its own line."
    );
    expect(() => toolMetadata("no-such-tool")).toThrow(/unknown tool/);
  });
});
