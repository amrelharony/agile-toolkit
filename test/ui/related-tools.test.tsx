import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RelatedTools } from "@/components/tool-frame/related-tools";
import { SECTIONS } from "@/lib/constants/sections";

describe("RelatedTools", () => {
  it("links the next tools for the same job", () => {
    render(<RelatedTools toolId="wsjf" />);
    const nav = screen.getByRole("navigation", { name: "More in Prioritize & decide" });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(4);
    const prioritize = SECTIONS.find((s) => s.id === "prioritize")!.toolIds;
    const next = prioritize.slice(prioritize.indexOf("wsjf") + 1, prioritize.indexOf("wsjf") + 5);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(next.map((id) => `/${id}`));
  });

  it("wraps around for the last tool in a section and never links to itself", () => {
    const ai = SECTIONS.find((s) => s.id === "ai")!.toolIds;
    const last = ai[ai.length - 1];
    render(<RelatedTools toolId={last} />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs[0]).toBe(`/${ai[0]}`);
    expect(hrefs).not.toContain(`/${last}`);
  });

  it("renders nothing for an unknown tool", () => {
    const { container } = render(<RelatedTools toolId="not-a-tool" />);
    expect(container).toBeEmptyDOMElement();
  });
});
