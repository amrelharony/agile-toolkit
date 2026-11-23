/**
 * Example Mapping's model (lib/example-mapping/model): the caps a write
 * keeps, readMap on junk, what the map says, splitTitle at 200, the
 * story write (criteria once each, scenarios once each, the caps), and the
 * Undo helpers for a deleted rule, example or question.
 */

import { describe, expect, it } from "vitest";
import {
  EXAMPLES_PER_RULE_MAX,
  RULES_MAX,
  QUESTIONS_MAX,
  blankMap,
  mapSignals,
  readMap,
  readMaps,
  ruleFromQuestion,
  ruleRemoval,
  rowTooBig,
  sameKey,
  splitDescription,
  splitTitle,
  storyWritePlan,
  suggestedVerdict,
  validateAnswerDraft,
  validateCardText,
  validateMapDraft,
  withCardRestored,
  withExample,
  withExampleEdit,
  withQuestion,
  withQuestionPatch,
  withRule,
  withRuleRestored,
  withVerdict,
  withoutRule,
} from "@/lib/example-mapping/model";
import { STORY_CRITERIA_MAX, STORY_GWT_MAX } from "@/lib/stories/fields";
import {
  ENTITY_ROW_MAX_BYTES,
  TOOL_LIST_MAX,
  type ExampleMap,
  type Story,
} from "@/lib/stores/workspace-types";
import { jsonBytes } from "@/lib/utils/json-bytes";

const NOW = "2026-11-23T10:00:00.000Z";
const map = (over: Partial<ExampleMap> = {}): ExampleMap => ({
  ...blankMap({ title: "Pay with a saved card" }, "exmap_a", NOW),
  ...over,
});
const withRules = (n: number, base = map()) => {
  let m = base;
  for (let i = 0; i < n; i++) m = withRule(m, `Rule ${i + 1}`, `r${i + 1}`, NOW) ?? m;
  return m;
};
const story = (over: Partial<Story> = {}): Story => ({
  id: "st1",
  title: "Pay with a saved card",
  status: "backlog",
  ...over,
});

