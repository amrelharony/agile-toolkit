import { describe, expect, it } from "vitest";
import {
  CHARTER_TEMPLATE_IDS,
  CHARTER_TEMPLATE_MAX,
  type CharterRule,
  type WorkingAgreement,
} from "@/lib/stores/workspace-types";
import {
  RULE_DESCRIPTION_MAX,
  RULE_TEXT_MAX,
  emptyAgreement,
  normalizeAgreement,
  withConsent,
  withRuleText,
} from "@/lib/working-agreement/model";
import {
  CHARTER_TEMPLATES,
  TEMPLATE_RULES_MAX,
  applyTemplate,
  coreHoursFor,
  coreHoursFromTeamTime,
  levelLine,
  normalizeTemplates,
  previewTemplate,
  revertTemplate,
  templateDefaults,
  templateRules,
  templatesSummary,
  validateTemplate,
  type AiUseValues,
  type CoreHoursValues,
  type UrgencyLadderValues,
} from "@/lib/working-agreement/templates";
import { agreementMarkdown } from "@/app/(tools)/working-agreement/markdown";
import { AT, london, newYork, tokyo } from "../team-time/fixtures";

/**
 * The Working Agreement's charter templates: what each writes (in our own
 * words), the caps, at most eight rules for all four, applying again by
 * slot, skipping a rule already in the charter, reading stored answers back
 * and a hand edit detaching a rule.
 */

const NOW = "2026-11-16T10:00:00.000Z";
const ids = () => {
  let n = 0;
  return () => `r${++n}`;
};
const doc = (
  rules: CharterRule[] = [],
  extra: Partial<WorkingAgreement> = {}
): WorkingAgreement => ({
  ...emptyAgreement(),
  rules,
  ...extra,
});
const rule = (id: string, text: string, extra: Partial<CharterRule> = {}): CharterRule => ({
  id,
  category: "other",
  text,
  agreedBy: [],
  consent: [],
  ...extra,
});
const ok = <V>(r: { ok: true; values: V } | { ok: false; errors: unknown }): V => {
  if (!r.ok) throw new Error(`expected valid values, got ${JSON.stringify(r.errors)}`);
  return r.values;
};

const ladder = (): UrgencyLadderValues => templateDefaults("urgency-ladder");
const core = (over: Partial<CoreHoursValues> = {}): CoreHoursValues => ({
  ...templateDefaults("core-hours", { timeZone: "UTC" }),
  ...over,
});
const ai = (over: Partial<AiUseValues> = {}): AiUseValues => ({
  ...templateDefaults("ai-use"),
  ...over,
});

