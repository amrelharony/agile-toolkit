/**
 * The sectioned kit's pure model (lib/sectioned/model.ts), shared by Kickoff
 * and Product Canvas: format checks, reading a document against its format
 * (caps, with a tool's extra item fields kept), room, placeholders, gaps,
 * the Markdown with and without a credit, the drafted-line filter, adding
 * accepted lines with the ids Undo needs, and the server half's prompt
 * text.
 */

import { describe, expect, it } from "vitest";
import { TOOL_LIST_MAX, TOOL_TEXT_MAX, type SectionItem } from "@/lib/stores/workspace-types";
import {
  SECTION_ID_PATTERN,
  addDraftLines,
  cleanSections,
  creditLine,
  creditUrl,
  draftLinesFor,
  formatProblems,
  hasPlaceholder,
  isBlankItem,
  lineKey,
  removeDraftLines,
  roomLeft,
  sectionGaps,
  sectionsMarkdown,
  type SectionDef,
  type SectionFormat,
  type Sections,
} from "@/lib/sectioned/model";
import { SECTIONED_RULES, sectionListText } from "@/lib/ai/tasks/_sectioned.server";

const def = (over: Partial<SectionDef> & Pick<SectionDef, "id">): SectionDef => ({
  label: `Label ${over.id}`,
  prompt: `What goes in ${over.id}.`,
  kind: "list",
  max: 3,
  required: false,
  ...over,
});

const FORMAT: SectionFormat = {
  id: "test-format",
  name: "Test format",
  useWhen: "When a test needs a document.",
  time: "About 10 minutes",
  lead: "aim",
  credit: {
    text: "After a made-up canvas",
    url: "https://example.com/canvas",
    licence: "CC BY 4.0",
  },
  sections: [
    def({
      id: "aim",
      label: "Our aim",
      kind: "single",
      max: 1,
      required: true,
      starter: "We want [what] by [when]",
    }),
    def({ id: "ideas", label: "Ideas", max: 3, required: true, starter: "[an idea]" }),
    def({ id: "story", label: "The story", kind: "long", max: 1 }),
    def({ id: "risks", label: "Risks", max: 2 }),
  ],
};

/** A tool's own item, extending the kit's (as Kickoff's and Product Canvas's do). */
interface RatedItem extends SectionItem {
  likelihood?: number;
  evidence?: "fact" | "assumption";
}

const item = (id: string, text: string, over: Partial<RatedItem> = {}): RatedItem => ({
  id,
  text,
  ...over,
});

const CAPS = { itemMax: 20, longMax: 50 };

