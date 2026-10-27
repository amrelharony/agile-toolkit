/**
 * lib/interviews/model: themes counted per participant, the quotes behind a
 * tag, stable pseudonyms with redacted context and quotes, and what raising
 * a quote as an opportunity hands over (never the participant's name).
 */

import { describe, expect, it } from "vitest";
import type { Interview, InterviewQuote, TreeNode } from "@/lib/stores/workspace-types";
import {
  UI_ID,
  anonymiseInterviews,
  normTag,
  normTags,
  participantCount,
  participantKey,
  quoteOpportunitySource,
  quotesTagged,
  sentOpportunity,
  themeCounts,
  withoutName,
} from "@/lib/interviews/model";

const q = (id: string, tags: string[], text = `quote ${id}`): InterviewQuote => ({
  id,
  text,
  tags,
});
const iv = (
  id: string,
  participant: string,
  quotes: InterviewQuote[],
  over: Partial<Interview> = {}
): Interview => ({
  id,
  date: "2026-10-14",
  participant,
  quotes,
  ...over,
});

describe("tags", () => {
  it("normalise to trimmed lower case, each once", () => {
    expect(normTag("  UX ")).toBe("ux");
    expect(normTags(["UX", "ux ", " ", "Pricing", "pricing"])).toEqual(["ux", "pricing"]);
  });
});

describe("participants", () => {
  it("match by name ignoring case and spacing; an unnamed interview is its own", () => {
    expect(participantKey(iv("i1", "  Ana   Silva ", []))).toBe("ana silva");
    expect(participantKey(iv("i2", "", []))).toBe("#i2");
    expect(
      participantCount([iv("a", "Ana", []), iv("b", "ana", []), iv("c", "", []), iv("d", " ", [])])
    ).toBe(3);
  });
});

describe("themeCounts", () => {
  const log = [
    iv("i1", "Ana", [q("q1", ["pricing"]), q("q2", ["Pricing"]), q("q3", ["pricing", "pricing"])]),
    iv("i2", "Ben", [q("q4", ["onboarding"])]),
    iv("i3", "Cy", [q("q5", ["onboarding", "pricing"])]),
    iv("i4", "Dee", [q("q6", ["onboarding"])]),
    iv("i5", "ana", [q("q7", ["onboarding"])]),
  ];

  it("counts a theme per participant, then per quote", () => {
    expect(themeCounts(log)).toEqual([
      { tag: "onboarding", participants: 4, quotes: 4 },
      { tag: "pricing", participants: 2, quotes: 4 },
    ]);
  });

  it("breaks a tie by quotes, then by name", () => {
    expect(
      themeCounts([iv("i1", "A", [q("q1", ["b", "a"]), q("q2", ["c"]), q("q3", ["c"])])]).map(
        (t) => t.tag
      )
    ).toEqual(["c", "a", "b"]);
  });

  it("is empty with no tags", () => {
    expect(themeCounts([iv("i1", "A", [q("q1", [])])])).toEqual([]);
    expect(themeCounts([])).toEqual([]);
  });

  it("lists the quotes behind a tag with their interview", () => {
    const found = quotesTagged(log, " PRICING ");
    expect(found.map((f) => [f.interview.id, f.quote.id])).toEqual([
      ["i1", "q1"],
      ["i1", "q2"],
      ["i1", "q3"],
      ["i3", "q5"],
    ]);
    expect(quotesTagged(log, " ")).toEqual([]);
  });
});

describe("anonymiseInterviews", () => {
  it("gives each participant a stable pseudonym by first appearance", () => {
    const out = anonymiseInterviews([
      iv("i1", "Ben", []),
      iv("i2", "Ana", []),
      iv("i3", " ben ", []),
      iv("i4", "", []),
    ]);
    expect(out.map((i) => i.participant)).toEqual([
      "Participant 1",
      "Participant 2",
      "Participant 1",
      "Participant 3",
    ]);
  });

  it("redacts the context and every quote, and keeps tags so themes still count", () => {
    const [out] = anonymiseInterviews([
      iv("i1", "Ana", [q("q1", ["pricing"], "Mail me at ana@example.com")], {
        context: "Call +44 20 7946 0958 to follow up",
      }),
    ]);
    expect(out.context).not.toContain("7946");
    expect(out.context).toContain("[redacted:phone]");
    expect(out.quotes[0].text).toBe("Mail me at [redacted:email]");
    expect(out.quotes[0].tags).toEqual(["pricing"]);
    expect(JSON.stringify(out)).not.toContain("Ana");
  });

  it("adds no context an interview didn't have", () => {
    expect(anonymiseInterviews([iv("i1", "Ana", [])])[0]).not.toHaveProperty("context");
  });

  it("replaces the participant's own name in the context and the quotes with the pseudonym", () => {
    const out = anonymiseInterviews([
      iv("i1", "Ben", []),
      iv("i2", "Dana Lee", [q("q1", [], "As dana LEE put it: Dana's team waits a week.")], {
        context: "Dana Lee, ops lead. dana@example.com. DANA joined late.",
      }),
    ]);
    expect(out[1].context).toBe(
      "Participant 2, ops lead. [redacted:email]. Participant 2 joined late."
    );
    expect(out[1].quotes[0].text).toBe(
      "As Participant 2 put it: Participant 2's team waits a week."
    );
    expect(JSON.stringify(out[1])).not.toMatch(/dana|lee/i);
  });
});