describe("the four templates", () => {
  it("are the four ids, writing eight rules at most in all and three at most each", () => {
    expect(CHARTER_TEMPLATES.map((t) => t.id)).toEqual([...CHARTER_TEMPLATE_IDS]);
    expect(TEMPLATE_RULES_MAX).toBe(8);
    for (const t of CHARTER_TEMPLATES) expect(t.slots.length).toBeLessThanOrEqual(3);
  });

  it("start from defaults that check out", () => {
    for (const id of CHARTER_TEMPLATE_IDS) {
      expect(validateTemplate(id, templateDefaults(id, { timeZone: "UTC" })).ok, id).toBe(true);
    }
    expect(templateDefaults("core-hours", { timeZone: "Mars/Base" }).timeZone).toBe("UTC");
  });

  it("write the urgency ladder as one rule with its levels, and the after-hours line", () => {
    const rules = templateRules("urgency-ladder", ladder());
    expect(rules.map((r) => [r.slot, r.category])).toEqual([
      ["ladder", "communication"],
      ["after-hours", "communication"],
    ]);
    expect(rules[0].text).toBe(
      "We use the urgency ladder to choose how to reach each other and how fast to answer."
    );
    expect(rules[0].description?.split("\n")).toEqual([
      "Emergency: Production is down or customers are blocked. Phone or page the on-call. 15 minutes, any time.",
      "Urgent today: It blocks someone's work today. Direct message. 2 working hours.",
      "Normal: Questions and reviews. A thread in the team channel. 1 working day.",
      "No rush: Updates and ideas. A thread or email. No reply needed.",
    ]);
    expect(rules[1].text).toBe("Outside someone's working hours, only Emergency can't wait.");
    expect(templateRules("urgency-ladder", { ...ladder(), afterHours: false })).toHaveLength(1);
  });

  it("write core hours with their zone and purposes, and the office days when there are some", () => {
    const rules = templateRules(
      "core-hours",
      core({
        anchorDays: [
          { site: "London office", days: [4] },
          { site: "Cairo", days: [1, 3] },
        ],
      })
    );
    expect(rules.map((r) => [r.slot, r.category, r.text])).toEqual([
      [
        "core",
        "meetings",
        "Our core hours are 13:00–15:00 UTC, Mon–Thu: we keep meetings and quick replies inside them.",
      ],
      ["anchor-days", "work", "In the office: London office on Thu; Cairo on Mon and Wed."],
    ]);
    expect(rules[0].description).toBe("Outside them we work in writing.");
    const tokyoTime = templateRules(
      "core-hours",
      core({ timeZone: "Asia/Tokyo", purposes: ["pairing"] })
    );
    expect(tokyoTime).toHaveLength(1);
    expect(tokyoTime[0].text).toContain("13:00–15:00 Tokyo time");
    expect(tokyoTime[0].text).toContain("we keep pairing inside them");
  });

  it("write focus time on each person's clock, naming the ladder's top levels", () => {
    const own = templateRules("focus-time", templateDefaults("focus-time"));
    expect(own).toEqual([
      {
        slot: "focus",
        category: "work",
        text: "Focus time is Tue and Thu, 09:00–12:00 on each person's own clock: no meetings, and messages wait unless they are urgent.",
      },
    ]);
    const shared = templateRules(
      "focus-time",
      { days: [1], start: "14:00", end: "16:00", timeZone: "UTC", weeklyMinHours: 6 },
      { ladder: ladder() }
    );
    expect(shared[0].text).toBe(
      "Focus time is Mon, 14:00–16:00 UTC: no meetings, and messages wait unless they are Emergency or Urgent today; each of us keeps at least 6 hours of it a week."
    );
  });

  it("write AI use as up to three rules, keeping the tools and prompts out of them", () => {
    const rules = templateRules(
      "ai-use",
      ai({ neverInOther: "Unreleased designs", tools: ["Copilot"], shareWhere: "The wiki" })
    );
    expect(rules.map((r) => r.slot)).toEqual(["never-in", "review", "customer-facing"]);
    expect(rules.every((r) => r.category === "work")).toBe(true);
    expect(rules[0].text).toBe("We never put these into an AI tool.");
    expect(rules[0].description).toBe(
      [
        "- Customer personal data",
        "- Passwords, keys and tokens",
        "- Confidential material",
        "- Unreleased designs",
      ].join("\n")
    );
    expect(rules[1].text).toBe(
      "We review AI-assisted work like any other work: we say when AI wrote a large part, and whoever ships it owns it."
    );
    expect(rules[2].text).toBe("A person reads anything customer-facing before it goes out.");
    expect(JSON.stringify(rules)).not.toMatch(/Copilot|wiki/);
    expect(
      templateRules("ai-use", ai({ review: "not-production", customerFacing: false }))
    ).toHaveLength(2);
  });

  it("fit every rule's caps at every template cap", () => {
    const long = (n: number, c = "界") => c.repeat(n);
    const levels = Array.from({ length: CHARTER_TEMPLATE_MAX.levels }, (_, i) => ({
      id: `l${i}`,
      label: `${i}${long(CHARTER_TEMPLATE_MAX.levelLabel - 1)}`,
      when: long(CHARTER_TEMPLATE_MAX.levelWhen),
      channel: long(CHARTER_TEMPLATE_MAX.levelChannel),
      replyWithin: long(CHARTER_TEMPLATE_MAX.levelReplyWithin),
    }));
    const big = ok(validateTemplate("urgency-ladder", { levels, afterHours: true }));
    const anchors = Array.from({ length: CHARTER_TEMPLATE_MAX.anchorDays }, (_, i) => ({
      site: `${i}${long(CHARTER_TEMPLATE_MAX.site - 1)}`,
      days: [0, 1, 2, 3, 4, 5, 6],
    }));
    const all = [
      ...templateRules("urgency-ladder", big),
      ...templateRules(
        "core-hours",
        core({ anchorDays: anchors, purposes: ["meetings", "quick-replies", "pairing"] })
      ),
      ...templateRules(
        "focus-time",
        { days: [0, 2, 4, 6], start: "09:00", end: "12:00", timeZone: "UTC", weeklyMinHours: 40 },
        { ladder: big }
      ),
      ...templateRules("ai-use", ai({ neverInOther: long(CHARTER_TEMPLATE_MAX.aiNote) })),
    ];
    expect(all).toHaveLength(8);
    for (const r of all) {
      expect(r.text.length).toBeLessThanOrEqual(RULE_TEXT_MAX);
      expect((r.description ?? "").length).toBeLessThanOrEqual(RULE_DESCRIPTION_MAX);
      expect(r.text.endsWith("…")).toBe(false);
      expect((r.description ?? "").endsWith("…")).toBe(false);
    }
    expect(levelLine(levels[0])).not.toMatch(/\.\./);
  });
});