describe("writing within the caps", () => {
  it("adds rules up to the cap and refuses a blank one", () => {
    const m = withRules(RULES_MAX);
    expect(m.rules).toHaveLength(TOOL_LIST_MAX.mapRules);
    expect(withRule(m, "One more", "x", NOW)).toBeNull();
    expect(withRule(map(), "   ", "x", NOW)).toBeNull();
  });

  it("keeps examples under a rule the map has, ten a rule at most", () => {
    let m = withRules(1);
    for (let i = 0; i < EXAMPLES_PER_RULE_MAX; i++) {
      m = withExample(m, { ruleId: "r1", text: `Example ${i}` }, `e${i}`, NOW) ?? m;
    }
    expect(m.examples).toHaveLength(EXAMPLES_PER_RULE_MAX);
    expect(withExample(m, { ruleId: "r1", text: "Eleventh" }, "e11", NOW)).toBeNull();
    expect(withExample(m, { ruleId: "nope", text: "Lost" }, "e12", NOW)).toBeNull();
  });

  it("keeps Given, When and Then only all three together", () => {
    const m = withRules(1);
    const half = withExample(m, { ruleId: "r1", text: "Half", given: "a", when: "b" }, "e1", NOW)!;
    expect(half.examples[0]).toEqual({ id: "e1", ruleId: "r1", text: "Half" });
    const full = withExample(
      m,
      { ruleId: "r1", text: "", given: "a card", when: "I pay", then: "it works" },
      "e2",
      NOW
    )!;
    expect(full.examples[0]).toMatchObject({
      text: "Given a card, when I pay, then it works.",
      then: "it works",
    });
    const plain = withExampleEdit(full, "e2", { gwt: null }, NOW)!;
    expect(plain.examples[0].given).toBeUndefined();
    expect(plain.examples[0].text).toBe("Given a card, when I pay, then it works.");
  });

  it("caps questions and keeps a question's rule only while the rule is there", () => {
    let m = withRules(1);
    m = withQuestion(m, { text: "Who decides?", ruleId: "r1", owner: " Priya " }, "q1", NOW)!;
    expect(m.questions[0]).toEqual({
      id: "q1",
      text: "Who decides?",
      ruleId: "r1",
      owner: "Priya",
      status: "open",
    });
    expect(
      withQuestion(m, { text: "Lost", ruleId: "gone" }, "q2", NOW)!.questions[1].ruleId
    ).toBeUndefined();
    for (let i = 1; i < QUESTIONS_MAX; i++)
      m = withQuestion(m, { text: `Q${i}` }, `q${i + 1}`, NOW)!;
    expect(withQuestion(m, { text: "Too many" }, "qx", NOW)).toBeNull();
    const answered = withQuestionPatch(
      m,
      "q1",
      { status: "answered", answer: "The holder." },
      NOW
    )!;
    expect(answered.questions[0]).toMatchObject({ status: "answered", answer: "The holder." });
    expect(
      withQuestionPatch(answered, "q1", { answer: "" }, NOW)!.questions[0].answer
    ).toBeUndefined();
  });

  it("deletes a rule with its examples, and Undo puts both back where they were", () => {
    let m = withRules(2);
    m = withExample(m, { ruleId: "r1", text: "One" }, "e1", NOW)!;
    m = withExample(m, { ruleId: "r2", text: "Two" }, "e2", NOW)!;
    m = withQuestion(m, { text: "About r1?", ruleId: "r1" }, "q1", NOW)!;
    const removal = ruleRemoval(m, "r1")!;
    const gone = withoutRule(m, "r1", NOW);
    expect(gone.rules.map((r) => r.id)).toEqual(["r2"]);
    expect(gone.examples.map((e) => e.id)).toEqual(["e2"]);
    expect(gone.questions[0].ruleId).toBeUndefined();
    const back = withRuleRestored(gone, removal, NOW);
    expect(back.rules.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(back.examples.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(back.questions[0].ruleId).toBe("r1");
  });

  it("puts a deleted example or question back at its place", () => {
    let m = withRules(1);
    m = withExample(m, { ruleId: "r1", text: "A" }, "e1", NOW)!;
    m = withExample(m, { ruleId: "r1", text: "B" }, "e2", NOW)!;
    const item = m.examples[0];
    const without = { ...m, examples: m.examples.slice(1) };
    expect(
      withCardRestored(without, { kind: "example", item, index: 0 }, NOW).examples.map((e) => e.id)
    ).toEqual(["e1", "e2"]);
  });

  it("makes an answered question a rule from its answer's first line", () => {
    expect(
      ruleFromQuestion({
        id: "q",
        text: "How long is a session?",
        status: "answered",
        answer: "\nTwelve hours.\nOr sign-out.",
      })
    ).toBe("Twelve hours.");
    expect(ruleFromQuestion({ id: "q", text: "Only holders?", status: "answered" })).toBe(
      "Only holders?"
    );
  });
});

describe("one synced row", () => {
  // 3-byte text: sixty examples with long Given/When/Then pass one row.
  const big = () => {
    let m = withRules(6);
    const part = "漢".repeat(1000);
    for (let i = 0; i < 60; i++) {
      m =
        withExample(
          m,
          {
            ruleId: `r${Math.floor(i / 10) + 1}`,
            text: "漢".repeat(200),
            given: part,
            when: part,
            then: part,
          },
          `e${i}`,
          NOW
        ) ?? m;
    }
    return m;
  };

  it("refuses a change that grows a map past ENTITY_ROW_MAX_BYTES, never one that shrinks it", () => {
    const m = big();
    expect(m.examples).toHaveLength(60);
    expect(jsonBytes(m)).toBeGreaterThan(ENTITY_ROW_MAX_BYTES);
    expect(rowTooBig(withRule(m, "One more", "r7", NOW)!, m)).toBe(true);
    // Cutting a map that is too big back down always goes through.
    const smaller = { ...m, examples: m.examples.slice(1) };
    expect(rowTooBig(smaller, m)).toBe(false);
    // Under the row, any change goes through.
    const small = withRules(2);
    expect(rowTooBig(withRule(small, "Third", "r3", NOW)!, small)).toBe(false);
  });
});

describe("readMap", () => {
  it("returns null for what isn't a map", () => {
    for (const junk of [null, 3, "x", [], { title: "no id" }]) expect(readMap(junk)).toBeNull();
  });

  it("rebuilds a junk row the way the CRUD would take it", () => {
    const m = readMap({
      id: "exmap_j",
      title: "  x".padEnd(500, "y"),
      verdict: "maybe",
      timeboxMinutes: 99,
      sentAt: "not a date",
      rules: [
        { id: "r1", text: "Kept", sentTo: [{ route: "nowhere", targetId: "t", at: NOW }] },
        { id: "r1", text: "Repeat id" },
        { id: "r2", text: "   " },
        "junk",
      ],
      examples: [
        { id: "e1", ruleId: "r1", text: "Under a rule", given: "g", when: "w" },
        { id: "e2", ruleId: "ghost", text: "Orphan" },
      ],
      questions: [{ id: "q1", text: "Q", status: "weird", ruleId: "ghost", answer: 5 }],
      createdAt: NOW,
      updatedAt: NOW,
    })!;
    expect(m.title.length).toBeLessThanOrEqual(200);
    expect(m.verdict).toBeUndefined();
    expect(m.timeboxMinutes).toBeUndefined();
    expect(m.sentAt).toBeUndefined();
    expect(m.rules).toEqual([{ id: "r1", text: "Kept" }]);
    expect(m.examples).toEqual([{ id: "e1", ruleId: "r1", text: "Under a rule" }]);
    expect(m.questions).toEqual([{ id: "q1", text: "Q", status: "open" }]);
  });

  it("cuts lists to their caps and drops repeated maps", () => {
    const rules = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, text: `R${i}` }));
    const m = readMap({
      id: "m",
      title: "T",
      rules,
      examples: [],
      questions: [],
      createdAt: NOW,
      updatedAt: NOW,
    })!;
    expect(m.rules).toHaveLength(RULES_MAX);
    expect(readMaps([m, m, null])).toHaveLength(1);
  });

  it("keeps every example the CRUD took, however many a rule has; adding one still keeps the cap", () => {
    const examples = Array.from({ length: 12 }, (_, i) => ({
      id: `e${i}`,
      ruleId: "r1",
      text: `Example ${i + 1}`,
    }));
    const m = readMap({ ...withRules(3), examples })!;
    expect(m.examples).toHaveLength(12);
    // The next write starts from this copy, so nothing is lost when it saves.
    expect(withVerdict(m, "ready", NOW).examples).toHaveLength(12);
    expect(withExample(m, { ruleId: "r1", text: "Thirteen" }, "e12", NOW)).toBeNull();
    expect(withExample(m, { ruleId: "r2", text: "Under another rule" }, "e12", NOW)).not.toBeNull();
  });
});