describe("format checks", () => {
  it("finds nothing wrong with a sound format", () => {
    expect(formatProblems(FORMAT)).toEqual([]);
  });

  it("uses the kit's id rule: lower case, digits and dashes, at most 32 characters", () => {
    expect(SECTION_ID_PATTERN.source).toBe("^[a-z][a-z0-9-]{0,31}$");
    expect(SECTION_ID_PATTERN.test("why-now")).toBe(true);
    expect(SECTION_ID_PATTERN.test("a".repeat(32))).toBe(true);
    expect(SECTION_ID_PATTERN.test("a".repeat(33))).toBe(false);
    expect(SECTION_ID_PATTERN.test("Why")).toBe(false);
    expect(SECTION_ID_PATTERN.test("1st")).toBe(false);
    expect(SECTION_ID_PATTERN.test("__proto__")).toBe(false);
  });

  it("names each broken rule of a section", () => {
    const bad: SectionFormat = {
      ...FORMAT,
      sections: [
        def({ id: "Bad Id" }),
        def({ id: "ok", label: "", prompt: "x".repeat(201), hint: "  " }),
        def({ id: "big", max: TOOL_LIST_MAX.sectionItems + 1 }),
        def({ id: "none", max: 0 }),
        def({ id: "one", kind: "single", max: 2 }),
        def({ id: "starter", starter: "No brackets here" }),
        def({ id: "lines", starter: "Two [lines]\nhere" }),
        def({ id: "links", links: ["risk-register", "risk-register", "Not A Tool"] }),
        def({ id: "ok" }),
      ],
    };
    const problems = formatProblems(bad).join("\n");
    expect(problems).toMatch(/section "Bad Id": the id must be/);
    expect(problems).toMatch(/section "ok": it needs a label/);
    expect(problems).toMatch(/section "ok": the prompt is over 200/);
    expect(problems).toMatch(/section "ok": the hint is empty/);
    expect(problems).toMatch(/section "big": a list holds 1 to 30 items/);
    expect(problems).toMatch(/section "none": a list holds 1 to 30 items/);
    expect(problems).toMatch(/section "one": a single answer holds exactly 1 item/);
    expect(problems).toMatch(/section "starter": the starter has no \[brackets\]/);
    expect(problems).toMatch(/section "lines": the starter is more than one line/);
    expect(problems).toMatch(/links to "risk-register" twice/);
    expect(problems).toMatch(/"Not A Tool" is not a tool id/);
    expect(problems).toMatch(/the section id "ok" is used twice/);
  });

  it("checks the format itself: id, words, the section count, the lead and the credit", () => {
    const tooMany = Array.from({ length: TOOL_LIST_MAX.sections + 1 }, (_, i) =>
      def({ id: `s${i}` })
    );
    const problems = formatProblems({
      ...FORMAT,
      id: "Not an id",
      name: " ",
      useWhen: "",
      time: "",
      lead: "missing",
      credit: { text: "", url: "http://example.com", licence: "" },
      sections: tooMany,
    }).join("\n");
    expect(problems).toMatch(/the id must be/);
    expect(problems).toMatch(/it needs a name/);
    expect(problems).toMatch(/it needs a line on when to use it/);
    expect(problems).toMatch(/its time is empty/);
    expect(problems).toMatch(/it has 17 sections, and 1 to 16 fit/);
    expect(problems).toMatch(/its lead "missing" is not one of its sections/);
    expect(problems).toMatch(/its credit needs a line of text/);
    expect(problems).toMatch(/its credit link must be an https address/);
    expect(problems).toMatch(/its credit's licence is empty/);
    expect(formatProblems({ ...FORMAT, sections: [] }).join("\n")).toMatch(/it has 0 sections/);
  });
});

describe("reading a document", () => {
  it("keeps the format's sections in its order and drops other keys and non-lists", () => {
    const out = cleanSections<RatedItem>(
      {
        extra: [item("x", "x")],
        risks: [item("r1", "Late")],
        ideas: "not a list",
        aim: [item("a", "Ship")],
      },
      FORMAT,
      CAPS
    );
    expect(Object.keys(out)).toEqual(["aim", "risks"]);
    expect(out.risks).toEqual([item("r1", "Late")]);
  });

  it("reads nothing from something that isn't an object", () => {
    expect(cleanSections(null, FORMAT, CAPS)).toEqual({});
    expect(cleanSections([[item("a", "b")]], FORMAT, CAPS)).toEqual({});
    expect(cleanSections("aim", FORMAT, CAPS)).toEqual({});
  });

  it("drops items without a string id (1 to 64 characters) or a string text", () => {
    const out = cleanSections(
      {
        ideas: [
          { id: "i1", text: "Keep" },
          { id: "", text: "No id" },
          { id: 7, text: "Number id" },
          { id: "x".repeat(65), text: "Long id" },
          { id: "i2" },
          { id: "i3", text: 5 },
          "a string",
          null,
          { id: "i4", text: "" },
        ],
      },
      FORMAT,
      CAPS
    );
    expect(out.ideas.map((i) => i.id)).toEqual(["i1", "i4"]);
  });

  it("cuts a list to its max and a single or long answer to its first item", () => {
    const out = cleanSections(
      {
        ideas: [item("1", "a"), item("2", "b"), item("3", "c"), item("4", "d")],
        aim: [item("a1", "first"), item("a2", "second")],
        story: [item("s1", "once"), item("s2", "twice")],
      },
      FORMAT,
      CAPS
    );
    expect(out.ideas.map((i) => i.id)).toEqual(["1", "2", "3"]);
    expect(out.aim.map((i) => i.id)).toEqual(["a1"]);
    expect(out.story.map((i) => i.id)).toEqual(["s1"]);
  });

  it("counts only items it keeps towards a section's max", () => {
    const out = cleanSections(
      {
        aim: [{ id: "" }, item("a2", "the real one")],
        risks: [null, item("r1", "a"), item("r2", "b"), item("r3", "c")],
      },
      FORMAT,
      CAPS
    );
    expect(out.aim.map((i) => i.id)).toEqual(["a2"]);
    expect(out.risks.map((i) => i.id)).toEqual(["r1", "r2"]);
  });

  it("cuts text to the item cap, or the long cap for a long answer, without splitting a character", () => {
    const out = cleanSections(
      {
        ideas: [item("1", "x".repeat(30)), item("2", `${"x".repeat(19)}😀`)],
        aim: [item("a", "y".repeat(30))],
        story: [item("s", "z".repeat(80))],
      },
      FORMAT,
      CAPS
    );
    expect(out.ideas[0].text).toHaveLength(20);
    // A cut through the emoji would leave half of it: it goes whole.
    expect(out.ideas[1].text).toBe("x".repeat(19));
    expect(out.aim[0].text).toHaveLength(20);
    expect(out.story[0].text).toHaveLength(50);
  });

  it("keeps an item's other fields as they are (the tool's own reader checks them)", () => {
    const raw = {
      risks: [
        { id: "r1", text: "Late", likelihood: 4, evidence: "fact", covers: "c1", nested: { a: 1 } },
      ],
    };
    const out = cleanSections<RatedItem>(raw, FORMAT, CAPS);
    expect(out.risks[0]).toEqual({
      id: "r1",
      text: "Late",
      likelihood: 4,
      evidence: "fact",
      covers: "c1",
      nested: { a: 1 },
    });
  });

  it("keeps an owner only when it is a non-empty string, cut to the short cap", () => {
    const out = cleanSections(
      {
        risks: [
          { id: "r1", text: "a", owner: "Sam" },
          { id: "r2", text: "b", owner: "o".repeat(TOOL_TEXT_MAX.short + 5) },
        ],
        ideas: [
          { id: "i1", text: "c", owner: "  " },
          { id: "i2", text: "d", owner: 3 },
        ],
      },
      FORMAT,
      CAPS
    );
    expect(out.risks[0].owner).toBe("Sam");
    expect(out.risks[1].owner).toHaveLength(TOOL_TEXT_MAX.short);
    expect(out.ideas[0]).not.toHaveProperty("owner");
    expect(out.ideas[1]).not.toHaveProperty("owner");
  });

  it("keeps valid hand-off links only, one per route, the last one winning", () => {
    const at = "2026-11-20T10:00:00.000Z";
    const out = cleanSections(
      {
        risks: [
          {
            id: "r1",
            text: "a",
            sentTo: [
              { route: "risk", targetId: "old", at },
              { route: "nowhere", targetId: "t", at },
              { route: "hypothesis", targetId: "", at },
              { route: "decision", targetId: "d1" },
              "not a link",
              { route: "risk", targetId: "new", at, extra: true },
            ],
          },
          { id: "r2", text: "b", sentTo: [{ route: "nowhere", targetId: "t", at }] },
        ],
        ideas: [{ id: "i1", text: "c", sentTo: "risk" }],
      },
      FORMAT,
      CAPS
    );
    expect(out.risks[0].sentTo).toEqual([{ route: "risk", targetId: "new", at }]);
    expect(out.risks[1]).not.toHaveProperty("sentTo");
    expect(out.ideas[0]).not.toHaveProperty("sentTo");
  });

  it("never reads a section from the object's prototype", () => {
    const format: SectionFormat = {
      ...FORMAT,
      lead: "constructor",
      sections: [def({ id: "constructor" })],
    };
    expect(cleanSections({}, format, CAPS)).toEqual({});
    expect(
      sectionGaps({ ...format, sections: [def({ id: "constructor", required: true })] }, {})
    ).toEqual([{ sectionId: "constructor", kind: "empty" }]);
  });
});

describe("room and placeholders", () => {
  it("counts the room a section has left", () => {
    const ideas = FORMAT.sections[1];
    expect(roomLeft(ideas, undefined)).toBe(3);
    expect(roomLeft(ideas, [item("1", "a")])).toBe(2);
    expect(roomLeft(ideas, [item("1", "a"), item("2", "b"), item("3", "c"), item("4", "d")])).toBe(
      0
    );
    const aim = FORMAT.sections[0];
    expect(roomLeft(aim, [])).toBe(1);
    expect(roomLeft(aim, [item("a", "Ship")])).toBe(0);
  });

  it("finds a [placeholder] left from a starter line, and only one with words in it", () => {
    expect(hasPlaceholder("We want [what] by [when]")).toBe(true);
    expect(hasPlaceholder("[an idea]")).toBe(true);
    expect(hasPlaceholder("Call [3] people")).toBe(true);
    expect(hasPlaceholder("Ship it by May")).toBe(false);
    expect(hasPlaceholder("A box [ ] to tick")).toBe(false);
    expect(hasPlaceholder("[]")).toBe(false);
    expect(hasPlaceholder("Open [bracket\non two lines]")).toBe(false);
  });

  it("treats an item with no text and no owner as blank", () => {
    expect(isBlankItem(item("1", "  "))).toBe(true);
    expect(isBlankItem(item("1", "", { owner: "Sam" }))).toBe(false);
    expect(isBlankItem(item("1", "Words"))).toBe(false);
  });
});

describe("gaps", () => {
  it("lists empty required sections and placeholder lines, in the format's order", () => {
    const sections: Sections = {
      aim: [item("a", "We want [what] by May")],
      ideas: [item("i1", "  ")],
      risks: [item("r1", "Late"), item("r2", "[a risk]")],
    };
    expect(sectionGaps(FORMAT, sections)).toEqual([
      { sectionId: "aim", kind: "placeholder", itemId: "a" },
      { sectionId: "ideas", kind: "empty" },
      { sectionId: "risks", kind: "placeholder", itemId: "r2" },
    ]);
  });

  it("finds no gaps in a filled document, and every required section in an empty one", () => {
    expect(sectionGaps(FORMAT, { aim: [item("a", "Ship")], ideas: [item("i", "Try")] })).toEqual(
      []
    );
    expect(sectionGaps(FORMAT, {})).toEqual([
      { sectionId: "aim", kind: "empty" },
      { sectionId: "ideas", kind: "empty" },
    ]);
  });

  it("counts an item with only an owner as something", () => {
    expect(
      sectionGaps(FORMAT, { aim: [item("a", "Ship")], ideas: [item("i", "", { owner: "Sam" })] })
    ).toEqual([]);
  });
});

describe("Markdown", () => {
  const sections: Sections<RatedItem> = {
    aim: [item("a", "Ship tap to pay")],
    ideas: [
      item("i1", "Try a pilot", { owner: "Sam" }),
      item("i2", "  "),
      item("i3", "Ask\nsupport"),
    ],
    story: [item("s", "First line.\r\n\r\nSecond paragraph.  ")],
    risks: [],
  };

  it("writes a heading per section with something in it, lists as bullets, answers as paragraphs, then the credit", () => {
    expect(sectionsMarkdown(FORMAT, sections)).toBe(
      [
        "## Our aim",
        "",
        "Ship tap to pay",
        "",
        "## Ideas",
        "",
        "- Try a pilot (Sam)",
        "- Ask support",
        "",
        "## The story",
        "",
        "First line.\n\nSecond paragraph.",
        "",
        "After a made-up canvas (CC BY 4.0) · https://example.com/canvas",
      ].join("\n")
    );
  });

  it("ends with no credit line when the format has none, and leaves a bad link out", () => {
    const md = sectionsMarkdown({ ...FORMAT, credit: undefined }, sections);
    expect(md.endsWith("Second paragraph.")).toBe(true);
    expect(md).not.toMatch(/After/);
    const insecure = sectionsMarkdown(
      { ...FORMAT, credit: { text: "After a canvas", url: "javascript:alert(1)" } },
      { aim: [item("a", "Ship")] }
    );
    expect(insecure).toBe("## Our aim\n\nShip\n\nAfter a canvas");
  });

  it("lets the tool write each item's line, and leaves out an item whose line is empty", () => {
    const md = sectionsMarkdown(FORMAT, sections, {
      itemLine: (i, d) =>
        d.kind === "list" ? (i.text.trim() ? `${i.text} (guess)` : "") : `> ${i.text.trim()}`,
    });
    expect(md).toContain("- Try a pilot (guess)");
    expect(md).toContain("- Ask support (guess)");
    expect(md).toContain("> Ship tap to pay");
    expect(md).not.toMatch(/^- {2}\(guess\)/m);
  });

  it("passes the tool's own section type to itemLine", () => {
    interface FlagDef extends SectionDef {
      flag?: true;
    }
    const format: SectionFormat<FlagDef> = {
      ...FORMAT,
      sections: [{ ...def({ id: "aim" }), flag: true }],
    };
    const md = sectionsMarkdown(
      format,
      { aim: [item("a", "Ship")] },
      {
        itemLine: (i, d) => (d.flag ? `${i.text} !` : i.text),
      }
    );
    expect(md).toContain("- Ship !");
  });

  it("writes only the credit for a document with nothing in it", () => {
    expect(sectionsMarkdown(FORMAT, {})).toBe(
      "After a made-up canvas (CC BY 4.0) · https://example.com/canvas"
    );
    expect(sectionsMarkdown({ ...FORMAT, credit: undefined }, {})).toBe("");
  });

  it("shows a credit's link only when it is https, and its licence only when there is one", () => {
    expect(creditUrl({ text: "x", url: "https://example.com" })).toBe("https://example.com");
    expect(creditUrl({ text: "x", url: "http://example.com" })).toBeUndefined();
    expect(creditUrl({ text: "x", url: "not a url" })).toBeUndefined();
    expect(creditUrl({ text: "x" })).toBeUndefined();
    expect(creditUrl(undefined)).toBeUndefined();
    expect(creditLine({ text: "After a canvas" })).toBe("After a canvas");
    expect(creditLine({ text: "After a canvas", licence: "CC BY-SA 4.0" })).toBe(
      "After a canvas (CC BY-SA 4.0)"
    );
  });
});

describe("drafted lines", () => {
  const sections: Sections = {
    aim: [],
    ideas: [item("i1", "Try a pilot")],
    risks: [item("r1", "Late")],
  };

  it("keeps lines for the format's list sections only, trimmed to one line", () => {
    const out = draftLinesFor(FORMAT, sections, [
      { sectionId: "ideas", text: "  Ask\n support  " },
      { sectionId: "aim", text: "A single answer" },
      { sectionId: "story", text: "A long answer" },
      { sectionId: "nowhere", text: "Unknown" },
      { sectionId: "risks", text: "   " },
    ]);
    expect(out).toEqual({ lines: [{ sectionId: "ideas", text: "Ask support" }], dropped: 0 });
  });

  it("drops lines a section already holds and repeats, ignoring case and spaces", () => {
    const out = draftLinesFor(FORMAT, sections, [
      { sectionId: "ideas", text: "try  a PILOT" },
      { sectionId: "ideas", text: "Run a survey" },
      { sectionId: "ideas", text: "run a survey " },
      { sectionId: "risks", text: "Try a pilot" },
    ]);
    expect(out.lines).toEqual([
      { sectionId: "ideas", text: "Run a survey" },
      // Another section may hold the same words.
      { sectionId: "risks", text: "Try a pilot" },
    ]);
    expect(out.dropped).toBe(0);
  });

  it("keeps each section to its room, in the order the lines came, and counts what didn't fit", () => {
    const out = draftLinesFor(FORMAT, sections, [
      { sectionId: "risks", text: "Budget cut" },
      { sectionId: "ideas", text: "One" },
      { sectionId: "risks", text: "Key person leaves" },
      { sectionId: "ideas", text: "Two" },
      { sectionId: "ideas", text: "Three" },
      { sectionId: "ideas", text: "three" },
    ]);
    expect(out.lines).toEqual([
      { sectionId: "risks", text: "Budget cut" },
      { sectionId: "ideas", text: "One" },
      { sectionId: "ideas", text: "Two" },
    ]);
    expect(out.dropped).toBe(2);
  });

  it("compares lines by their words alone", () => {
    expect(lineKey("  Ship  IT\n now ")).toBe("ship it now");
  });
});

describe("adding accepted lines", () => {
  let n = 0;
  const makeId = () => `new${++n}`;

  it("adds lines at the end of their sections and says where each went", () => {
    n = 0;
    const sections: Sections<RatedItem> = {
      ideas: [item("i1", "Try a pilot", { likelihood: 2 })],
      risks: [item("r1", "Late")],
    };
    const { sections: next, added } = addDraftLines(
      sections,
      [
        { sectionId: "ideas", text: "Run a survey" },
        { sectionId: "aim", text: " Ship by May " },
        { sectionId: "ideas", text: "Ask support" },
      ],
      makeId
    );
    expect(added).toEqual([
      { sectionId: "ideas", itemId: "new1" },
      { sectionId: "aim", itemId: "new2" },
      { sectionId: "ideas", itemId: "new3" },
    ]);
    expect(next.ideas).toEqual([
      item("i1", "Try a pilot", { likelihood: 2 }),
      { id: "new1", text: "Run a survey" },
      { id: "new3", text: "Ask support" },
    ]);
    expect(next.aim).toEqual([{ id: "new2", text: "Ship by May" }]);
    // Untouched sections and the original document are left as they were.
    expect(next.risks).toBe(sections.risks);
    expect(sections.ideas).toHaveLength(1);
  });

  it("never changes an item that is there, and skips blank, repeated and badly named lines", () => {
    n = 0;
    const sections: Sections = {
      aim: [item("a", "Typed by hand")],
      ideas: [item("i1", "Try a pilot")],
    };
    const { sections: next, added } = addDraftLines(
      sections,
      [
        { sectionId: "ideas", text: "TRY a pilot" },
        { sectionId: "ideas", text: "  " },
        { sectionId: "__proto__", text: "Sneaky" },
        { sectionId: "Bad Id", text: "Nope" },
        { sectionId: "ideas", text: "New one" },
        { sectionId: "ideas", text: "new  one" },
      ],
      makeId
    );
    expect(added).toEqual([{ sectionId: "ideas", itemId: "new1" }]);
    expect(next.aim).toBe(sections.aim);
    expect(next.ideas.map((i) => i.text)).toEqual(["Try a pilot", "New one"]);
    expect(Object.getPrototypeOf(next)).toBe(Object.prototype);
  });

  it("gives back the same document when nothing was added", () => {
    const sections: Sections = { ideas: [item("i1", "Try a pilot")] };
    expect(addDraftLines(sections, [{ sectionId: "ideas", text: "try a pilot" }], makeId)).toEqual({
      sections,
      added: [],
    });
    expect(addDraftLines(sections, [], makeId).sections).toBe(sections);
  });

  it("Undo takes out exactly the added items, whatever was typed since", () => {
    n = 0;
    const sections: Sections = { ideas: [item("i1", "Try a pilot")], risks: [item("r1", "Late")] };
    const { sections: next, added } = addDraftLines(
      sections,
      [
        { sectionId: "ideas", text: "Run a survey" },
        { sectionId: "ideas", text: "Ask support" },
      ],
      makeId
    );
    // Someone types another line before pressing Undo.
    const typed: Sections = { ...next, ideas: [...next.ideas, item("i9", "Typed after")] };
    const undone = removeDraftLines(typed, added);
    expect(undone.ideas.map((i) => i.id)).toEqual(["i1", "i9"]);
    expect(undone.risks).toBe(typed.risks);
    expect(removeDraftLines(sections, [])).toBe(sections);
    expect(removeDraftLines(sections, [{ sectionId: "ideas", itemId: "gone" }])).toBe(sections);
  });
});

describe("the server half's prompt text", () => {
  it("lists each section's id, label, what it holds and its prompt, in order", () => {
    expect(sectionListText(FORMAT)).toBe(
      [
        "- aim: Our aim (one short answer). What goes in aim.",
        "- ideas: Ideas (a list of up to 3 lines). What goes in ideas.",
        "- story: The story (one longer answer). What goes in story.",
        "- risks: Risks (a list of up to 2 lines). What goes in risks.",
      ].join("\n")
    );
  });

  it("can list only some kinds of section", () => {
    expect(
      sectionListText(FORMAT, { kinds: ["list"] })
        .split("\n")
        .map((l) => l.split(":")[0])
    ).toEqual(["- ideas", "- risks"]);
  });

  it("holds the shared rules, one sentence each", () => {
    expect(SECTIONED_RULES.length).toBeGreaterThanOrEqual(4);
    const rules = SECTIONED_RULES.join(" ");
    expect(rules).toMatch(/only the section ids listed/);
    expect(rules).toMatch(/one idea per line/i);
    expect(rules).toMatch(/never invent names, dates or numbers/i);
    expect(rules).toMatch(/leave a section out rather than pad it/i);
    for (const rule of SECTIONED_RULES) expect(rule).toMatch(/^[A-Z].*\.$/);
  });
});
