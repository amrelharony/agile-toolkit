/**
 * Safe markdown subset parser for agent replies, and how <Markdown> renders
 * links: the site's own pages in the same tab, anything else in a new one.
 */

import { createElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/** The props each next/link got: the real Link still renders. */
const linkProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("next/link", async (importOriginal) => {
  const real = (await importOriginal<{ default: unknown }>()).default as Parameters<
    typeof createElement
  >[0];
  return {
    default: (props: Record<string, unknown>) => {
      linkProps.push(props);
      return createElement(real, props);
    },
  };
});
import { tokenizeInline, parseBlocks } from "@/lib/agent/markdown";
import { Markdown } from "@/components/agent/markdown";

/** Every token is plain text, and the text round-trips unchanged. */
function expectLiteral(src: string) {
  const toks = tokenizeInline(src);
  expect(toks.every((t) => t.type === "text")).toBe(true);
  expect(toks.map((t) => (t.type === "text" ? t.value : "")).join("")).toBe(src);
}

describe("tokenizeInline — the site's own pages", () => {
  it("allows a link to one of the site's pages, marked internal", () => {
    expect(tokenizeInline("[Retro](/retro)")).toEqual([
      { type: "link", value: "Retro", href: "/retro", internal: true },
    ]);
    expect(tokenizeInline("see [the board](/retro/abc?tab=actions#top) now")).toEqual([
      { type: "text", value: "see " },
      { type: "link", value: "the board", href: "/retro/abc?tab=actions#top", internal: true },
      { type: "text", value: " now" },
    ]);
  });

  it("refuses a protocol-relative link to another host (//evil.com)", () => {
    expectLiteral("[x](//evil.com)");
    expectLiteral("[x](//evil.com/retro)");
  });

  it("refuses a slash-backslash link, which browsers read as another host (/\\evil)", () => {
    expectLiteral("[x](/\\evil)");
    expectLiteral("[x](/\\\\evil.com)");
  });

  it("still degrades javascript: and other schemes", () => {
    expectLiteral("[x](javascript:alert(1))");
    expectLiteral("[x](data:text/html,hi)");
    expectLiteral("[x](retro)");
  });
});

describe("<Markdown> links", () => {
  it("opens the site's own page in the same tab", () => {
    render(createElement(Markdown, { source: "Try [Retro](/retro)." }));
    const link = screen.getByRole("link", { name: "Retro" });
    expect(link).toHaveAttribute("href", "/retro");
    expect(link).not.toHaveAttribute("target");
    expect(link).not.toHaveAttribute("rel");
  });

  it("never prefetches a page the model linked: nothing is fetched until a click", () => {
    linkProps.length = 0;
    render(createElement(Markdown, { source: "See [Retro](/retro) and [Kudos](/kudos)." }));
    expect(linkProps.map((p) => [p.href, p.prefetch])).toEqual([
      ["/retro", false],
      ["/kudos", false],
    ]);
  });

  it("opens an external link in a new tab, without an opener", () => {
    render(createElement(Markdown, { source: "Read [this](https://example.com)." }));
    const link = screen.getByRole("link", { name: "this" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders a refused link as text", () => {
    render(createElement(Markdown, { source: "[x](//evil.com)" }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("[x](//evil.com)")).toBeInTheDocument();
  });
});

describe("tokenizeInline", () => {
  it("parses bold / italic / code", () => {
    expect(tokenizeInline("**b**")).toEqual([{ type: "bold", value: "b" }]);
    expect(tokenizeInline("*i*")).toEqual([{ type: "italic", value: "i" }]);
    expect(tokenizeInline("_i_")).toEqual([{ type: "italic", value: "i" }]);
    expect(tokenizeInline("`c`")).toEqual([{ type: "code", value: "c" }]);
  });

  it("splits surrounding text from a token", () => {
    expect(tokenizeInline("a **b** c")).toEqual([
      { type: "text", value: "a " },
      { type: "bold", value: "b" },
      { type: "text", value: " c" },
    ]);
  });

  it("allows http(s)/mailto links", () => {
    expect(tokenizeInline("[x](https://e.com)")).toEqual([
      { type: "link", value: "x", href: "https://e.com" },
    ]);
  });

  it("degrades an unsafe link href to literal text (no javascript: URLs)", () => {
    const toks = tokenizeInline("[x](javascript:alert(1))");
    // Never emits a link token, and the literal text round-trips unchanged.
    expect(toks.every((t) => t.type === "text")).toBe(true);
    expect(toks.map((t) => (t.type === "text" ? t.value : "")).join("")).toBe(
      "[x](javascript:alert(1))"
    );
  });

  it("does not interpret markdown inside inline code", () => {
    expect(tokenizeInline("`**not bold**`")).toEqual([{ type: "code", value: "**not bold**" }]);
  });

  it("does not italicize intraword underscores in snake_case ids", () => {
    // The model is told action ids look like `workspace_sprint_create`; in
    // prose those must not be split/italicized by the `_..._` rule.
    expect(tokenizeInline("workspace_sprint_create")).toEqual([
      { type: "text", value: "workspace_sprint_create" },
    ]);
    expect(tokenizeInline("call foo_bar now")).toEqual([
      { type: "text", value: "call foo_bar now" },
    ]);
    // Standalone underscore emphasis at word boundaries still works.
    expect(tokenizeInline("an _emphasized_ word")).toEqual([
      { type: "text", value: "an " },
      { type: "italic", value: "emphasized" },
      { type: "text", value: " word" },
    ]);
  });

  it("treats raw HTML as plain text", () => {
    expect(tokenizeInline("<script>x</script>")).toEqual([
      { type: "text", value: "<script>x</script>" },
    ]);
  });
});

describe("parseBlocks", () => {
  it("parses headings, paragraphs, lists, and code fences", () => {
    const src = ["# Title", "", "para line", "", "- a", "- b", "", "1. one", "2. two"].join("\n");
    expect(parseBlocks(src)).toEqual([
      { type: "h", text: "Title" },
      { type: "p", text: "para line" },
      { type: "ul", items: ["a", "b"] },
      { type: "ol", items: ["one", "two"] },
    ]);
  });

  it("captures a fenced code block verbatim", () => {
    const src = ["```", "const x = 1;", "x++;", "```"].join("\n");
    expect(parseBlocks(src)).toEqual([{ type: "code", text: "const x = 1;\nx++;" }]);
  });

  it("merges consecutive non-special lines into one paragraph", () => {
    expect(parseBlocks("line one\nline two")).toEqual([{ type: "p", text: "line one\nline two" }]);
  });
});
