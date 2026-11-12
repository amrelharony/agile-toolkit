/**
 * Safe markdown subset parser for agent replies, and how <Markdown> renders
 * links: the site's own pages in the same tab, anything else in a new one.
 *
 * The corpus at the end is replies shaped like Amr's real ones (steps split
 * by text, nested lists, tables, quotes, code, an Arabic reply). Each pins
 * its blocks, and every prefix of each (as it streams) parses the same with
 * the caching parser as from scratch, and the same cut into segments as
 * whole. The rendered DOM is checked in markdown-render.test.tsx.
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
import {
  createBlockCache,
  createBlockParser,
  numberLists,
  parseBlocks,
  parseSegment,
  splitSegments,
  textDirection,
  tokenizeInline,
  type Block,
  type ListBlock,
  type ListItem,
} from "@/lib/agent/markdown";
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
    // \s: a no-break space keeps the new-tab icon on the link's last word.
    const link = screen.getByRole("link", { name: /^this\s\(opens in a new tab\)$/ });
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
      { type: "ul", items: [{ text: "a" }, { text: "b" }] },
      { type: "ol", start: 1, items: [{ text: "one" }, { text: "two" }] },
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

// ── The corpus: replies shaped like Amr's ──────────────────────────────

interface Reply {
  name: string;
  src: string;
  blocks: Block[];
}

const lines = (...l: string[]) => l.join("\n");
const item = (text: string, children?: ListBlock[]): ListItem =>
  children ? { text, children } : { text };

const CORPUS: Reply[] = [
  {
    name: "two short paragraphs",
    src: lines("Your sprint ends on Friday.", "", "Open [Sprint](/sprint) to see what is left."),
    blocks: [
      { type: "p", text: "Your sprint ends on Friday." },
      { type: "p", text: "Open [Sprint](/sprint) to see what is left." },
    ],
  },
  {
    name: "numbered steps",
    src: lines(
      "Here is how to run it:",
      "1. Open [Retro](/retro).",
      "2. Ask everyone to add cards.",
      "3. Vote on the top three."
    ),
    blocks: [
      { type: "p", text: "Here is how to run it:" },
      {
        type: "ol",
        start: 1,
        items: [
          item("Open [Retro](/retro)."),
          item("Ask everyone to add cards."),
          item("Vote on the top three."),
        ],
      },
    ],
  },
  {
    name: "numbered steps split by text keep their numbers",
    src: lines(
      "1. Open the board.",
      "",
      "Everyone sees the same columns.",
      "",
      "2. Add cards.",
      "",
      "Give it five quiet minutes.",
      "",
      "3. Vote."
    ),
    blocks: [
      { type: "ol", start: 1, items: [item("Open the board.")] },
      { type: "p", text: "Everyone sees the same columns." },
      { type: "ol", start: 2, items: [item("Add cards.")] },
      { type: "p", text: "Give it five quiet minutes." },
      { type: "ol", start: 3, items: [item("Vote.")] },
    ],
  },
  {
    name: "every step numbered 1 with text between counts on",
    src: lines(
      "1. Pick a goal.",
      "",
      "Keep it to one sentence.",
      "",
      "1. Pull in the work.",
      "",
      "```",
      "Points: 21",
      "```",
      "",
      "1. Start."
    ),
    blocks: [
      { type: "ol", start: 1, items: [item("Pick a goal.")] },
      { type: "p", text: "Keep it to one sentence." },
      { type: "ol", start: 2, items: [item("Pull in the work.")] },
      { type: "code", text: "Points: 21" },
      { type: "ol", start: 3, items: [item("Start.")] },
    ],
  },
  {
    name: "a loose list stays one list",
    src: lines("1. Plan", "", "2. Build", "", "3. Review"),
    blocks: [{ type: "ol", start: 1, items: [item("Plan"), item("Build"), item("Review")] }],
  },
  {
    name: "a list that starts at 4",
    src: lines("Carry on from step 4:", "", "4. Demo it.", "5. Ask for feedback."),
    blocks: [
      { type: "p", text: "Carry on from step 4:" },
      { type: "ol", start: 4, items: [item("Demo it."), item("Ask for feedback.")] },
    ],
  },
  {
    name: "bullets nested under numbered steps",
    src: lines(
      "1. Plan the sprint",
      "   - Pick a goal",
      "   - Pull in the top items",
      "2. Run the daily",
      "   - Fifteen minutes"
    ),
    blocks: [
      {
        type: "ol",
        start: 1,
        items: [
          item("Plan the sprint", [
            { type: "ul", items: [item("Pick a goal"), item("Pull in the top items")] },
          ]),
          item("Run the daily", [{ type: "ul", items: [item("Fifteen minutes")] }]),
        ],
      },
    ],
  },
  {
    name: "numbers nested under bullets, deeper levels joining the nested one",
    src: lines("- Before the retro", "  1. Book a room", "    2. Send the link", "- After it"),
    blocks: [
      {
        type: "ul",
        items: [
          item("Before the retro", [
            { type: "ol", start: 1, items: [item("Book a room"), item("Send the link")] },
          ]),
          item("After it"),
        ],
      },
    ],
  },
  {
    name: "a step with its own indented lines",
    src: lines(
      "1. **Plan**",
      "   Pick one goal for the sprint.",
      "",
      "   Then pull in the work.",
      "2. **Run**"
    ),
    blocks: [
      {
        type: "ol",
        start: 1,
        items: [
          item("**Plan**\nPick one goal for the sprint.\n\nThen pull in the work."),
          item("**Run**"),
        ],
      },
    ],
  },
  {
    name: "a comparison table",
    src: lines(
      "Two tools fit:",
      "",
      "| Tool | Use it for |",
      "|---|---|",
      "| [Retro](/retro) | Looking back |",
      "| [Sprint](/sprint) | Planning ahead |",
      "",
      "Start with Retro."
    ),
    blocks: [
      { type: "p", text: "Two tools fit:" },
      {
        type: "table",
        head: ["Tool", "Use it for"],
        align: [null, null],
        rows: [
          ["[Retro](/retro)", "Looking back"],
          ["[Sprint](/sprint)", "Planning ahead"],
        ],
      },
      { type: "p", text: "Start with Retro." },
    ],
  },
  {
    name: "a table with alignment, no edge pipes and ragged rows",
    src: lines(
      "Name | Points | Note",
      ":-- | --: | :-:",
      "Login | 3",
      "Search | 5 | split it | extra"
    ),
    blocks: [
      {
        type: "table",
        head: ["Name", "Points", "Note"],
        align: ["left", "right", "center"],
        rows: [
          ["Login", "3", ""],
          ["Search", "5", "split it"],
        ],
      },
    ],
  },
  {
    name: "a table right under its intro line, with a pipe inside code",
    src: lines(
      "The commands:",
      "| Command | Does |",
      "| --- | --- |",
      "| `a | b` | pipes |",
      "| a \\| b | escaped |"
    ),
    blocks: [
      { type: "p", text: "The commands:" },
      {
        type: "table",
        head: ["Command", "Does"],
        align: [null, null],
        rows: [
          ["`a | b`", "pipes"],
          ["a | b", "escaped"],
        ],
      },
    ],
  },
  {
    name: "a table still streaming its separator stays text",
    src: lines("| Tool | Use |", "| --"),
    blocks: [{ type: "p", text: "| Tool | Use |\n| --" }],
  },
  {
    name: "headings at every level",
    src: lines(
      "# Retro formats",
      "",
      "## Start, stop, continue ##",
      "Simple and quick.",
      "### Sailboat"
    ),
    blocks: [
      { type: "h", text: "Retro formats" },
      { type: "h", text: "Start, stop, continue" },
      { type: "p", text: "Simple and quick." },
      { type: "h", text: "Sailboat" },
    ],
  },
  {
    name: "a quote, then the point",
    src: lines("> Inspect and adapt,", "> every sprint.", "", "That is the heart of it."),
    blocks: [
      { type: "quote", paragraphs: ["Inspect and adapt,\nevery sprint."] },
      { type: "p", text: "That is the heart of it." },
    ],
  },
  {
    name: "a quote of two paragraphs, nested markers flattened",
    src: lines("> First part.", ">", "> > Second part."),
    blocks: [{ type: "quote", paragraphs: ["First part.", "Second part."] }],
  },
  {
    name: "rules between parts",
    src: lines("Part one.", "---", "Part two.", "", "* * *", "", "Part three."),
    blocks: [
      { type: "p", text: "Part one." },
      { type: "hr" },
      { type: "p", text: "Part two." },
      { type: "hr" },
      { type: "p", text: "Part three." },
    ],
  },
  {
    name: "code with its language and a blank line inside",
    src: lines(
      "Paste this:",
      "",
      "```json",
      '{ "goal": "Ship login",',
      "",
      '  "points": 21 }',
      "```"
    ),
    blocks: [
      { type: "p", text: "Paste this:" },
      { type: "code", lang: "json", text: '{ "goal": "Ship login",\n\n  "points": 21 }' },
    ],
  },
  {
    name: "a step's code indented under it",
    src: lines("1. Install it:", "   ```bash", "   npm install", "   ```", "2. Run it."),
    blocks: [
      { type: "ol", start: 1, items: [item("Install it:")] },
      { type: "code", lang: "bash", text: "npm install" },
      { type: "ol", start: 2, items: [item("Run it.")] },
    ],
  },
  {
    name: "a fence still streaming",
    src: lines("```ts", "const goal ="),
    blocks: [{ type: "code", lang: "ts", text: "const goal =" }],
  },
  {
    name: "links in a list",
    src: lines(
      "- [Retro](/retro) for the team",
      "- [The Scrum Guide](https://scrumguides.org) for the rules",
      "- [Mail me](mailto:a@example.com)"
    ),
    blocks: [
      {
        type: "ul",
        items: [
          item("[Retro](/retro) for the team"),
          item("[The Scrum Guide](https://scrumguides.org) for the rules"),
          item("[Mail me](mailto:a@example.com)"),
        ],
      },
    ],
  },
  {
    name: "a change of list kind starts a new list",
    src: lines("- one", "- two", "1. first", "", "- after a gap"),
    blocks: [
      { type: "ul", items: [item("one"), item("two")] },
      { type: "ol", start: 1, items: [item("first")] },
      { type: "ul", items: [item("after a gap")] },
    ],
  },
  {
    name: "raw HTML is text",
    src: lines("<b>bold?</b>", "", "<script>alert(1)</script>"),
    blocks: [
      { type: "p", text: "<b>bold?</b>" },
      { type: "p", text: "<script>alert(1)</script>" },
    ],
  },
  {
    name: "an Arabic reply with a list and a table",
    src: lines(
      "هذه خطة السبرينت.",
      "",
      "1. اختر الهدف",
      "2. اختر المهام",
      "",
      "| المهمة | المالك |",
      "|---|---|",
      "| التصميم | أحمد |"
    ),
    blocks: [
      { type: "p", text: "هذه خطة السبرينت." },
      { type: "ol", start: 1, items: [item("اختر الهدف"), item("اختر المهام")] },
      {
        type: "table",
        head: ["المهمة", "المالك"],
        align: [null, null],
        rows: [["التصميم", "أحمد"]],
      },
    ],
  },
];

describe("parseBlocks: a corpus of replies", () => {
  it("has 20 or more replies", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(20);
  });

  for (const reply of CORPUS) {
    it(reply.name, () => {
      expect(parseBlocks(reply.src)).toEqual(reply.blocks);
    });
  }

  it("cutting a reply into segments never changes what it parses to", () => {
    for (const { src } of CORPUS) {
      expect(parseBlocks(src)).toEqual(numberLists(parseSegment(src)));
    }
  });

  it("while a reply streams, the caching parser gives what a fresh parse gives", () => {
    for (const { src } of CORPUS) {
      const parse = createBlockParser();
      for (let n = 1; n <= src.length; n++) {
        const prefix = src.slice(0, n);
        expect(parse(prefix)).toEqual(parseBlocks(prefix));
        expect(parseBlocks(prefix)).toEqual(numberLists(parseSegment(prefix)));
      }
    }
  });
});

/** Lines that sit on the edges between blocks: lists, nesting, fences, tables, quotes, rules. */
const TRICKY_LINES = [
  "",
  "",
  "",
  "para",
  "- a",
  "* b",
  "1. one",
  "2. two",
  "3) three",
  " - one space in",
  "  - nested",
  "   1. nested number",
  "     - deeper",
  "  carried on",
  "    deep text",
  "\tTabbed",
  "```",
  "```js",
  "   ```",
  "~~~",
  "> quote",
  ">",
  "# head",
  "---",
  "- - -",
  "| a | b |",
  "|---|---|",
  "| 1 | 2 |",
  "x | y",
];

