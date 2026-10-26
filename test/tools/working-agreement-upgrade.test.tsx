import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  CharterCheckIn,
  CharterRule,
  TeamMember,
  WorkingAgreement,
} from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import {
  CHECK_IN_CAP,
  VERSION_CAP,
  WA_ID,
  agreementConsent,
  agreementVerdict,
  checkInAdherence,
  checkInTrend,
  consentLine,
  consentOf,
  dayLabel,
  diffVersions,
  draftCheckIn,
  canPublish,
  emptyAgreement,
  hasUnpublishedChanges,
  needsSnapshot,
  normalizeAgreement,
  notWorkingStreak,
  published,
  snapshotOf,
  trendSentence,
  withCheckIn,
  withConsent,
} from "@/lib/working-agreement/model";

/**
 * Working Agreement, upgraded: consent per roster member (agreedBy derived
 * from it), dated check-in rounds kept with a trend, Publish keeping a
 * numbered snapshot and a diff between versions, Undo on every delete,
 * draft-then-save adds, an in-memory example and the Markdown export.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
// Recharts has nothing to measure in jsdom; the chart's text is tested directly.
vi.mock("@/app/(tools)/working-agreement/charts", () => ({ AdherenceChart: () => null }));

import { WorkingAgreementClient } from "@/app/(tools)/working-agreement/working-agreement-client";
import { buildExample } from "@/app/(tools)/working-agreement/example";
import { agreementMarkdown } from "@/app/(tools)/working-agreement/markdown";
import { validateCheckIn, validateRule, EMPTY_RULE } from "@/app/(tools)/working-agreement/form";
import { adherenceChartText, adherencePoints } from "@/app/(tools)/working-agreement/trend";

/* ── Fixtures ───────────────────────────────────────────────────────── */

const TODAY = "2026-10-22";
const PUBLISHED = "2026-09-12T10:00:00.000Z";

const rule = (id: string, text: string, extra: Partial<CharterRule> = {}): CharterRule => ({
  id,
  category: "work",
  text,
  agreedBy: [],
  ...extra,
});
const round = (
  id: string,
  date: string,
  results: CharterCheckIn["results"],
  version = 1
): CharterCheckIn => ({ id, date, version, results });

const ROSTER: TeamMember[] = [
  { id: "m1", name: "Ann" },
  { id: "m2", name: "Sam" },
];

const ws = () => useWorkspaceStore.getState();
const stored = () => normalizeAgreement((ws().workingAgreements ?? []).find((d) => d.id === WA_ID));
const seed = (doc: Partial<WorkingAgreement> | null, roster: TeamMember[] = ROSTER) =>
  useWorkspaceStore.setState({
    workingAgreements: doc ? [{ ...emptyAgreement(), ...doc } as WorkingAgreement] : [],
    teamMembers: roster,
    sprints: [],
    retroBoards: [],
  });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <WorkingAgreementClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

/** Click Undo on the newest toast. */
const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 22, 9, 0, 0));
  toastSpy.mockReset();
  seed(null);
});

afterEach(() => {
  vi.useRealTimers();
  useWorkspaceStore.setState({
    workingAgreements: [],
    teamMembers: [],
    sprints: [],
    retroBoards: [],
  });
});

/* ── The model ──────────────────────────────────────────────────────── */