describe("validateTemplate", () => {
  it("refuses a ladder of one level, an unnamed level and two of the same name", () => {
    const one = validateTemplate("urgency-ladder", { levels: [ladder().levels[0]] });
    expect(!one.ok && one.errors.levels).toMatch(/at least 2/);
    const bad = validateTemplate("urgency-ladder", {
      levels: [
        { ...ladder().levels[0], label: " " },
        { ...ladder().levels[1], label: "Normal" },
        { ...ladder().levels[2], label: "normal", replyWithin: "" },
      ],
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors["levels.0.label"]).toBe("Name the level.");
    expect(bad.errors["levels.2.label"]).toBe("Two levels have this name.");
    expect(bad.errors["levels.2.replyWithin"]).toBe("Say how fast a reply comes.");
    const tooMany = validateTemplate("urgency-ladder", {
      levels: Array.from({ length: 7 }, (_, i) => ({ ...ladder().levels[0], label: `L${i}` })),
    });
    expect(!tooMany.ok && tooMany.errors.levels).toMatch(/6 levels/);
  });

  it("checks core hours' times, zone, days, purposes and office days", () => {
    const bad = validateTemplate("core-hours", {
      start: "25:00",
      end: "10:00",
      timeZone: "Mars/Base",
      days: [],
      purposes: [],
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(Object.keys(bad.errors).sort()).toEqual(["days", "purposes", "start", "timeZone"]);
    const same = validateTemplate("core-hours", core({ start: "10:00", end: "10:00" }));
    expect(!same.ok && same.errors.end).toMatch(/another time/);
    const anchors = validateTemplate(
      "core-hours",
      core({
        anchorDays: Array.from({ length: 5 }, (_, i) => ({ site: `S${i}`, days: [1] })),
      })
    );
    expect(!anchors.ok && anchors.errors.anchorDays).toMatch(/4 offices/);
    const night = ok(
      validateTemplate("core-hours", core({ start: "22:00", end: "01:00", days: [5, 1, 1] }))
    );
    expect(night.days).toEqual([1, 5]);
  });

  it("stores a zone in its canonical spelling", () => {
    const v = ok(validateTemplate("core-hours", core({ timeZone: "utc" })));
    expect(v.timeZone).toBe("UTC");
  });

  it("takes focus time's weekly hours from 1 to 40, or none", () => {
    const base = templateDefaults("focus-time");
    expect(validateTemplate("focus-time", { ...base, weeklyMinHours: 0 }).ok).toBe(false);
    expect(validateTemplate("focus-time", { ...base, weeklyMinHours: 41 }).ok).toBe(false);
    expect(
      ok(validateTemplate("focus-time", { ...base, weeklyMinHours: "8" })).weeklyMinHours
    ).toBe(8);
    expect(ok(validateTemplate("focus-time", { ...base, weeklyMinHours: "" }))).not.toHaveProperty(
      "weeklyMinHours"
    );
    expect(validateTemplate("focus-time", { ...base, timeZone: "Mars/Base" }).ok).toBe(false);
  });

  it("needs AI use to name something that never goes in, and a review level", () => {
    const none = validateTemplate("ai-use", { ...ai(), neverIn: [], review: "sometimes" });
    expect(none.ok).toBe(false);
    if (none.ok) return;
    expect(none.errors.neverIn).toMatch(/at least one/);
    expect(none.errors.review).toMatch(/reviewed/);
    const other = ok(
      validateTemplate("ai-use", { ...ai(), neverIn: [], neverInOther: " Salaries " })
    );
    expect(other.neverInOther).toBe("Salaries");
    const tools = ok(
      validateTemplate("ai-use", { ...ai(), tools: ["Chat", " chat ", "", "Code"] })
    );
    expect(tools.tools).toEqual(["Chat", "Code"]);
    expect(validateTemplate("ai-use", { ...ai(), tools: ["a", "b", "c", "d", "e", "f"] }).ok).toBe(
      false
    );
  });
});

describe("applyTemplate", () => {
  it("adds the template's rules, marked with their slot, and keeps its answers", () => {
    const out = applyTemplate(doc([rule("x", "Kept")]), "urgency-ladder", ladder(), ids(), NOW);
    expect(out.added).toEqual(["r1", "r2"]);
    expect(out.updated).toEqual([]);
    expect(out.removed).toEqual([]);
    expect(out.ruleIds).toEqual(["r1", "r2"]);
    expect(out.doc.rules.map((r) => [r.id, r.template])).toEqual([
      ["x", undefined],
      ["r1", { id: "urgency-ladder", slot: "ladder" }],
      ["r2", { id: "urgency-ladder", slot: "after-hours" }],
    ]);
    expect(out.doc.rules[1]).toMatchObject({
      agreedBy: [],
      consent: [],
      category: "communication",
    });
    expect(out.doc.templates?.urgencyLadder).toEqual({ ...ladder(), appliedAt: NOW });
  });

  it("applied again, updates by slot in place, keeping the rule's id and consent", () => {
    const first = applyTemplate(doc(), "urgency-ladder", ladder(), ids(), NOW).doc;
    const agreed = {
      ...first,
      rules: first.rules.map((r) => (r.id === "r1" ? withConsent(r, "Ana", "consent", NOW) : r)),
    };
    const levels = ladder().levels.map((l, i) => (i === 0 ? { ...l, replyWithin: "1 hour" } : l));
    const again = applyTemplate(agreed, "urgency-ladder", { levels, afterHours: true }, ids(), NOW);
    expect(again.added).toEqual([]);
    expect(again.updated).toEqual(["r1"]);
    const ladderRule = again.doc.rules.find((r) => r.id === "r1");
    expect(ladderRule?.description).toContain(
      "Emergency: Production is down or customers are blocked. Phone or page the on-call. 1 hour."
    );
    expect(ladderRule?.agreedBy).toEqual(["Ana"]);
    // Nothing changed: nothing written but the answers.
    const same = applyTemplate(
      again.doc,
      "urgency-ladder",
      { levels, afterHours: true },
      ids(),
      NOW
    );
    expect([same.added, same.updated, same.removed]).toEqual([[], [], []]);
  });

  it("takes out a line it no longer writes, and adds a new one", () => {
    const first = applyTemplate(doc(), "urgency-ladder", ladder(), ids(), NOW).doc;
    const off = applyTemplate(
      first,
      "urgency-ladder",
      { ...ladder(), afterHours: false },
      ids(),
      NOW
    );
    expect(off.removed).toEqual(["r2"]);
    expect(off.doc.rules.map((r) => r.id)).toEqual(["r1"]);
    const on = applyTemplate(off.doc, "urgency-ladder", ladder(), () => "n1", NOW);
    expect(on.added).toEqual(["n1"]);
  });

  it("skips a line another rule already says, a Kickoff rule included, and reports it", () => {
    const kickoff = rule("k1", "A person reads anything customer-facing before it goes out", {
      sourceRef: { tool: "kickoff", id: "item-1", doc: "kick-1" },
    });
    const out = applyTemplate(doc([kickoff]), "ai-use", ai(), ids(), NOW);
    expect(out.skipped).toEqual([
      {
        slot: "customer-facing",
        text: "A person reads anything customer-facing before it goes out.",
        reason: "duplicate",
        ruleId: "k1",
      },
    ]);
    expect(out.added).toHaveLength(2);
    expect(out.doc.rules.filter((r) => /customer-facing/.test(r.text))).toHaveLength(1);
  });

  it("leaves a rule edited by hand alone: it is the team's own", () => {
    const first = applyTemplate(
      doc(),
      "focus-time",
      templateDefaults("focus-time"),
      ids(),
      NOW
    ).doc;
    const edited = {
      ...first,
      rules: first.rules.map((r) => withRuleText(r, "Focus time is Tuesday mornings.", undefined)),
    };
    expect(edited.rules[0].template).toBeUndefined();
    const again = applyTemplate(
      edited,
      "focus-time",
      templateDefaults("focus-time"),
      () => "n1",
      NOW
    );
    expect(again.doc.rules.find((r) => r.id === "r1")?.text).toBe(
      "Focus time is Tuesday mornings."
    );
    expect(again.added).toEqual(["n1"]);
  });

  it("writes at most eight rules for all four templates", () => {
    let d = doc();
    const next = ids();
    d = applyTemplate(d, "urgency-ladder", ladder(), next, NOW).doc;
    d = applyTemplate(
      d,
      "core-hours",
      core({ anchorDays: [{ site: "HQ", days: [2] }] }),
      next,
      NOW
    ).doc;
    d = applyTemplate(d, "focus-time", templateDefaults("focus-time"), next, NOW).doc;
    d = applyTemplate(d, "ai-use", ai(), next, NOW).doc;
    expect(d.rules).toHaveLength(8);
    expect(templatesSummary(d).map((t) => [t.id, t.applied, t.ruleIds.length])).toEqual([
      ["urgency-ladder", true, 2],
      ["core-hours", true, 2],
      ["focus-time", true, 1],
      ["ai-use", true, 3],
    ]);
    // Focus time named the charter's own ladder.
    expect(d.rules.find((r) => r.template?.slot === "focus")?.text).toContain(
      "Emergency or Urgent today"
    );
  });

  it("rewords focus time's rule when the ladder changes, and its Undo puts it back", () => {
    const focusValues = templateDefaults("focus-time");
    const focused = applyTemplate(doc(), "focus-time", focusValues, () => "f1", NOW);
    expect(focused.doc.rules[0].text).toContain("unless they are urgent.");
    const consented = {
      ...focused.doc,
      rules: [withConsent(focused.doc.rules[0], "Ann", "consent", NOW)],
    };
    // The ladder comes later: focus time now names its top two levels.
    const laddered = applyTemplate(consented, "urgency-ladder", ladder(), ids(), NOW);
    const f1 = laddered.doc.rules.find((r) => r.id === "f1");
    expect(f1?.text).toContain("unless they are Emergency or Urgent today");
    expect(f1?.template).toEqual({ id: "focus-time", slot: "focus" });
    expect(f1?.agreedBy).toEqual(["Ann"]);
    expect(laddered.updated).toEqual(["f1"]);
    expect(laddered.also).toEqual([{ ruleId: "f1", template: "focus-time", text: f1?.text }]);
    expect(laddered.ruleIds).toEqual(["r1", "r2"]);
    // Renamed levels follow too, and the preview says so.
    const renamed = ladder();
    renamed.levels[0] = { ...renamed.levels[0], label: "P1" };
    renamed.levels[1] = { ...renamed.levels[1], label: "P2" };
    const p = previewTemplate(laddered.doc, "urgency-ladder", renamed);
    expect(p.also.map((a) => a.text)).toEqual([
      expect.stringContaining("unless they are P1 or P2"),
    ]);
    const again = applyTemplate(laddered.doc, "urgency-ladder", renamed, ids(), NOW);
    expect(again.doc.rules.find((r) => r.id === "f1")?.text).toContain("unless they are P1 or P2");
    expect(again.updated).toEqual(["r1", "r2", "f1"]);
    // Undo of the first ladder: focus time says "urgent" again.
    const back = revertTemplate(laddered.doc, consented, "urgency-ladder", laddered);
    expect(back.rules).toEqual(consented.rules);
    // A focus rule edited by hand is the team's own: the ladder leaves it.
    const own = {
      ...consented,
      rules: [withRuleText(consented.rules[0], "Mornings are quiet", undefined)],
    };
    const left = applyTemplate(own, "urgency-ladder", ladder(), ids(), NOW);
    expect(left.also).toEqual([]);
    expect(left.doc.rules[0].text).toBe("Mornings are quiet");
  });

  it("previews without writing, and its Undo puts the charter back", () => {
    const start = doc([rule("x", "Kept")]);
    const p = previewTemplate(start, "core-hours", core());
    expect(p.added).toHaveLength(1);
    expect(p.rules[0].slot).toBe("core");
    expect(start.rules).toHaveLength(1);

    const first = applyTemplate(start, "urgency-ladder", ladder(), ids(), NOW);
    const changed = applyTemplate(
      first.doc,
      "urgency-ladder",
      { ...ladder(), afterHours: false },
      ids(),
      NOW
    );
    // A rule added by someone else since stays through the Undo.
    const since = { ...changed.doc, rules: [...changed.doc.rules, rule("y", "Later")] };
    const back = revertTemplate(since, first.doc, "urgency-ladder", changed);
    expect(back.rules.map((r) => r.id)).toEqual(["x", "r1", "r2", "y"]);
    expect(back.templates?.urgencyLadder?.afterHours).toBe(true);
    const none = revertTemplate(first.doc, start, "urgency-ladder", first);
    expect(none.rules.map((r) => r.id)).toEqual(["x"]);
    expect(none).not.toHaveProperty("templates");
  });
});

describe("reading templates back", () => {
  it("keeps usable answers, cut to the caps, and drops the rest", () => {
    const t = normalizeTemplates({
      urgencyLadder: {
        levels: [
          { id: "a", label: "x".repeat(60), when: "w", channel: "c", replyWithin: "r" },
          { label: "Second", when: "w", channel: "c", replyWithin: "r" },
        ],
        afterHours: "yes",
        appliedAt: NOW,
      },
      coreHours: {
        start: "13:00",
        end: "15:00",
        timeZone: "Mars/Base",
        days: [1],
        purposes: ["meetings"],
      },
      focusTime: { days: [9, 2], start: "09:00", end: "12:00", timeZone: null, weeklyMinHours: 99 },
      aiUse: {
        review: "closer-look",
        neverIn: ["secrets", "nope"],
        tools: ["A", "a", "B"],
        customerFacing: 1,
      },
    });
    expect(t?.urgencyLadder?.levels.map((l) => [l.id, l.label.length])).toEqual([
      ["a", CHARTER_TEMPLATE_MAX.levelLabel],
      ["level-2", 6],
    ]);
    expect(t?.urgencyLadder?.afterHours).toBe(false);
    expect(t?.coreHours).toBeUndefined();
    expect(t?.focusTime).toEqual({
      days: [2],
      start: "09:00",
      end: "12:00",
      timeZone: null,
      appliedAt: "",
    });
    expect(t?.aiUse).toEqual({
      tools: ["A", "B"],
      neverIn: ["secrets"],
      review: "closer-look",
      customerFacing: false,
      appliedAt: "",
    });
    expect(normalizeTemplates({ urgencyLadder: { levels: [] } })).toBeUndefined();
    expect(normalizeTemplates("nope")).toBeUndefined();
  });

  it("goes through normalizeAgreement, which keeps a rule's good template mark and drops a bad one", () => {
    const read = normalizeAgreement({
      id: "workingAgreement:current",
      rules: [
        rule("a", "One", { template: { id: "ai-use", slot: "review" } }),
        { ...rule("b", "Two"), template: { id: "nope", slot: "x" } },
        { ...rule("c", "Three"), template: { id: "focus-time", slot: "x".repeat(41) } },
      ],
      meta: { version: 0 },
      templates: {
        focusTime: { days: [2], start: "09:00", end: "12:00", timeZone: null, appliedAt: NOW },
      },
      extra: "kept",
    });
    expect(read.rules.map((r) => r.template)).toEqual([
      { id: "ai-use", slot: "review" },
      undefined,
      undefined,
    ]);
    expect(read.rules[1]).not.toHaveProperty("template");
    expect(read.templates?.focusTime?.appliedAt).toBe(NOW);
    expect((read as unknown as { extra: string }).extra).toBe("kept");
    expect(
      normalizeAgreement({ rules: [], meta: { version: 0 }, templates: {} })
    ).not.toHaveProperty("templates");
    expect(emptyAgreement()).toEqual({
      id: "workingAgreement:current",
      rules: [],
      meta: { version: 0 },
    });
  });
});

describe("withRuleText", () => {
  const marked = rule("a", "Old words", {
    template: { id: "core-hours", slot: "core" },
    sourceRef: { tool: "kickoff", id: "i1" },
    description: "Why",
  });

  it("detaches a rule edited by hand from its template, keeping where it came from", () => {
    const next = withRuleText(marked, "New words", undefined);
    expect(next).not.toHaveProperty("template");
    expect(next.sourceRef).toEqual({ tool: "kickoff", id: "i1" });
    expect(next.description).toBe("Why");
    const moved = withRuleText(marked, marked.text, undefined, "work");
    expect(moved.category).toBe("work");
    expect(moved).not.toHaveProperty("template");
    const described = withRuleText(marked, marked.text, " ");
    expect(described).not.toHaveProperty("description");
    expect(described).not.toHaveProperty("template");
  });

  it("gives the rule back as it is when nothing changed", () => {
    expect(withRuleText(marked, "Old words", "Why")).toBe(marked);
  });
});

describe("core hours on each person's clock", () => {
  it("shows each Team Time person's local hours and who they fall outside", () => {
    const r = coreHoursFor(
      { start: "14:00", end: "16:00", timeZone: "UTC", days: [1] },
      [london, newYork, tokyo],
      Date.parse(AT)
    );
    expect(r.day).toBe("2026-11-16");
    expect(r.people.map((p) => [p.id, p.start, p.end, p.dayShift, p.outside])).toEqual([
      ["london", "14:00", "16:00", 0, false],
      ["ny", "09:00", "11:00", 0, false],
      ["tokyo", "23:00", "01:00", 0, true],
    ]);
    expect(r.outside).toEqual(["Taro"]);
  });

  it("reads the next core day, its own clock changes counted", () => {
    // Sunday 29 March 2026 London moves to summer time; core hours on Mondays.
    const r = coreHoursFor(
      { start: "09:00", end: "10:00", timeZone: "Europe/London", days: [1] },
      [{ ...london, timeZone: "UTC", name: "Ute", id: "utc" }],
      Date.parse("2026-03-28T12:00:00Z")
    );
    expect(r.day).toBe("2026-03-30");
    expect(r.people[0]).toMatchObject({ start: "08:00", end: "09:00", outside: true });
  });

  it("fills core hours from Team Time: everyone's window, else all but one, naming who", () => {
    const two = coreHoursFromTeamTime([london, newYork], "UTC", Date.parse(AT));
    expect(two).toMatchObject({
      kind: "everyone",
      start: "14:00",
      end: "17:30",
      days: [1, 2, 3, 4, 5],
      timeZone: "UTC",
      leftOut: null,
    });
    const three = coreHoursFromTeamTime([london, newYork, tokyo], "UTC", Date.parse(AT));
    expect(three).toMatchObject({
      kind: "all-but-one",
      start: "14:00",
      end: "17:30",
      leftOut: "Taro",
    });
    const office = coreHoursFromTeamTime(
      [
        { ...london, site: "HQ", officeDays: [2, 4] },
        { ...london, id: "l2", name: "Lia", site: "HQ", officeDays: [4] },
      ],
      "UTC",
      Date.parse(AT)
    );
    expect(office.kind === "everyone" && office.anchorDays).toEqual([{ site: "HQ", days: [4] }]);
    expect(coreHoursFromTeamTime([], "UTC", Date.parse(AT))).toEqual({ kind: "no-people" });
  });

  it("lists an office name once: a site wins over a zone city of the same name", () => {
    // Two at the "London" site, two in London who name no site: both groups say "London".
    const fill = coreHoursFromTeamTime(
      [
        { ...london, id: "z1", name: "Zed", officeDays: [1] },
        { ...london, id: "z2", name: "Zoe", officeDays: [1] },
        { ...london, id: "s1", name: "Sia", site: "London", officeDays: [3] },
        { ...london, id: "s2", name: "Sol", site: "London", officeDays: [3] },
      ],
      "UTC",
      Date.parse(AT)
    );
    const anchors = fill.kind === "everyone" ? fill.anchorDays : [];
    expect(anchors).toEqual([{ site: "London", days: [3] }]);
    // So the filled answers check out, and Apply isn't stopped by a hidden error.
    expect(validateTemplate("core-hours", core({ anchorDays: anchors })).ok).toBe(true);
  });
});

describe("the Markdown", () => {
  it("adds the urgency ladder as a table and AI use's tools, and nothing for a charter without templates", () => {
    const plain = doc([rule("a", "Be kind")]);
    const before = agreementMarkdown(plain, []);
    expect(before).not.toMatch(/Urgency ladder|AI use/);
    let d = applyTemplate(plain, "urgency-ladder", ladder(), ids(), NOW).doc;
    d = applyTemplate(
      d,
      "ai-use",
      ai({ tools: ["Chat | Pro"], shareWhere: "The wiki" }),
      ids(),
      NOW
    ).doc;
    const md = agreementMarkdown(d, []);
    expect(md).toContain("## Urgency ladder");
    expect(md).toContain("| Level | When | Where | Reply within |");
    expect(md).toContain(
      "| Emergency | Production is down or customers are blocked | Phone or page the on-call | 15 minutes, any time |"
    );
    expect(md).toContain("## AI use");
    expect(md).toContain("- Tools we use: Chat | Pro");
    expect(md).toContain("- Where we share prompts: The wiki");
  });
});