describe("parseBlocks: mixed-up replies", () => {
  it("parse the same cut into segments as whole, and the same with the cache", () => {
    let seed = 42;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let k = 0; k < 2000; k++) {
      const count = 1 + Math.floor(next() * 12);
      const src = Array.from(
        { length: count },
        () => TRICKY_LINES[Math.floor(next() * TRICKY_LINES.length)]
      ).join("\n");
      const whole = numberLists(parseSegment(src));
      expect(parseBlocks(src), JSON.stringify(src)).toEqual(whole);
      const parse = createBlockParser();
      for (let n = 1; n < src.length; n += 3) parse(src.slice(0, n));
      expect(parse(src), JSON.stringify(src)).toEqual(whole);
    }
  });
});

describe("splitSegments", () => {
  it("cuts at blank lines and drops them", () => {
    expect(splitSegments("one\n\n\ntwo\n")).toEqual(["one", "two"]);
  });

  it("never cuts inside a code fence", () => {
    expect(splitSegments("```\na\n\nb\n```\n\nafter")).toEqual(["```\na\n\nb\n```", "after"]);
  });

  it("never cuts a list the next lines carry on", () => {
    expect(splitSegments("1. a\n\n2. b\n\n   more\n\nDone.")).toEqual([
      "1. a\n\n2. b\n\n   more",
      "Done.",
    ]);
  });

  it("cuts after a list once a plain line has ended it", () => {
    expect(splitSegments("- a\nThat's all.\n\n- b")).toEqual(["- a\nThat's all.", "- b"]);
  });
});