describe("reading a stored agreement", () => {
  it("reads an old agreement's agreedBy names as consent, without inventing anything else", () => {
    const doc = normalizeAgreement({
      id: WA_ID,
      rules: [
        { id: "r1", category: "work", text: "Pair on hard bugs", agreedBy: ["Ann", " ann "] },
      ],
      meta: { version: 1, publishedAt: PUBLISHED },
    });
    expect(doc.rules[0].consent).toEqual([{ name: "Ann", vote: "consent", at: "" }]);
    expect(doc.rules[0].agreedBy).toEqual(["Ann"]);
    expect(doc.checkIns).toEqual([]);
    expect(doc.versions).toEqual([]);
    expect(doc.meta).toEqual({ version: 1, publishedAt: PUBLISHED });
  });

  it("reads an agreement the old agent made at version 1, never published, as version 0", () => {
    const old = { id: WA_ID, rules: [rule("r1", "One")], meta: { version: 1 } };
    const doc = normalizeAgreement(old);
    expect(doc.meta).toEqual({ version: 0 });
    expect(agreementVerdict(doc, [])).toMatch(/^1 rule, not published yet;/);
    expect(published(doc, PUBLISHED).meta.version).toBe(1);
    // Read twice, it stays the same.
    expect(normalizeAgreement(doc)).toEqual(doc);
    // One the page published keeps its number, with or without snapshots.
    expect(
      normalizeAgreement({ ...old, meta: { version: 3, publishedAt: PUBLISHED } }).meta
    ).toEqual({ version: 3, publishedAt: PUBLISHED });
  });

  it("derives agreedBy from consent once consent is recorded", () => {
    const doc = normalizeAgreement({
      rules: [
        rule("r1", "x", {
          agreedBy: ["Stale"],
          consent: [
            { name: "Ann", vote: "consent", at: "t" },
            { name: "Sam", vote: "object", at: "t" },
          ],
        }),
      ],
      meta: { version: 0 },
    });
    expect(doc.rules[0].agreedBy).toEqual(["Ann"]);
  });

  it("survives garbage: no document, bad rules, unknown categories, broken rounds", () => {
    expect(normalizeAgreement(null)).toEqual(emptyAgreement());
    expect(normalizeAgreement("nope")).toEqual(emptyAgreement());
    const doc = normalizeAgreement({
      rules: [null, { id: "r1", text: "ok", category: "weird" }, { text: "no id" }],
      meta: { version: -3 },
      checkIns: [
        { id: "c2", date: "2026-10-01", version: 1, results: { r1: "working", r2: "maybe" } },
        { id: "c1", date: "2026-09-01T10:00:00Z", version: 1, results: {} },
        { id: "bad", date: "soon", results: {} },
      ],
      versions: [
        { version: 0, publishedAt: "x", rules: [] },
        { version: 2, publishedAt: "y" },
      ],
    });
    expect(doc.rules.map((r) => [r.id, r.category])).toEqual([["r1", "other"]]);
    expect(doc.meta.version).toBe(0);
    // Sorted by day, the stamp read as its day, unknown results dropped.
    expect(doc.checkIns?.map((c) => [c.id, c.date])).toEqual([
      ["c1", "2026-09-01"],
      ["c2", "2026-10-01"],
    ]);
    expect(doc.checkIns?.[1].results).toEqual({ r1: "working" });
    expect(doc.versions?.map((v) => v.version)).toEqual([2]);
  });

  it("starts a new agreement at version 0, unpublished", () => {
    expect(emptyAgreement()).toEqual({ id: WA_ID, rules: [], meta: { version: 0 } });
  });
});