describe("what the map says", () => {
  const ids = (m: ExampleMap) => mapSignals(m).map((s) => s.id);

  it("asks for rules on an empty map", () => {
    expect(ids(map())).toEqual(["no-rules"]);
  });

  it("says not ready with three open questions, or more questions than rules", () => {
    let m = withRules(1);
    m = withQuestion(m, { text: "A" }, "q1", NOW)!;
    m = withQuestion(m, { text: "B" }, "q2", NOW)!;
    expect(ids(m)).toContain("not-ready");
    expect(suggestedVerdict(m)).toBe("not-yet");
  });

  it("says split with more than four rules, and names rules without an example", () => {
    const m = withRules(5);
    expect(ids(m)).toContain("too-big");
    expect(ids(m).filter((i) => i.startsWith("no-example:"))).toHaveLength(5);
    expect(suggestedVerdict(m)).toBe("split");
  });

  it("says a rule with more than four examples may be two", () => {
    let m = withRules(1);
    for (let i = 0; i < 5; i++) m = withExample(m, { ruleId: "r1", text: `E${i}` }, `e${i}`, NOW)!;
    expect(ids(m)).toContain("busy-rule:r1");
  });

  it("looks ready when every rule has an example and nothing is open", () => {
    let m = withRules(2);
    m = withExample(m, { ruleId: "r1", text: "A" }, "e1", NOW)!;
    m = withExample(m, { ruleId: "r2", text: "B" }, "e2", NOW)!;
    expect(ids(m)).toEqual(["looks-ready"]);
    expect(suggestedVerdict(m)).toBe("ready");
  });
});