describe("createBlockParser", () => {
  it("keeps finished blocks and parses only the segment still growing", () => {
    const parse = createBlockParser();
    const first = parse("Intro.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nThen");
    const next = parse("Intro.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nThen more");
    expect(next[0]).toBe(first[0]);
    expect(next[1]).toBe(first[1]);
    expect(next[2]).not.toBe(first[2]);
    expect(next[2]).toEqual({ type: "p", text: "Then more" });
  });

  it("never changes a cached list when it renumbers one", () => {
    const parse = createBlockParser();
    const a = parse("1. a\n\nwhy\n\n1. b");
    const b = parse("1. a\n\nwhy\n\n1. b");
    expect(a[2]).toEqual({ type: "ol", start: 2, items: [{ text: "b" }] });
    expect(b[2]).toEqual({ type: "ol", start: 2, items: [{ text: "b" }] });
  });
});

describe("parseBlocks with a cache", () => {
  it("reuses a finished segment's blocks and parses the same as without one", () => {
    const cache = createBlockCache();
    const first = parseBlocks("Intro.\n\n- a\n- b\n\nThen", cache);
    const nextSrc = "Intro.\n\n- a\n- b\n\nThen more";
    const next = parseBlocks(nextSrc, cache);
    expect(next[0]).toBe(first[0]);
    expect(next[1]).toBe(first[1]);
    expect(next).toEqual(parseBlocks(nextSrc));
  });

  it("keeps only the segments of the last parse", () => {
    const cache = createBlockCache();
    parseBlocks("One.\n\nTwo.", cache);
    parseBlocks("Three.", cache);
    expect(Array.from(cache.segments.keys())).toEqual(["Three."]);
  });
});

describe("numberLists", () => {
  const ol = (start: number, n: number): Block => ({
    type: "ol",
    start,
    items: Array.from({ length: n }, (_, i) => ({ text: String(i) })),
  });
  const starts = (blocks: Block[]) => blocks.map((b) => (b.type === "ol" ? b.start : null));

  it("leaves two real lists that each start at 1 alone", () => {
    expect(starts(numberLists([ol(1, 2), { type: "p", text: "x" }, ol(1, 2)]))).toEqual([
      1,
      null,
      1,
    ]);
  });

  it("starts over after a heading", () => {
    expect(starts(numberLists([ol(1, 1), { type: "h", text: "Next" }, ol(1, 1)]))).toEqual([
      1,
      null,
      1,
    ]);
  });
});

describe("textDirection", () => {
  it("finds the first strong letter's direction", () => {
    expect(textDirection("المهمة المالك")).toBe("rtl");
    expect(textDirection("**שלום** world")).toBe("rtl");
    expect(textDirection("1. Plan الخطة")).toBe("ltr");
    expect(textDirection("123 | 456")).toBeUndefined();
  });
});
