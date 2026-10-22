import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RelatedTools } from "@/components/tool-frame/related-tools";
import { SECTIONS } from "@/lib/constants/sections";
import { getToolById } from "@/lib/constants/tools";
import { isShelved } from "@/lib/tools/catalog";

describe("RelatedTools", () => {
  it("skips shelved neighbours for a tool in the main navigation", () => {
    render(<RelatedTools toolId="risk-register" />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    const quality = SECTIONS.find((s) => s.id === "quality")!.toolIds;
    const at = quality.indexOf("risk-register");
    const expected = [...quality.slice(at + 1), ...quality.slice(0, at)]
      .filter((id) => !isShelved(getToolById(id)!))
      .slice(0, 4)
      .map((id) => `/${id}`);
    expect(hrefs).toEqual(expected);
    for (const href of hrefs) expect(isShelved(getToolById(href!.slice(1))!)).toBe(false);
  });

  it("still lists a shelved tool's shelved neighbours, so it is not a dead end", () => {
    render(<RelatedTools toolId="model-card" />);
    const nav = screen.getByRole("navigation", { name: "More in AI product management" });
    expect(within(nav).getAllByRole("link")).toHaveLength(4);
  });

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
