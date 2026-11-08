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

  it("wraps long unbroken tokens instead of widening the page, while tables keep scrolling", () => {
    // A 200-character run with no break point (a Docs ID or a hash pasted into
    // a card) widened /s#… to 676px on a 360px phone.
    const longUrl = `https://docs.google.com/document/d/${"a1B2c3D4e5".repeat(16)}/edit`;
    expect(longUrl.length).toBeGreaterThanOrEqual(200);
    const { container } = render(
      <MarkdownView
        markdown={[
          `- ${longUrl}`,
          "",
          longUrl,
          "",
          `> ${longUrl}`,
          "",
          `- [ ] Read ${longUrl}`,
          "",
          "| Link | Owner |",
          "|---|---|",
          `| ${longUrl} | Sam |`,
        ].join("\n")}
      />
    );

    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("break-words", "min-w-0");

    // Bullet, paragraph, quote and checklist text all inherit the wrap from
    // the root: none of them turns it back off.
    const prose = screen
      .getAllByText((ownText) => ownText.includes(longUrl))
      .filter((el) => !el.closest("table"));
    expect(prose.map((el) => el.tagName)).toEqual(["SPAN", "P", "BLOCKQUOTE", "SPAN"]);
    for (const el of prose) {
      expect(root).toContainElement(el);
      expect(el.closest(".break-normal")).toBeNull();
    }

    // A checklist row is a flex container, so its text span must be allowed
    // to shrink below the token's width.
    const todo = screen.getByText("To do:").parentElement as HTMLElement;
    expect(todo.parentElement).toHaveClass("flex");
    expect(todo).toHaveClass("min-w-0");

    // The table stays in its scroll wrapper and keeps its columns whole.
    const wrapper = screen.getByRole("table").parentElement as HTMLElement;
    expect(wrapper).toHaveClass("overflow-x-auto", "break-normal");
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
