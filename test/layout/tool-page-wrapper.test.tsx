import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";

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
