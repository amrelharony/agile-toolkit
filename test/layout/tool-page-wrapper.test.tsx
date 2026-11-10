import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToString } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ToolGuideProvider } from "@/components/tool-frame/tool-guide-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getGuide } from "@/lib/tools/guides";

describe("ToolPageWrapper's first download", () => {
  // Only a tool page (toolId) shows them, and they import most tools' stores:
  // a page without a toolId (the comics, the book) mustn't download them.
  const src = readFileSync(
    path.join(process.cwd(), "src/components/layout/tool-page-wrapper.tsx"),
    "utf8"
  );
  const staticImports = Array.from(src.matchAll(/^import[^;]*?from\s+["']([^"']+)["']/gm)).map(
    (m) => m[1]
  );

  it.each(["@/components/shared/insights-engine", "@/components/tool-frame/next-step"])(
    "loads %s on the client only, never statically",
    (spec) => {
      expect(staticImports).not.toContain(spec);
      // Client-only: both render nothing on the server, and a server-rendered
      // dynamic part's HTML can be swapped for its empty fallback mid-hydration.
      const start = src.indexOf(`import("${spec}")`);
      expect(start).toBeGreaterThan(-1);
      const call = src.slice(start).split(");")[0];
      expect(call).toMatch(/\{\s*ssr:\s*false\s*\}/);
    }
  );

  it("keeps the How this works bar a static import, since it's in the server HTML", () => {
    expect(staticImports).toContain("@/components/tool-frame/how-it-works");
  });
});

describe("ToolPageWrapper on a tool's page", () => {
  it("shows How this works in the first render, server render included", async () => {
    // The guide comes from the tool's route layout, as on the real page.
    const guide = (await getGuide("wsjf"))!;
    const tree = (
      <TooltipProvider>
        <ToolGuideProvider guide={guide}>
          <ToolPageWrapper title="WSJF" description="Weighted shortest job first" toolId="wsjf">
            <p>Board</p>
          </ToolPageWrapper>
        </ToolGuideProvider>
      </TooltipProvider>
    );
    const html = renderToString(tree);
    expect(html).toContain("How this works");
    // The method text itself, not only the bar: a crawler runs no JavaScript.
    expect(html).toContain("When to use it");
    expect(html).toContain("How to run it");
    render(tree);
    expect(screen.getByText("Board")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "How this works" })).toBeInTheDocument();
  });

  it("puts the guide between the title and the tool", async () => {
    const guide = (await getGuide("wsjf"))!;
    const { container } = render(
      <TooltipProvider>
        <ToolGuideProvider guide={guide}>
          <ToolPageWrapper title="WSJF" description="Weighted shortest job first" toolId="wsjf">
            <p>Board</p>
          </ToolPageWrapper>
        </ToolGuideProvider>
      </TooltipProvider>
    );
    const header = container.querySelector("header")!;
    const details = container.querySelector("details")!;
    const board = screen.getByText("Board");
    expect(header.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(details.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("ToolPageWrapper server render", () => {
  it("renders the tool visible before hydration", () => {
    const html = renderToString(
      <ToolPageWrapper title="Retro Board" description="Run a retrospective" showInsights={false}>
        <p>Board</p>
      </ToolPageWrapper>
    );
    // A framer-motion `initial={{opacity:0}}` used to be serialised into the
    // HTML, leaving every tool page blank until the JS bundle ran.
    expect(html).not.toMatch(/opacity:\s*0/);
    expect(html).toContain("Retro Board");
    expect(html).toContain("Board");
  });
});
