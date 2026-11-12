/**
 * What <Markdown> puts in the DOM for a reply: tables in a labelled region a
 * keyboard can scroll, numbered lists that keep their numbers, one level of
 * nesting, headings as h3, quotes and rules, code that keeps its language,
 * visible code chips, marked external links, `dir="auto"` on text blocks so
 * an Arabic reply reads right to left, and never any HTML from the reply.
 * The parser itself is pinned in markdown.test.ts.
 */

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Markdown } from "@/components/agent/markdown";

const classes = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
const starts = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("ol")).map((ol) => ol.getAttribute("start"));

const TABLE = [
  "| Tool | Use it for | Time |",
  "|---|---|--:|",
  "| [Retro](/retro) | Looking back | 45 min |",
  "| `Sprint` | Planning |",
].join("\n");

describe("<Markdown> tables", () => {
  it("sits in a focusable region named for scrolling sideways", () => {
    render(<Markdown source={TABLE} />);
    const region = screen.getByRole("region", { name: "Table, scrolls sideways" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(classes(region)).toEqual(
      expect.arrayContaining(["overflow-x-auto", "overscroll-x-contain"])
    );
    const table = within(region).getByRole("table");
    expect(classes(table)).toContain("font-data");
  });

  it("has column headers, quiet cell lines, and pads a short row", () => {
    const { container } = render(<Markdown source={TABLE} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["Tool", "Use it for", "Time"]);
    for (const h of headers) expect(h).toHaveAttribute("scope", "col");
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[1].querySelectorAll("td")).toHaveLength(3);
    for (const cell of Array.from(container.querySelectorAll("th, td"))) {
      expect(classes(cell)).toEqual(expect.arrayContaining(["border", "border-rule"]));
    }
    // The separator's "--:" right-aligns its column.
    expect(classes(rows[0].querySelectorAll("td")[2])).toContain("text-right");
    expect(classes(rows[0].querySelectorAll("td")[0])).toContain("text-start");
  });

  it("renders links and code chips inside cells", () => {
    render(<Markdown source={TABLE} />);
    expect(screen.getByRole("link", { name: "Retro" })).toHaveAttribute("href", "/retro");
    expect(screen.getByText("Sprint").tagName).toBe("CODE");
  });

  it("orders an Arabic table's columns right to left", () => {
    const { container } = render(
      <Markdown source={"| المهمة | المالك |\n|---|---|\n| التصميم | أحمد |"} />
    );
    expect(container.querySelector("table")).toHaveAttribute("dir", "rtl");
  });

  it("orders an English table left to right", () => {
    const { container } = render(<Markdown source={TABLE} />);
    expect(container.querySelector("table")).toHaveAttribute("dir", "ltr");
  });
});

describe("<Markdown> lists", () => {
  it("keeps a numbered list's first number", () => {
    const { container } = render(<Markdown source={"4. Demo it.\n5. Ask for feedback."} />);
    expect(starts(container)).toEqual(["4"]);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("carries the numbers on when text splits the steps", () => {
    const { container } = render(
      <Markdown
        source={"1. Open the board.\n\nEveryone sees it.\n\n2. Add cards.\n\nThen:\n\n3. Vote."}
      />
    );
    expect(starts(container)).toEqual(["1", "2", "3"]);
  });

  it("counts on when every step is numbered 1 and text sits between", () => {
    const { container } = render(
      <Markdown
        source={"1. Pick a goal.\n\nOne sentence.\n\n1. Pull in work.\n\nNo more.\n\n1. Start."}
      />
    );
    expect(starts(container)).toEqual(["1", "2", "3"]);
  });

  it("nests one level, with logical padding", () => {
    const { container } = render(
      <Markdown source={"1. Plan the sprint\n   - Pick a goal\n   - Pull in items\n2. Run it"} />
    );
    const outer = container.querySelector("ol") as HTMLOListElement;
    const nested = outer.querySelector("li > ul") as HTMLUListElement;
    expect(nested).not.toBeNull();
    expect(
      within(nested)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual(["Pick a goal", "Pull in items"]);
    expect(classes(nested)).toContain("list-[circle]");
    for (const list of [outer, nested]) {
      expect(classes(list)).toContain("ps-5");
      expect(classes(list)).not.toContain("pl-5");
    }
  });
});

describe("<Markdown> headings, quotes, rules and code", () => {
  it("shows every heading level as h3", () => {
    const { container } = render(<Markdown source={"# Big\n\n## Middle\n\n### Small"} />);
    expect(container.querySelectorAll("h1, h2, h4, h5, h6")).toHaveLength(0);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Big",
      "Middle",
      "Small",
    ]);
  });

  it("renders quotes and rules", () => {
    const { container } = render(
      <Markdown source={"> Inspect and adapt.\n>\n> Every sprint.\n\n---\n\nThat is it."} />
    );
    const quote = container.querySelector("blockquote") as HTMLElement;
    expect(within(quote).getAllByText(/Inspect|Every/)).toHaveLength(2);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("keeps a fence's language and lets a keyboard scroll the code", () => {
    const { container } = render(<Markdown source={"```ts\nconst goal = 'Ship login';\n```"} />);
    const pre = screen.getByRole("region", { name: "Code, ts, scrolls sideways" });
    expect(pre.tagName).toBe("PRE");
    expect(pre).toHaveAttribute("data-lang", "ts");
    expect(pre).toHaveAttribute("tabindex", "0");
    expect(classes(pre)).toEqual(
      expect.arrayContaining(["overflow-x-auto", "overscroll-x-contain"])
    );
    expect(classes(pre.querySelector("code") as Element)).toContain("font-data");
    // The language label is for the eye; the region's name already says it.
    const label = screen.getByText("ts");
    expect(label).toHaveAttribute("aria-hidden", "true");
    expect(container.textContent).toContain("const goal = 'Ship login';");
  });

  it("gives code with no language no language", () => {
    render(<Markdown source={"```\nnpm test\n```"} />);
    const pre = screen.getByRole("region", { name: "Code, scrolls sideways" });
    expect(pre).not.toHaveAttribute("data-lang");
  });

  it("draws a code chip on its own ground with a quiet line, so it shows on the card", () => {
    render(<Markdown source={"Type `retro` to find it."} />);
    expect(classes(screen.getByText("retro"))).toEqual(
      expect.arrayContaining(["bg-surface-deep", "border", "border-rule", "font-data"])
    );
  });
});

describe("<Markdown> direction", () => {
  const SOURCE = [
    "هذه خطة السبرينت.",
    "",
    "## الخطوات",
    "",
    "1. اختر الهدف",
    "   - هدف واحد",
    "",
    "> فحص وتكيف",
    "",
    "| المهمة | المالك |",
    "|---|---|",
    "| التصميم | أحمد |",
    "",
    "```",
    "npm test",
    "```",
  ].join("\n");

  it('puts dir="auto" on every text block: p, h3, quote, lists and cells', () => {
    const { container } = render(<Markdown source={SOURCE} />);
    const blocks = container.querySelectorAll("p, h3, blockquote, ul, ol, th, td");
    expect(blocks.length).toBeGreaterThanOrEqual(8);
    for (const el of Array.from(blocks)) {
      if (el.closest("blockquote") && el.tagName === "P") continue; // inherits the quote's
      expect(el, el.outerHTML).toHaveAttribute("dir", "auto");
    }
  });

  it("lets list items follow their list, so the markers stay inside its padding", () => {
    const { container } = render(<Markdown source={SOURCE} />);
    for (const li of Array.from(container.querySelectorAll("li")))
      expect(li).not.toHaveAttribute("dir");
  });

  it("keeps code left to right", () => {
    const { container } = render(<Markdown source={SOURCE} />);
    expect(container.querySelector("pre")).toHaveAttribute("dir", "ltr");
  });
});

describe("<Markdown> links", () => {
  it("marks an external link: a hidden icon and words for screen readers", () => {
    render(<Markdown source={"Read [the Scrum Guide](https://scrumguides.org)."} />);
    const link = screen.getByRole("link", { name: /^the Scrum Guide\s\(opens in a new tab\)$/ });
    expect(link).toHaveAttribute("target", "_blank");
    const icon = link.querySelector("svg") as SVGElement;
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(within(link).getByText("(opens in a new tab)")).toHaveClass("sr-only");
  });

  it("leaves the site's own links and mail links unmarked", () => {
    render(<Markdown source={"See [Retro](/retro) or [write](mailto:team@example.com)."} />);
    const own = screen.getByRole("link", { name: "Retro" });
    const mail = screen.getByRole("link", { name: "write" });
    for (const link of [own, mail]) {
      expect(link.querySelector("svg")).toBeNull();
      expect(link).not.toHaveAttribute("target");
    }
  });
});

describe("<Markdown> never renders HTML from a reply", () => {
  it("shows tags, scripts and unsafe links as text, in every block", () => {
    const source = [
      '<img src=x onerror="alert(1)"> hello',
      "",
      "- <script>alert(1)</script>",
      "",
      "| A | B |",
      "|---|---|",
      "| <b>bold</b> | [x](javascript:alert(1)) |",
      "",
      "> <iframe src=//evil.com></iframe>",
      "",
      "## <u>title</u>",
    ].join("\n");
    const { container } = render(<Markdown source={source} />);
    expect(container.querySelectorAll("img, script, b, iframe, u")).toHaveLength(0);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)"> hello');
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.textContent).toContain("[x](javascript:alert(1))");
    expect(container.innerHTML).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });
});

describe("<Markdown> while a reply streams", () => {
  const REPLY = [
    "Two tools fit:",
    "",
    "| Tool | Use |",
    "|---|---|",
    "| Retro | Look back |",
    "",
    "1. Open it.",
    "",
    "2. Add cards.",
    "",
    "```ts",
    "const done = true;",
    "```",
  ].join("\n");

  it("ends in the same DOM as rendering the whole reply at once", () => {
    const streamed = render(<Markdown source="" />);
    for (let n = 1; n <= REPLY.length; n += 2) {
      streamed.rerender(<Markdown source={REPLY.slice(0, n)} />);
    }
    streamed.rerender(<Markdown source={REPLY} />);
    const whole = render(<Markdown source={REPLY} />);
    // isEqualNode: attributes added mid-stream (the fence's data-lang) may
    // sit in another order, which means nothing.
    expect(streamed.container.isEqualNode(whole.container)).toBe(true);
    expect(streamed.container.textContent).toBe(whole.container.textContent);
  });

  it("keeps a finished block's element as the next one grows", () => {
    const { container, rerender } = render(<Markdown source={"First part.\n\nSec"} />);
    const first = container.querySelector("p");
    rerender(<Markdown source={"First part.\n\nSecond part is longer."} />);
    expect(container.querySelector("p")).toBe(first);
    expect(container.querySelectorAll("p")[1].textContent).toBe("Second part is longer.");
  });
});
