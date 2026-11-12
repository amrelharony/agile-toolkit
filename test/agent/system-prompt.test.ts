/**
 * System prompt — current-date injection. The agent was refusing relative-date
 * requests ("create a sprint starting today") because it had no date context;
 * the prompt now carries today's date and an instruction to compute from it.
 *
 * Also the one Amr voice and the shared reply rules (reply-format.ts): the
 * prompt opens "You are Amr", asks for lists and no tables, emoji, backticked
 * ids or dashes, and is written without them itself, since the model copies it.
 */

import { describe, it, expect, vi } from "vitest";
import { REPLY_FORMAT_RULES } from "@/lib/agent/reply-format";
import { formatToday, buildSystemPrompt } from "@/lib/agent/system-prompt";

describe("formatToday", () => {
  it("formats a date as ISO + pretty using local calendar fields", () => {
    // Local midnight June 3, 2026 (a Wednesday).
    const s = formatToday(new Date(2026, 5, 3));
    expect(s).toMatch(/^2026-06-03 \(/);
    expect(s).toContain("June 3, 2026");
    expect(s).toContain("Wednesday");
  });

  it("zero-pads single-digit months and days", () => {
    expect(formatToday(new Date(2026, 0, 9))).toMatch(/^2026-01-09 \(/);
  });

  it("defaults to now and yields a well-formed string", () => {
    expect(formatToday()).toMatch(/^\d{4}-\d{2}-\d{2} \(.+\)$/);
  });
});

describe("buildSystemPrompt date wiring", () => {
  it("includes today's date and the relative-date instruction", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("Today's date is");
    expect(p).toContain(String(new Date().getFullYear()));
    expect(p).toMatch(/Resolve relative dates/i);
    // The old absolute "never invent dates" rule must not reappear (it caused
    // the over-cautious refusal this change fixes).
    expect(p).not.toContain("Never invent ids, dates, or state");
  });
});

/** En and em dashes (U+2013, U+2014): the known complaint, and the model copies them. */
const DASH = new RegExp(`[${String.fromCodePoint(0x2013, 0x2014)}]`);
/** Colour emoji, and the variation selector (U+FE0F) that turns a symbol into one. */
const EMOJI = new RegExp(`[\\p{Extended_Pictographic}${String.fromCodePoint(0xfe0f)}]`, "u");

/** A prompt with every optional part that is written in this file. */
function fullPrompt(): string {
  return buildSystemPrompt({
    toolId: "retro",
    relevantActions: [
      { id: "tool.retro.add_card", description: "Add a card to a retro column." },
      { id: "workspace.sprint.create", description: "Create a sprint.\n  It starts today." },
    ],
  });
}

describe("REPLY_FORMAT_RULES", () => {
  it("asks for plain sentences and lists, with no tables, emoji, ids or dashes", () => {
    expect(REPLY_FORMAT_RULES).toMatch(/plain sentences in short paragraphs/);
    expect(REPLY_FORMAT_RULES).toMatch(/bulleted or numbered list/);
    expect(REPLY_FORMAT_RULES).toMatch(/lists, no tables/i);
    expect(REPLY_FORMAT_RULES).toMatch(/No emoji\./);
    expect(REPLY_FORMAT_RULES).toMatch(/Never show an action id or a tool id/);
    expect(REPLY_FORMAT_RULES).toMatch(/in backticks or otherwise/);
    expect(REPLY_FORMAT_RULES).toMatch(/No em dashes or en dashes/);
    expect(REPLY_FORMAT_RULES).toContain("[Name](/path)");
    expect(REPLY_FORMAT_RULES).toMatch(/never a made-up one/);
  });

  it("is bullet lines with no heading, so each prompt heads it", () => {
    for (const line of REPLY_FORMAT_RULES.split("\n")) expect(line).toMatch(/^- \S/);
  });

  it("is itself written without dashes, emoji or backticks", () => {
    expect(REPLY_FORMAT_RULES).not.toMatch(DASH);
    expect(REPLY_FORMAT_RULES).not.toMatch(EMOJI);
    expect(REPLY_FORMAT_RULES).not.toContain("`");
  });
});

describe("buildSystemPrompt formatting guidance", () => {
  it("tells the model it can use bold and italic, and never emoji", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/Formatting:/);
    expect(p).toMatch(/\bMarkdown\b/);
    expect(p).toContain("**bold**");
    expect(p).toContain("*italic*");
    expect(p).toMatch(/No emoji/);
    expect(p).not.toMatch(/Use emojis/i);
  });

  it("carries the shared reply rules under Formatting: lists, no tables", () => {
    const p = buildSystemPrompt();
    expect(p).toContain(REPLY_FORMAT_RULES);
    expect(p.indexOf(REPLY_FORMAT_RULES)).toBeGreaterThan(p.indexOf("Formatting:"));
    expect(p.indexOf(REPLY_FORMAT_RULES)).toBeLessThan(p.indexOf("Current context:"));
    expect(p).toMatch(/no tables/i);
  });

  it("no longer asks for backticked ids", () => {
    const p = fullPrompt();
    expect(p).not.toMatch(/`code` for ids/);
    expect(p).not.toContain("`");
  });

  it("lists the relevant actions by bare id, one line each", () => {
    const p = fullPrompt();
    expect(p).toContain("- tool.retro.add_card: Add a card to a retro column.");
    expect(p).toContain("- workspace.sprint.create: Create a sprint. It starts today.");
  });

  it("is written without em or en dashes, and without emoji", () => {
    for (const p of [buildSystemPrompt(), fullPrompt()]) {
      expect(p).not.toMatch(DASH);
      expect(p).not.toMatch(EMOJI);
    }
  });
});