describe("splitting", () => {
  it("keeps '<story>: <rule>' within 200, cutting the story first", () => {
    expect(splitTitle("Pay with a saved card", "Expired cards are refused")).toBe(
      "Pay with a saved card: Expired cards are refused"
    );
    const long = splitTitle("S".repeat(300), "R".repeat(100));
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.endsWith("R".repeat(100))).toBe(true);
    const both = splitTitle("S".repeat(300), "R".repeat(300));
    expect(both.length).toBeLessThanOrEqual(200);
    expect(both.startsWith("S")).toBe(true);
  });

  it("writes a rule's examples as the split story's notes", () => {
    let m = withRules(1);
    m = withExample(m, { ruleId: "r1", text: "Maria pays" }, "e1", NOW)!;
    expect(splitDescription(m, "r1")).toBe("- Maria pays");
    expect(splitDescription(withRules(1), "r1")).toBeUndefined();
  });
});

describe("the story write", () => {
  const mapped = () => {
    let m = withRules(2);
    m = withExample(
      m,
      { ruleId: "r1", text: "A", given: "a card", when: "I pay", then: "it works" },
      "e1",
      NOW
    )!;
    m = withExample(m, { ruleId: "r2", text: "Just a line" }, "e2", NOW)!;
    return m;
  };

  it("appends each rule once as a criteria line, and each structured example once", () => {
    const plan = storyWritePlan(story({ acceptanceCriteria: "- rule 1." }), mapped());
    if (!plan.ok) throw new Error(plan.problem);
    expect(plan.rules).toBe(1);
    expect(plan.next.acceptanceCriteria).toBe("- rule 1.\n- Rule 2");
    expect(plan.examples).toBe(1);
    expect(plan.next.gwt?.[0]).toMatchObject({ given: "a card", when: "I pay", then: "it works" });
    const again = storyWritePlan(plan.next, mapped());
    expect(again.ok && again.unchanged).toBe(true);
  });

  it("refuses criteria past 2,000 characters", () => {
    const plan = storyWritePlan(
      story({ acceptanceCriteria: "x".repeat(STORY_CRITERIA_MAX - 3) }),
      mapped()
    );
    expect(plan.ok).toBe(false);
  });

  it("lists the examples past the story's 20 scenarios as not sent", () => {
    const gwt = Array.from({ length: STORY_GWT_MAX }, (_, i) => ({
      id: `g${i}`,
      given: `g${i}`,
      when: "w",
      then: "t",
    }));
    const plan = storyWritePlan(story({ gwt }), mapped());
    expect(plan.ok && plan.notSent).toEqual(["e1"]);
  });

  it("compares rules by their words, list markers and a closing stop aside", () => {
    expect(sameKey("- An expired card is refused.")).toBe(sameKey("an expired card is refused"));
  });
});

describe("forms", () => {
  it("needs a story picked or typed, within 200", () => {
    expect(validateMapDraft({ title: "", storyId: "" }).ok).toBe(false);
    expect(validateMapDraft({ title: "", storyId: "st1" })).toEqual({
      ok: true,
      values: { title: "", storyId: "st1" },
    });
    expect(validateMapDraft({ title: "x".repeat(201), storyId: "" }).ok).toBe(false);
  });

  it("needs a card's words, within 200, and an answer within 1,000", () => {
    expect(validateCardText("  ", "rule").ok).toBe(false);
    expect(validateCardText("x".repeat(201), "rule").ok).toBe(false);
    expect(validateCardText(" A rule ", "rule")).toEqual({ ok: true, values: { text: "A rule" } });
    expect(validateAnswerDraft({ answer: "" }).ok).toBe(false);
    expect(validateAnswerDraft({ answer: "x".repeat(1001) }).ok).toBe(false);
  });
});