describe("consent per person", () => {
  it("keeps one answer per person, replacing it in place, and clears it with null", () => {
    let r = rule("r1", "Core hours 10–15");
    r = withConsent(r, "Ann", "consent", "t1");
    r = withConsent(r, "Sam", "object", "t1", "  I start at 7 ");
    r = withConsent(r, " ann ", "concern", "t2", "Fridays?");
    expect(r.consent).toEqual([
      { name: "ann", vote: "concern", at: "t2", note: "Fridays?" },
      { name: "Sam", vote: "object", at: "t1", note: "I start at 7" },
    ]);
    expect(r.agreedBy).toEqual([]);
    r = withConsent(r, "Sam", null, "t3");
    expect(r.consent?.map((c) => c.name)).toEqual(["ann"]);
    // A blank name changes nothing; consent never keeps a note.
    expect(withConsent(r, "  ", "consent", "t4")).toBe(r);
    expect(withConsent(r, "Dev", "consent", "t4", "a note").consent?.at(-1)).toEqual({
      name: "Dev",
      vote: "consent",
      at: "t4",
    });
  });

  it("is full when everyone on the roster answered and nobody objects", () => {
    let r = withConsent(rule("r1", "x"), "Ann", "consent", "t");
    expect(consentOf(r, ROSTER)).toMatchObject({ missing: ["Sam"], full: false, of: 2 });
    r = withConsent(r, "sam", "concern", "t");
    const c = consentOf(r, ROSTER);
    expect(c).toMatchObject({ consented: ["Ann"], concerns: ["Sam"], missing: [], full: true });
    expect(consentLine(c)).toBe("2 of 2 consented · Sam has a concern");
    r = withConsent(r, "Sam", "object", "t");
    expect(consentOf(r, ROSTER).full).toBe(false);
    expect(consentLine(consentOf(r, ROSTER))).toBe("1 of 2 consented · Sam objects");
  });

  it("counts people off the roster who answered, and works with no roster at all", () => {
    const r = withConsent(rule("r1", "x"), "Guest", "consent", "t");
    expect(consentOf(r, ROSTER)).toMatchObject({ of: 3, missing: ["Ann", "Sam"], full: false });
    expect(consentOf(r, [])).toMatchObject({ of: 1, full: true });
    expect(consentLine(consentOf(rule("r2", "y"), []))).toBe("No answers yet");
    expect(consentLine(consentOf(rule("r2", "y"), ROSTER))).toBe("No answers yet (2 to ask)");
  });

  it("sums the charter: rules with everyone's consent, who is missing, what has an objection", () => {
    const a = withConsent(
      withConsent(rule("r1", "One"), "Ann", "consent", "t"),
      "Sam",
      "consent",
      "t"
    );
    const b = withConsent(rule("r2", "Two"), "Sam", "object", "t");
    expect(agreementConsent({ rules: [a, b] }, ROSTER)).toEqual({
      rules: 2,
      fullyConsented: 1,
      withObjection: 1,
      missingPeople: ["Ann"],
      objections: [{ ruleId: "r2", text: "Two", names: ["Sam"] }],
    });
  });
});

