/**
 * A search engine or an assistant gets a tool's method guide in the page's
 * HTML: each tool's route layout looks the guide up on the server
 * (components/tool-frame/tool-guide.tsx) and "How this works" renders it
 * inside its collapsed panel. Rendered here the way the server does it, with
 * no effect run and nothing loaded afterwards.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { HowItWorks } from "@/components/tool-frame/how-it-works";
import { ToolGuide } from "@/components/tool-frame/tool-guide";
import { tools } from "@/lib/constants/tools";
import { getAllGuides, type ToolGuide as Guide } from "@/lib/tools/guides";

const ROOT = process.cwd();

/** The panel's server HTML for a tool, parsed back into the DOM. */
async function serverPanel(id: string): Promise<HTMLElement> {
  const host = document.createElement("div");
  host.innerHTML = renderToString(await ToolGuide({ id, children: <HowItWorks toolId={id} /> }));
  return host;
}

/** Every line of a guide a reader sees. */
function lines(guide: Guide): string[] {
  return [
    guide.summary,
    ...guide.whenToUse,
    ...guide.steps,
    ...(guide.tips ?? []),
    ...(guide.timebox ? [guide.timebox] : []),
    ...(guide.scales ?? []).flatMap((s) => [
      s.name,
      ...s.values.flatMap((v) => [v.value, v.meaning]),
    ]),
  ];
}

describe("a tool's guide in the server's HTML", () => {
  it("is there in full for every tool that has one, in a collapsed panel", async () => {
    const guides = await getAllGuides();
    expect(guides.length).toBeGreaterThan(100);
    for (const guide of guides) {
      const host = await serverPanel(guide.toolId);
      const details = host.querySelector("details");
      expect(details, guide.toolId).not.toBeNull();
      // Collapsed: the tool stays right under its title, as before.
      expect(details, guide.toolId).not.toHaveAttribute("open");
      const text = details!.textContent ?? "";
      expect(text, guide.toolId).toContain("When to use it");
      expect(text, guide.toolId).toContain("How to run it");
      for (const line of lines(guide)) expect(text, `${guide.toolId}: ${line}`).toContain(line);
    }
    // Over a hundred panels rendered: room for a busy machine.
  }, 30_000);

  it("keeps the steps an ordered list, so their order reads without the styles", async () => {
    const [guide] = await getAllGuides();
    const host = await serverPanel(guide.toolId);
    const steps = Array.from(host.querySelectorAll("ol > li")).map((li) => li.textContent);
    expect(steps).toEqual(guide.steps);
  });

  it("leaves a tool without a guide with no panel at all", async () => {
    const guided = new Set((await getAllGuides()).map((g) => g.toolId));
    const unguided = tools.filter((t) => !guided.has(t.id));
    expect(unguided.length).toBeGreaterThan(0);
    for (const tool of unguided) {
      expect((await serverPanel(tool.id)).innerHTML, tool.id).toBe("");
    }
  });

  it("is handed over by every tool's layout", () => {
    for (const tool of tools) {
      const file = path.join(ROOT, "src/app/(tools)", tool.path, "layout.tsx");
      expect(readFileSync(file, "utf8"), tool.id).toContain(
        `<ToolGuide id=${JSON.stringify(tool.id)}>{children}</ToolGuide>`
      );
    }
  });

  it("costs the page no JavaScript: the panel never loads guide text itself", () => {
    for (const file of [
      "src/components/tool-frame/how-it-works.tsx",
      "src/components/tool-frame/tool-guide-context.tsx",
      "src/components/layout/tool-page-wrapper.tsx",
    ]) {
      const imports = Array.from(
        readFileSync(path.join(ROOT, file), "utf8").matchAll(
          /from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']/g
        )
      ).map((m) => m[1] ?? m[2]);
      // Types only (lib/tools/guides/types) are fine: they compile away.
      expect(
        imports.filter((spec) => /lib\/tools\/guides(?!\/types)/.test(spec)),
        file
      ).toEqual([]);
    }
    // The lookup itself stays a server component.
    const lookup = readFileSync(
      path.join(ROOT, "src/components/tool-frame/tool-guide.tsx"),
      "utf8"
    );
    expect(lookup).not.toMatch(/["']use client["']/);
  });
});

describe("structured data", () => {
  /** Every source file under src, read once: [path, text]. */
  const sources: [string, string][] = [];

  // A couple of thousand files: read once, with room for a busy machine.
  beforeAll(() => {
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(t|j)sx?$/.test(name)) {
          sources.push([
            path.relative(ROOT, full).split(path.sep).join("/"),
            readFileSync(full, "utf8"),
          ]);
        }
      }
    };
    walk(path.join(ROOT, "src"));
  }, 60_000);

  /** Source files under src that mention `needle`. */
  const filesWith = (needle: RegExp): string[] =>
    sources
      .filter(([, text]) => needle.test(text))
      .map(([file]) => file)
      .sort();

  it("stays on the comic's stories and the book: no tool page carries any", () => {
    expect(filesWith(/application\/ld\+json/)).toEqual([
      "src/app/(tools)/book/page.tsx",
      "src/app/(tools)/comics/ep/[n]/page.tsx",
    ]);
  });

  it("never marks a guide up as a HowTo or an FAQ, which search results no longer show", () => {
    expect(filesWith(/["']@type["']\s*:\s*["'](?:HowTo|HowToStep|FAQPage|Question)["']/)).toEqual(
      []
    );
  });
});