describe("withoutName", () => {
  it("matches the name on its own, in any case and spacing, never inside a word", () => {
    expect(withoutName("Ana and Banana; ANA, ana.", "Ana", "P1")).toBe("P1 and Banana; P1, P1.");
    expect(withoutName("Dana\n Lee said", " dana  lee ", "P1")).toBe("P1 said");
    expect(withoutName("Leeds, not Lee", "Dana Lee", "P1")).toBe("Leeds, not Lee");
  });

  it("takes a longer name's first word too, unless the name is a numbered label", () => {
    expect(withoutName("Dana said so", "Dana Lee", "the participant")).toBe(
      "The participant said so"
    );
    expect(withoutName("Then Dana said so", "Dana Lee", "the participant")).toBe(
      "Then the participant said so"
    );
    // "Customer 3" names no one: only the whole label goes.
    expect(withoutName("Customer 3 says every customer waits", "Customer 3", "P1")).toBe(
      "P1 says every customer waits"
    );
  });

  it("reads a 'name, role' participant by its name, its punctuation aside", () => {
    const who = "Sam, engineering manager";
    expect(withoutName("Sam said the export is slow.", who, "Participant 1")).toBe(
      "Participant 1 said the export is slow."
    );
    expect(withoutName("Sam, engineering manager, joined; then Sam said so", who, "P1")).toBe(
      "P1, joined; then P1 said so"
    );
    expect(withoutName("Ask Sam (EM) or Sam", "Sam (EM)", "P1")).toBe("Ask P1 or P1");
    // A name typed with a trailing comma is still the name, and the text keeps its own commas.
    expect(withoutName("Thanks, Sam.", "Sam,", "P1")).toBe("Thanks, P1.");
    expect(withoutName("Thanks, Sam, see you", "Sam,", "P1")).toBe("Thanks, P1, see you");
    // Samantha is someone else.
    expect(withoutName("Samantha said", who, "P1")).toBe("Samantha said");
  });

  it("reads a two-word name before a role as the whole name, then its first word", () => {
    for (const who of ["Dana Lee, PM", "Dana Lee (PM)", "Dana Lee; product"]) {
      expect(withoutName("Dana Lee said the export is slow.", who, "Participant 1"), who).toBe(
        "Participant 1 said the export is slow."
      );
      expect(withoutName("Then Dana said so", who, "P1"), who).toBe("Then P1 said so");
    }
    // A digit in the label's other part doesn't keep the name's first word.
    expect(withoutName("Dana said", "Dana Lee, customer 3", "P1")).toBe("P1 said");
    expect(withoutName("Dana said", "Dana (Customer 3)", "P1")).toBe("P1 said");
  });

  it("reads a role-first label by its name, leaving the role word alone", () => {
    expect(withoutName("The PM said Sam was right", "PM, Sam", "P1")).toBe(
      "The PM said P1 was right"
    );
    expect(withoutName("Ask the CTO; Dana Lee knows", "CTO (Dana Lee)", "P1")).toBe(
      "Ask the CTO; P1 knows"
    );
    expect(
      withoutName("The engineering manager said Sam agreed", "engineering manager, Sam", "P1")
    ).toBe("The engineering manager said P1 agreed");
    // Typed all in lower case, no part reads as a name: the first part is the name.
    expect(withoutName("Dana Lee said, then Dana", "dana lee, pm", "P1")).toBe("P1 said, then P1");
  });

  it("leaves the text alone without a usable name", () => {
    for (const name of [undefined, "", "  ", "A"]) {
      expect(withoutName("A day with Ana", name, "P1"), String(name)).toBe("A day with Ana");
    }
  });

  it("treats a name's regex characters as text", () => {
    expect(withoutName("J.R. (Jr) said, JXR didn't", "J.R. (Jr)", "P1")).toBe(
      "P1 said, JXR didn't"
    );
    expect(withoutName("Zoë Kim and Zoë", "Zoë Kim", "P1")).toBe("P1 and P1");
  });
});

describe("raising a quote as an opportunity", () => {
  it("hands over the redacted text, the interview's day and where it came from, never the name", () => {
    const interview = iv("i1", "Ana Silva", []);
    const src = quoteOpportunitySource(
      q("q1", ["x"], "  Ana here: write to ana@example.com  "),
      interview,
      "o1"
    );
    expect(src).toEqual({
      title: "The participant here: write to [redacted:email]",
      description: "From an interview on 2026-10-14",
      parentId: "o1",
      sourceRef: { tool: "user-interviews", id: "q1", doc: "i1" },
    });
    expect(src).not.toHaveProperty("owner");
    expect(src).not.toHaveProperty("raisedBy");
  });

  it("leaves out a parent it wasn't given and a day the interview doesn't have", () => {
    const src = quoteOpportunitySource(q("q1", []), iv("i1", "A", [], { date: "" }));
    expect(src).not.toHaveProperty("parentId");
    expect(src.description).toBe("From an interview");
  });

  it("finds the opportunity a quote was raised as while it is on the tree", () => {
    const nodes: TreeNode[] = [{ id: "n1", kind: "opportunity", text: "x", parentId: null }];
    const sent = {
      sentTo: [{ route: "opportunity" as const, targetId: "n1", at: "2026-10-20T00:00:00Z" }],
    };
    expect(sentOpportunity(sent, nodes)?.id).toBe("n1");
    expect(sentOpportunity(sent, [])).toBeUndefined();
    expect(sentOpportunity({}, nodes)).toBeUndefined();
  });

  it("keeps the log's one id", () => {
    expect(UI_ID).toBe("userInterviewLog:current");
  });
});