describe("check-in rounds", () => {
  const doc = (): WorkingAgreement => ({
    id: WA_ID,
    rules: [
      rule("r1", "One", { stillWorking: true }),
      rule("r2", "Two", { stillWorking: false }),
      rule("r3", "Three"),
    ],
    meta: { version: 2 },
  });

  it("saves the marked rules with their text and version, and refuses an empty round", () => {
    const c = draftCheckIn(doc(), { id: "c1", date: "2026-10-01T09:00:00Z", note: " ok " });
    expect(c).toEqual({
      id: "c1",
      date: "2026-10-01",
      version: 2,
      results: { r1: "working", r2: "not_working" },
      ruleTexts: { r1: "One", r2: "Two" },
      note: "ok",
    });
    expect(draftCheckIn({ ...doc(), rules: [rule("r1", "x")] }, { id: "c", date: TODAY })).toBe(
      null
    );
  });

  it("clears the marks it saved, keeps rounds in date order and only the latest 52", () => {
    const base = doc();
    const c = draftCheckIn(base, { id: "c1", date: "2026-10-01" })!;
    const saved = withCheckIn(
      { ...base, rules: [...base.rules, rule("r4", "Four", { stillWorking: true })] },
      {
        ...c,
        results: { r1: "working" },
      }
    );
    expect(saved.rules.map((r) => r.stillWorking)).toEqual([undefined, false, undefined, true]);
    const backdated = withCheckIn(saved, round("c0", "2026-09-01", { r1: "working" }));
    expect(backdated.checkIns?.map((x) => x.id)).toEqual(["c0", "c1"]);

    let many: WorkingAgreement = emptyAgreement();
    for (let i = 0; i < CHECK_IN_CAP + 5; i++) {
      many = withCheckIn(
        many,
        round(`c${i}`, `2025-01-${String((i % 28) + 1).padStart(2, "0")}`, { r1: "working" })
      );
    }
    expect(many.checkIns).toHaveLength(CHECK_IN_CAP);
  });

  it("reads each round's adherence, empty rounds as no percentage", () => {
    expect(checkInAdherence({ results: {} })).toEqual({ checked: 0, working: 0, pct: null });
    expect(checkInAdherence({ results: { a: "working", b: "working", c: "not_working" } })).toEqual(
      { checked: 3, working: 2, pct: 67 }
    );
  });

  it("counts a rule's not-working streak, skipping rounds that skipped it", () => {
    const d = {
      checkIns: [
        round("c1", "2026-08-01", { r1: "not_working" }),
        round("c2", "2026-08-15", { r1: "working" }),
        round("c3", "2026-09-01", { r1: "not_working" }),
        round("c4", "2026-09-15", { r2: "working" }),
        round("c5", "2026-10-01", { r1: "not_working" }),
      ],
    };
    expect(notWorkingStreak(d, "r1")).toBe(2);
    expect(notWorkingStreak(d, "r2")).toBe(0);
    expect(notWorkingStreak({ checkIns: [] }, "r1")).toBe(0);
  });

  it("says how adherence moved once there are two rounds", () => {
    const one = checkInTrend({
      checkIns: [round("c1", "2026-09-03", { a: "working", b: "not_working" })],
    });
    expect(trendSentence(one)).toBe(null);
    const rows = checkInTrend({
      checkIns: [
        round("c1", "2026-09-03", { a: "working", b: "not_working" }),
        round("c2", "2026-10-01", { a: "working", b: "working" }),
      ],
    });
    expect(trendSentence(rows)).toBe(
      `Adherence rose from 50% to 100% over 2 check-ins (${dayLabel("2026-09-03")} to ${dayLabel("2026-10-01")}).`
    );
    const text = adherenceChartText(rows, () => "Sprint 9");
    expect(text.table.rows[0]).toEqual([
      dayLabel("2026-09-03", true),
      "v1",
      "Sprint 9",
      "1 of 2",
      "50%",
    ]);
    expect(adherencePoints(rows).map((p) => p.pct)).toEqual([50, 100]);
  });

  it("checks a round's day and that something is marked", () => {
    expect(validateCheckIn({ date: "", sprintId: "", note: "" }, 1, TODAY)).toMatchObject({
      ok: false,
      errors: { date: "Pick the day the team checked in." },
    });
    expect(validateCheckIn({ date: "2026-10-23", sprintId: "", note: "" }, 1, TODAY)).toMatchObject(
      { ok: false, errors: { date: "Pick today or an earlier day." } }
    );
    expect(validateCheckIn({ date: TODAY, sprintId: "", note: "" }, 0, TODAY)).toMatchObject({
      ok: false,
      errors: { rules: "Mark at least one rule Working or Not working first." },
    });
    expect(validateCheckIn({ date: "2026-01-02", sprintId: "s1", note: " n " }, 2, TODAY)).toEqual({
      ok: true,
      values: { date: "2026-01-02", sprintId: "s1", note: "n" },
    });
  });
});

