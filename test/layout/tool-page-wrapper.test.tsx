import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToString } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { TooltipProvider } from "@/components/ui/tooltip";

describe("ToolPageWrapper's first download", () => {
  // Only a tool page (toolId) shows them, and they import most tools' stores:
  // a page without a toolId (the comics, the book) mustn't download them.
  const file = path.join(process.cwd(), "src/components/layout/tool-page-wrapper.tsx");
  it.each([
    "@/components/shared/insights-engine",
    "@/components/tool-frame/next-step",
    "@/components/tool-frame/how-it-works",
  ])("loads %s with next/dynamic, never statically", (spec) => {
    const src = readFileSync(file, "utf8");
    const staticImports = Array.from(src.matchAll(/^import[^;]*?from\s+["']([^"']+)["']/gm)).map(
      (m) => m[1]
    );
    expect(staticImports).not.toContain(spec);
    expect(src).toContain(`import("${spec}")`);
  });
});

describe("ToolPageWrapper on a tool's page", () => {
  it("still shows the parts whose code loads on demand", async () => {
    render(
      <TooltipProvider>
        <ToolPageWrapper title="WSJF" description="Weighted shortest job first" toolId="wsjf">
          <p>Board</p>
        </ToolPageWrapper>
      </TooltipProvider>
    );
    // The tool itself never waits for them.
    expect(screen.getByText("Board")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "How this works" })).toBeInTheDocument();
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
