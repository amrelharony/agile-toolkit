/**
 * "How this works" shows the guide its route layout hands over only when the
 * page's wrapper names the same tool (components/tool-frame/how-it-works.tsx).
 * A page whose wrapper named another tool would lose the panel, and with it
 * the guide text a search engine or an assistant reads, and no other test
 * would notice. So every guided tool's page is tied to its layout's id here.
 * Where the wrapper spells its toolId out, reading the source is enough. Where
 * the id is a constant, a spread, or picked when the page runs (the Standup
 * Tracker by mode, the Decision Log by template, the prioritization methods by
 * config), the page is rendered the way the server does it, under its layout's
 * guide.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement, type ComponentType } from "react";

// Sprint Planning asks for the router, which only a mounted app provides.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => {} }),
}));

import { ToolGuide } from "@/components/tool-frame/tool-guide";
import { TooltipProvider } from "@/components/ui/tooltip";
import { tools, type ToolDefinition } from "@/lib/constants/tools";
import { getAllGuides, type ToolGuide as Guide } from "@/lib/tools/guides";

const TOOLS_DIR = path.join(process.cwd(), "src/app/(tools)");

/** A tool's page component, loaded only when a test renders it. */
async function pageOf(tool: ToolDefinition): Promise<ComponentType> {
  // The path is only known here, so Vite is told not to look for it up front.
  const file = `@/app/(tools)${tool.path}/page`;
  const page: { default: ComponentType } = await import(/* @vite-ignore */ file);
  return page.default;
}

/** The pages that share a client with another tool and pick their id when they run. */
const SHARED_CLIENT_PAGES = [
  // StandupClient, by mode
  "standup",
  "async-standup",
  // DecisionLogClient, by template
  "decision-log",
  "daci",
  "rapid-decision",
  // MethodTool, by config
  "wsjf",
  "rice-scoring",
  "ice-score",
  "moscow",
  "cost-of-delay",
];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith(".tsx") ? [full] : [];
  });
}

/**
 * The toolId each <ToolPageWrapper> in a tool's folder is given: the id where
 * the source spells it out, null where only running the page tells.
 */
function wrapperIds(tool: ToolDefinition): (string | null)[] {
  return tsxFiles(path.join(TOOLS_DIR, tool.path)).flatMap((file) =>
    Array.from(readFileSync(file, "utf8").matchAll(/<ToolPageWrapper\b([^>]*)>/g)).map(
      ([, props]) => props.match(/\btoolId="([^"]+)"/)?.[1] ?? null
    )
  );
}

/** Reading isn't enough: the folder has no wrapper of its own, or one without a spelled-out id. */
function needsRunning(tool: ToolDefinition): boolean {
  const ids = wrapperIds(tool);
  return ids.length === 0 || ids.includes(null);
}

/**
 * A tool's page as the server first sends it, under the layout guide of the
 * tool `guideId` names (its own, unless a test says otherwise), parsed back
 * into the DOM.
 */
async function firstHtml(tool: ToolDefinition, guideId = tool.id): Promise<HTMLElement> {
  const Page = await pageOf(tool);
  const host = document.createElement("div");
  host.innerHTML = renderToString(
    <TooltipProvider>
      {await ToolGuide({ id: guideId, children: createElement(Page) })}
    </TooltipProvider>
  );
  return host;
}

describe("a guided tool's page and its layout", () => {
  const guides = new Map<string, Guide>();
  let guided: ToolDefinition[] = [];

  beforeAll(async () => {
    for (const guide of await getAllGuides()) guides.set(guide.toolId, guide);
    guided = tools.filter((tool) => guides.has(tool.id));
  });

  it("name the same tool wherever the page's wrapper spells its id out", () => {
    expect(guided.length).toBeGreaterThan(100);
    const read = guided.filter((tool) => !needsRunning(tool));
    // Most pages are settled by reading alone; the rest are rendered below.
    expect(read.length).toBeGreaterThan(guided.length / 2);
    for (const tool of guided) {
      for (const id of wrapperIds(tool)) {
        if (id !== null) expect(id, `src/app/(tools)${tool.path}`).toBe(tool.id);
      }
    }
  });

  it("show the guide on the rendered page where only running it tells the wrapper's id", async () => {
    const run = guided.filter(needsRunning);
    expect(run.map((tool) => tool.id)).toEqual(expect.arrayContaining(SHARED_CLIENT_PAGES));
    const withoutPanel: string[] = [];
    for (const tool of run) {
      const details = (await firstHtml(tool)).querySelector("details");
      const text = details?.textContent ?? "";
      // The panel is there only when the wrapper's id is the layout's.
      if (!text.includes(guides.get(tool.id)!.summary) || !text.includes("How to run it")) {
        withoutPanel.push(tool.path);
      }
    }
    expect(withoutPanel).toEqual([]);
    // A few dozen whole pages, loaded and rendered: room for a busy machine.
  }, 120_000);

  it("would lose the panel if a page named another tool, which is what this guards", async () => {
    // WSJF's page under the Retro Board's layout: the ids differ, so no panel.
    const wsjf = tools.find((tool) => tool.id === "wsjf")!;
    const host = await firstHtml(wsjf, "retro");
    expect(host.querySelector("h1")).not.toBeNull();
    expect(host.querySelector("details")).toBeNull();
    // Under its own layout the same page has it.
    expect((await firstHtml(wsjf)).querySelector("details")).not.toBeNull();
  }, 30_000);
});