describe("published versions", () => {
  const base: WorkingAgreement = {
    id: WA_ID,
    rules: [rule("r1", "One"), rule("r2", "Two", { category: "meetings" })],
    meta: { version: 0, teamName: "Team" },
  };

  it("publishes a numbered snapshot and has nothing new to publish until something changes", () => {
    expect(hasUnpublishedChanges(emptyAgreement())).toBe(false);
    expect(hasUnpublishedChanges(base)).toBe(true);
    const v1 = published(base, "2026-10-01T10:00:00.000Z");
    expect(v1.meta).toEqual({
      version: 1,
      teamName: "Team",
      publishedAt: "2026-10-01T10:00:00.000Z",
    });
    expect(v1.versions?.[0]).toEqual(snapshotOf(base, "2026-10-01T10:00:00.000Z"));
    expect(hasUnpublishedChanges(v1)).toBe(false);
    expect(hasUnpublishedChanges({ ...v1, meta: { ...v1.meta, teamName: "Squad" } })).toBe(true);
    expect(hasUnpublishedChanges({ ...v1, rules: [...v1.rules].reverse() })).toBe(true);
  });

  it("lets a charter published before versions were kept publish once, without claiming changes", () => {
    const old: WorkingAgreement = { ...base, meta: { version: 3, publishedAt: PUBLISHED } };
    expect(needsSnapshot(old)).toBe(true);
    expect(hasUnpublishedChanges(old)).toBe(false);
    expect(canPublish(old)).toBe(true);
    const verdict = agreementVerdict(old, []);
    expect(verdict).toContain(
      `2 rules in v3 (published ${dayLabel(PUBLISHED)}, before versions were kept: publish once to keep a snapshot)`
    );
    expect(verdict).not.toContain("changes not yet published");
    const v4 = published(old, "2026-10-01T10:00:00.000Z");
    expect(v4.meta.version).toBe(4);
    expect(needsSnapshot(v4)).toBe(false);
    expect(canPublish(v4)).toBe(false);
    // Nothing to publish without rules.
    expect(canPublish({ ...old, rules: [] })).toBe(false);
  });

  it("keeps the latest 20 versions", () => {
    let doc = base;
    for (let i = 0; i < VERSION_CAP + 3; i++) {
      doc = published(
        { ...doc, rules: [rule(`r${i}`, `Rule ${i}`)] },
        `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`
      );
    }
    expect(doc.versions).toHaveLength(VERSION_CAP);
    expect(doc.meta.version).toBe(VERSION_CAP + 3);
    expect(doc.versions?.at(-1)?.version).toBe(VERSION_CAP + 3);
  });

  it("diffs two versions by rule id: added, removed, reworded, moved, described", () => {
    const before = [
      { id: "a", category: "work" as const, text: "Keep" },
      { id: "b", category: "work" as const, text: "Old words" },
      { id: "c", category: "work" as const, text: "Gone" },
      { id: "d", category: "work" as const, text: "Moves" },
      { id: "e", category: "work" as const, text: "Same", description: "x" },
    ];
    const after = [
      { id: "a", category: "work" as const, text: "Keep" },
      { id: "b", category: "work" as const, text: "New words" },
      { id: "d", category: "meetings" as const, text: "Moves" },
      { id: "e", category: "work" as const, text: "Same", description: "y" },
      { id: "f", category: "other" as const, text: "Fresh" },
    ];
    const d = diffVersions(before, after);
    expect(d.added.map((r) => r.id)).toEqual(["f"]);
    expect(d.removed.map((r) => r.id)).toEqual(["c"]);
    expect(d.reworded.map((c) => [c.before.text, c.after.text])).toEqual([
      ["Old words", "New words"],
    ]);
    expect(d.recategorised.map((c) => c.after.id)).toEqual(["d"]);
    expect(d.redescribed.map((c) => c.after.id)).toEqual(["e"]);
    expect(diffVersions(undefined, after).added).toHaveLength(5);
  });
});

describe("the verdict", () => {
  it("names the version, consent with who objects, and the last check-in", () => {
    const ex = buildExample(TODAY);
    expect(agreementVerdict(normalizeAgreement(ex.doc), ex.roster)).toBe(
      `6 rules in v2 (published ${dayLabel("2026-09-17")}), with changes not yet published; 4 have everyone's consent, Sam objects to “Cameras on for retros and 1:1s, optional otherwise”; the last check-in (${dayLabel("2026-10-15")}) found 4 of 5 working.`
    );
    expect(agreementVerdict(emptyAgreement(), ROSTER)).toBe("No rules agreed yet.");
    expect(agreementVerdict({ ...emptyAgreement(), rules: [rule("r1", "x")] }, ROSTER)).toBe(
      "1 rule, not published yet; nobody has given consent yet."
    );
  });
});

