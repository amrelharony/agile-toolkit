import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MarkdownView, parseMarkdown } from "@/components/share/markdown-view";

const md = `# Retro — 18 Oct 2026 (Start / Stop / Continue)

## Start
- Pair on the flaky CI job (3 votes)
  - Grouped: run tests in parallel
- Demo on Fridays

## Action items
- [ ] Fix CI — **Sam**
- [x] Book the demo slot

| # | Feature | WSJF |
|---|---|---|
| 1 | Fix card\\|declined message | 12.00 |
| 2 | Saved cards<br>for returning users | 4.00 |

> Make checkout effortless on mobile

See [the guide](/retro) or [bad](javascript:alert(1)).
`;

describe("MarkdownView", () => {
  it("parses the shapes the tool exports emit", () => {
    const types = parseMarkdown(md).map((b) => b.type);
    expect(types).toEqual([
      "heading",
      "heading",
      "list",
      "heading",
      "list",
      "table",
      "quote",
      "paragraph",
    ]);
  });

  it("renders headings, nested lists, checklists, tables, quotes and links as elements", () => {
    render(<MarkdownView markdown={md} />);
    expect(screen.getByRole("heading", { name: /Retro — 18 Oct 2026/ })).toBeInTheDocument();
    expect(screen.getByText("Grouped: run tests in parallel")).toBeInTheDocument();
    expect(screen.getByText("To do:")).toBeInTheDocument();
    expect(screen.getByText("Done:")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    // An escaped pipe stays inside its cell.
    expect(within(table).getByText("Fix card|declined message")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "the guide" })).toHaveAttribute("href", "/retro");
  });

  it("never renders HTML or unsafe links from the snapshot", () => {
    const { container } = render(
      <MarkdownView markdown={'<img src=x onerror="alert(1)"> and [x](javascript:alert(1))'} />
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });
});
