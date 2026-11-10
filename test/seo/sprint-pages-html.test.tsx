/**
 * /sprint and /sprint-planning are nothing but this browser's saved sprints,
 * which the server can't read, so the body of their first HTML used to be
 * "Loading sprints…" and no more. A search engine or an assistant reads only
 * that HTML: it now carries one sentence on what the page does, and the tool's
 * guide. Rendered here the way the server does it, the tool's layout included.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
// Sprint Planning asks for the router, which only a mounted app provides.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => {} }),
}));

import { ToolGuide } from "@/components/tool-frame/tool-guide";
import { TooltipProvider } from "@/components/ui/tooltip";
import { COCKPIT_ABOUT } from "@/app/(tools)/sprint/cockpit";
import { SprintCockpitClient } from "@/app/(tools)/sprint/sprint-cockpit-client";
import { PLANNING_ABOUT } from "@/app/(tools)/sprint-planning/planning";
import { SprintPlanningClient } from "@/app/(tools)/sprint-planning/sprint-planning-client";

/** The page's first HTML under its tool's layout, parsed back into the DOM. */
async function firstHtml(toolId: string, page: ReactElement): Promise<HTMLElement> {
  const host = document.createElement("div");
  host.innerHTML = renderToString(
    <TooltipProvider>{await ToolGuide({ id: toolId, children: page })}</TooltipProvider>
  );
  return host;
}

const PAGES = [
  ["sprint", "Sprint Cockpit", COCKPIT_ABOUT, <SprintCockpitClient key="sprint" />],
  ["sprint-planning", "Sprint Planning", PLANNING_ABOUT, <SprintPlanningClient key="planning" />],
] as const;

describe.each(PAGES)("the first HTML of /%s", (toolId, title, about, page) => {
  it("says what the page does in one sentence, where it said only Loading sprints…", async () => {
    const host = await firstHtml(toolId, page);
    const status = host.querySelector('[role="status"]')!;
    expect(status.textContent).toBe("Loading sprints…");
    // The sentence shares the loading card and comes before the loading line.
    const card = status.parentElement!;
    const sentence = Array.from(card.querySelectorAll("p")).find((p) => p.textContent === about);
    expect(sentence, about).toBeDefined();
    expect(
      sentence!.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("keeps that sentence one plain sentence", () => {
    expect(about).toMatch(/^This page [^.!?—–]+\.$/);
    expect(about.length).toBeLessThanOrEqual(200);
  });

  it("also has the page's title and its guide", async () => {
    const host = await firstHtml(toolId, page);
    expect(host.querySelector("h1")?.textContent).toBe(title);
    const details = host.querySelector("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(details.textContent).toContain("How to run it");
  });
});