describe("the add form", () => {
  it("needs words and refuses a rule the charter already holds", () => {
    expect(validateRule(EMPTY_RULE, [])).toEqual({
      ok: false,
      errors: { text: "Say what the team agrees to." },
    });
    expect(
      validateRule({ ...EMPTY_RULE, text: "pairs on hard bugs." }, [{ text: "Pairs on hard bugs" }])
    ).toMatchObject({ ok: false, errors: { text: "That rule is already in the charter." } });
    expect(validateRule({ ...EMPTY_RULE, text: " Core\nhours ", description: " " }, [])).toEqual({
      ok: true,
      values: { category: "communication", text: "Core hours" },
    });
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("the page", () => {
  it("starts empty with an example that never reaches the workspace", () => {
    renderPage();
    expect(screen.getByText(/No rules yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(screen.getByText(/6 rules in v2/, { selector: "p" })).toBeInTheDocument();
    expect(ws().workingAgreements).toEqual([]);
    // Edits stay in memory too.
    fireEvent.click(screen.getAllByRole("button", { name: /^Delete “/ })[0]);
    expect(ws().workingAgreements).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByText(/No rules yet/)).toBeInTheDocument();
  });

  it("refuses a blank rule with an inline error, then saves a real one", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(screen.getByText("Say what the team agrees to.")).toBeInTheDocument();
    expect(ws().workingAgreements).toEqual([]);
    const input = screen.getByLabelText(/^Rule/);
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "Core hours 10–15" } });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(stored().rules).toMatchObject([
      { text: "Core hours 10–15", category: "communication", agreedBy: [], consent: [] },
    ]);
    expect(stored().meta.version).toBe(0);
  });

  it("keeps a rule when its text is emptied in place, and deletes it with Undo", () => {
    seed({ rules: [rule("r1", "One"), rule("r2", "Two"), rule("r3", "Three")] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Two/ }));
    const editor = screen.getByLabelText("Rule text");
    fireEvent.change(editor, { target: { value: "   " } });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(stored().rules.map((r) => r.text)).toEqual(["One", "Two", "Three"]);

    fireEvent.click(screen.getByRole("button", { name: "Delete “Two”" }));
    expect(stored().rules.map((r) => r.id)).toEqual(["r1", "r3"]);
    undoLast();
    expect(stored().rules.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("asks everyone on the roster, and agreedBy follows their consent", () => {
    seed({ rules: [rule("r1", "Cameras on")] });
    renderPage();
    const ann = screen.getByRole("radiogroup", { name: "Ann's answer to “Cameras on”" });
    fireEvent.click(within(ann).getByRole("radio", { name: "Consent" }));
    const sam = screen.getByRole("radiogroup", { name: "Sam's answer to “Cameras on”" });
    fireEvent.click(within(sam).getByRole("radio", { name: "Object" }));
    expect(stored().rules[0].agreedBy).toEqual(["Ann"]);
    expect(stored().rules[0].consent?.map((c) => [c.name, c.vote])).toEqual([
      ["Ann", "consent"],
      ["Sam", "object"],
    ]);
    expect(screen.getByText("1 of 2 consented · Sam objects")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Sam's note on “Cameras on”"), {
      target: { value: "Shared room" },
    });
    fireEvent.blur(screen.getByLabelText("Sam's note on “Cameras on”"));
    expect(stored().rules[0].consent?.[1]).toMatchObject({ vote: "object", note: "Shared room" });
  });

  it("reads an old agreement's names as consent from the roster", () => {
    seed({ rules: [rule("r1", "Core hours", { agreedBy: ["ann", "Sam"] })], meta: { version: 1 } });
    renderPage();
    expect(screen.getByText("2 of 2 consented")).toBeInTheDocument();
    // Nothing is written until someone edits.
    expect(ws().workingAgreements?.[0].rules[0].consent).toBeUndefined();
  });

  it("saves a backdated round, clears its marks, and Undo puts them back", () => {
    seed({
      rules: [rule("r1", "One"), rule("r2", "Two")],
      meta: { version: 1, publishedAt: PUBLISHED },
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Save check-in round" }));
    expect(
      screen.getByText("Mark at least one rule Working or Not working first.")
    ).toBeInTheDocument();
    const one = screen.getByRole("radiogroup", { name: "This round: “One”" });
    fireEvent.click(within(one).getByRole("radio", { name: "Working" }));
    const two = screen.getByRole("radiogroup", { name: "This round: “Two”" });
    fireEvent.click(within(two).getByRole("radio", { name: "Not working" }));
    expect(screen.getByText("2 of 2 rules marked in this round.")).toBeInTheDocument();

    const day = screen.getByLabelText(/^Day of the check-in/);
    fireEvent.change(day, { target: { value: "2026-10-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save check-in round" }));
    expect(screen.getByText("Pick today or an earlier day.")).toBeInTheDocument();
    fireEvent.change(day, { target: { value: "2026-10-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save check-in round" }));

    const saved = stored();
    expect(saved.checkIns).toHaveLength(1);
    expect(saved.checkIns?.[0]).toMatchObject({
      date: "2026-10-15",
      version: 1,
      results: { r1: "working", r2: "not_working" },
    });
    expect(saved.rules.map((r) => r.stillWorking)).toEqual([undefined, undefined]);
    expect(screen.getByText(/1 of 2 working/, { selector: "span" })).toBeInTheDocument();

    undoLast();
    expect(stored().checkIns).toEqual([]);
    expect(stored().rules.map((r) => r.stillWorking)).toEqual([true, false]);
  });

  it("deletes a saved round with Undo", () => {
    seed({
      rules: [rule("r1", "One")],
      checkIns: [
        round("c1", "2026-09-01", { r1: "working" }),
        round("c2", "2026-10-01", { r1: "not_working" }),
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Delete the check-in of 1 Sep/ }));
    expect(stored().checkIns?.map((c) => c.id)).toEqual(["c2"]);
    undoLast();
    expect(stored().checkIns?.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("publishes v1 once, shows the changes since, and Undo takes the publish back", () => {
    seed({ rules: [rule("r1", "One")] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Publish v1" }));
    expect(stored().meta.version).toBe(1);
    expect(stored().versions?.map((v) => v.version)).toEqual([1]);
    expect(screen.getByRole("button", { name: "Publish v2" })).toBeDisabled();
    expect(screen.getByText("Nothing changed since v1.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^One/ }));
    const editor = screen.getByLabelText("Rule text");
    fireEvent.change(editor, { target: { value: "One, reworded" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Publish v2" })).toBeEnabled();
    const changes = screen.getByRole("list", { name: "Changes since v1" });
    expect(changes).toHaveTextContent("Reworded: One → One, reworded");

    fireEvent.click(screen.getByRole("button", { name: "Publish v2" }));
    expect(stored().meta.version).toBe(2);
    undoLast();
    expect(stored().meta.version).toBe(1);
    expect(stored().versions?.map((v) => v.version)).toEqual([1]);
  });

  it("exports the charter as Markdown", () => {
    const ex = buildExample(TODAY);
    const md = agreementMarkdown(normalizeAgreement(ex.doc), ex.roster, {
      sprintName: (id) => (id ? ex.sprintNames[id] : undefined),
    });
    expect(md).toContain("# Checkout squad working agreement");
    expect(md).toContain("## Meetings");
    expect(md).toContain(
      "- Cameras on for retros and 1:1s, optional otherwise — 4 of 5 consented · Sam objects"
    );
    expect(md).toContain("| Date | Version | Sprint | Working | Adherence |");
    expect(md).toContain("| v2 | Sprint 14 | 4 of 5 | 80% |");
    expect(md).toContain("## Changes since v2");
    expect(md).toContain("- Added: Blameless write-up within two days of an incident");
    expect(agreementMarkdown(emptyAgreement(), [])).toContain("No rules agreed yet.");
  });

  it("keeps every example row on example- ids", () => {
    const ex = buildExample(TODAY);
    expect(ex.doc.rules.every((r) => isExampleId(r.id))).toBe(true);
    expect((ex.doc.checkIns ?? []).every((c) => isExampleId(c.id))).toBe(true);
    expect(ex.roster.every((m) => isExampleId(m.id))).toBe(true);
  });
});

describe("the page, after review", () => {
  let frames: FrameRequestCallback[] = [];
  beforeAll(() => {
    // Radix Select calls these; jsdom doesn't implement them.
    Element.prototype.scrollIntoView = () => {};
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
  });
  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  });
  afterEach(() => vi.unstubAllGlobals());
  /** Runs the frames focusSoon asked for, after React has rendered. */
  const nextFrame = () => act(() => frames.splice(0).forEach((f) => f(0)));

  it("says a charter published before versions were kept needs a snapshot, and publishes one", () => {
    seed({ rules: [rule("r1", "One")], meta: { version: 3, publishedAt: PUBLISHED } });
    renderPage();
    expect(screen.getByText("no snapshot kept yet")).toBeInTheDocument();
    expect(screen.queryByText(/changes not yet published/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publish v4" }));
    expect(stored().versions?.map((v) => v.version)).toEqual([4]);
    expect(screen.getByRole("button", { name: "Publish v5" })).toBeDisabled();
  });

  it("refuses to reword a rule in place into one the charter already has", () => {
    seed({ rules: [rule("r1", "One"), rule("r2", "Two")] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Two/ }));
    const editor = screen.getByLabelText("Rule text");
    fireEvent.change(editor, { target: { value: " one. " } });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(toastSpy.error).toHaveBeenCalledWith("“one.” is already in the charter.");
    expect(stored().rules.map((r) => r.text)).toEqual(["One", "Two"]);
  });

  it("moves focus to the next rule after a delete, then to the add form", () => {
    seed({ rules: [rule("r1", "One"), rule("r2", "Two")] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete “One”" }));
    nextFrame();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Two/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete “Two”" }));
    nextFrame();
    expect(document.activeElement).toBe(screen.getByLabelText(/^Rule/));
  });

  it("keeps focus on a rule's category after it moves to another section", () => {
    seed({ rules: [rule("r1", "One"), rule("r2", "Two")] });
    renderPage();
    const trigger = screen.getByRole("combobox", { name: "Category of “Two”" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Meetings" }));
    nextFrame();
    expect(stored().rules[1].category).toBe("meetings");
    expect(document.activeElement).toBe(
      within(screen.getByRole("region", { name: "Meetings" })).getByRole("combobox", {
        name: "Category of “Two”",
      })
    );
  });

  it("moves focus to the next saved round after a delete", () => {
    seed({
      rules: [rule("r1", "One")],
      checkIns: [
        round("c1", "2026-09-01", { r1: "working" }),
        round("c2", "2026-10-01", { r1: "not_working" }),
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Delete the check-in of 1 Oct/ }));
    nextFrame();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /^Delete the check-in of 1 Sep/ })
    );
  });

  it("puts a saved round's day back, saying why, when the edit is in the future or cleared", () => {
    seed({ rules: [rule("r1", "One")], checkIns: [round("c1", "2026-09-01", { r1: "working" })] });
    renderPage();
    const day = screen.getByLabelText(/^Day of the check-in of 1 Sep/);
    expect(day).toHaveAttribute("max", TODAY);
    fireEvent.change(day, { target: { value: "2026-11-30" } });
    fireEvent.blur(day);
    expect(screen.getByText("Pick today or an earlier day.")).toBeInTheDocument();
    expect(day).toHaveValue("2026-09-01");
    expect(day).toHaveAttribute("aria-invalid", "true");
    expect(stored().checkIns?.[0].date).toBe("2026-09-01");
    fireEvent.change(day, { target: { value: "" } });
    fireEvent.blur(day);
    expect(screen.getByText("Pick the day of the check-in.")).toBeInTheDocument();
    expect(day).toHaveValue("2026-09-01");
    fireEvent.change(day, { target: { value: "2026-09-03" } });
    fireEvent.blur(day);
    expect(stored().checkIns?.[0].date).toBe("2026-09-03");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("takes focus to the first rule's mark when a round is saved with nothing marked", () => {
    seed({ rules: [rule("r1", "One"), rule("r2", "Two")] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Save check-in round" }));
    const first = screen.getByRole("radiogroup", { name: "This round: “One”" });
    expect(document.activeElement).toBe(within(first).getByRole("radio", { name: "Not checked" }));
  });

  it("takes focus to the answer when someone else's answer is recorded without one", () => {
    seed({ rules: [rule("r1", "One")] }, []);
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Someone else/), { target: { value: "Zoe" } });
    fireEvent.click(screen.getByRole("button", { name: "Record answer" }));
    expect(screen.getByText("Pick their answer.")).toBeInTheDocument();
    const answer = screen.getByRole("radiogroup", { name: "Their answer" });
    expect(document.activeElement).toBe(within(answer).getByRole("radio", { name: "Consent" }));
  });

  it("counts what a reset clears in words that read right for one", () => {
    seed({
      rules: [rule("r1", "One")],
      checkIns: [round("c1", "2026-09-01", { r1: "working" })],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear the charter" }));
    expect(
      screen.getByText(
        "The one rule and everyone's answers to it, 1 saved check-in and 0 published versions."
      )
    ).toBeInTheDocument();
  });
});
