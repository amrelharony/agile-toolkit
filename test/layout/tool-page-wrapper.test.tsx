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
  it("shows How this works in the first render, server render included", () => {
    const tree = (
      <TooltipProvider>
        <ToolPageWrapper title="WSJF" description="Weighted shortest job first" toolId="wsjf">
          <p>Board</p>
        </ToolPageWrapper>
      </TooltipProvider>
    );
    expect(renderToString(tree)).toContain("How this works");
    render(tree);
    expect(screen.getByText("Board")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "How this works" })).toBeInTheDocument();
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