describe("buildSystemPrompt voice", () => {
  it("opens as Amr", () => {
    expect(buildSystemPrompt()).toMatch(/^You are Amr, the guide of the Agile Toolkit\./);
  });

  it("never calls itself an agent or an assistant", () => {
    expect(fullPrompt()).not.toMatch(/\b(agent|assistant)s?\b/i);
  });

  it("keeps the rules about tools and confirmation", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/workspace_sprint_create \(dots become underscores; the runtime resolves/);
    expect(p).toMatch(/Read actions execute immediately\. Write actions are gated by per-call/);
    expect(p).toMatch(/Always reach for an action when one fits/);
    expect(p).toMatch(/Multi-step requests: chain tools/);
    expect(p).toMatch(/Never invent ids or state\. List first, then act\./);
    expect(p).toMatch(/Echo the planned action\(s\) to the user briefly before invoking/);
    expect(p).toMatch(/denies a confirmation, summarise and offer alternatives/);
    expect(p).toMatch(/up to 10 tool-use round-trips per turn/);
  });
});

describe("buildSystemPrompt grounding", () => {
  const GROUNDING =
    "About the tool the user has open (use this to explain or coach):\nCurrent tool: Retrospective (/retro)";

  it("includes the grounding block in the current context", () => {
    const p = buildSystemPrompt({ toolId: "retro", grounding: GROUNDING });
    expect(p).toContain(GROUNDING);
    // After the context line, before the safety rules.
    expect(p.indexOf(GROUNDING)).toBeGreaterThan(p.indexOf("Current context:"));
    expect(p.indexOf(GROUNDING)).toBeLessThan(p.indexOf("Safety:"));
  });

  it("is unchanged without grounding", () => {
    // Pin "now" (a Date subclass, not fake timers) so the prompts built below
    // can't straddle midnight and differ only in today's date.
    const FIXED = new Date(2026, 5, 3, 12).getTime();
    const RealDate = Date;
    vi.stubGlobal(
      "Date",
      class extends RealDate {
        constructor(...args: ConstructorParameters<typeof Date>) {
          super(...((args.length ? args : [FIXED]) as [number]));
        }
        static now() {
          return FIXED;
        }
      }
    );
    try {
      const plain = buildSystemPrompt({ toolId: "retro" });
      expect(buildSystemPrompt({ toolId: "retro", grounding: "" })).toBe(plain);
      expect(buildSystemPrompt({ toolId: "retro", grounding: "   " })).toBe(plain);
      expect(buildSystemPrompt({ toolId: "retro", grounding: null })).toBe(plain);
      expect(plain).not.toContain("About the tool the user has open");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("tells the model to link toolkit pages and never make up a path", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("[Name](/path)");
    expect(p).toMatch(/never a made-up one/);
  });

  it("no longer claims every action is offered on every turn", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/Each turn offers the ones that fit/);
  });
});
