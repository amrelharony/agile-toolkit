import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isExampleId } from "@/components/tool-frame/example-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { SkillsMatrix, TeamMember } from "@/lib/stores/workspace-types";
import {
  CAPABLE_LEVEL,
  SKILLS_MATRIX_ID,
  coverageCounts,
  matrixColumns,
  normalizeSkillsMatrix,
  ratedCellsPct,
  ratingOf,
  realRoster,
  rekeyToRoster,
  rosterSkillsMissing,
  skillCoverage,
  skillsVerdict,
  suggestCrossTraining,
  targetPeopleError,
  trainingReached,
  withoutColumn,
  restoreColumn,
  withoutSkill,
  restoreSkill,
} from "@/lib/skills/coverage";
import { registry } from "@/lib/actions/registry";
import { detectBusFactorRisk } from "@/lib/analytics/anti-patterns";
import type { Workspace } from "@/lib/stores/workspace-types";

/**
 * Skills Matrix, upgraded: the Team page roster as its columns (legacy
 * people matched by name, the rest "not on the team"), a level picker with
 * Not rated apart from None, a single point of failure that is one person
 * at Intermediate or above, targets per skill, a cross-training plan,
 * Undo on deletes and a confirmed reset, an example in the page's memory,
 * a verdict, a Markdown export, and the agent reading the same numbers.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));

import { SkillsMatrixTool } from "@/app/(tools)/skills-matrix/skills-matrix-client";
import { buildExample } from "@/app/(tools)/skills-matrix/example";
import { skillsToMarkdown, coverageStatus } from "@/app/(tools)/skills-matrix/markdown";
import { EMPTY_SKILL, validateSkill } from "@/app/(tools)/skills-matrix/skill-form";
import { EMPTY_PAIR, validatePair } from "@/app/(tools)/skills-matrix/training";
import "@/lib/actions/tools/skills-matrix";

/* ── Fixtures ───────────────────────────────────────────────────────── */

const ANA: TeamMember = { id: "member_ana", name: "Ana", skills: ["Kubernetes", "Go"] };
const BO: TeamMember = { id: "member_bo", name: "Bo" };
const CHEN: TeamMember = { id: "member_chen", name: "Chen", skills: ["go", "SQL"] };
const ROSTER = [ANA, BO, CHEN];

const doc = (extra: Partial<SkillsMatrix> = {}): SkillsMatrix => ({
  id: SKILLS_MATRIX_ID,
  version: 2,
  members: [],
  skills: [
    { id: "k8s", name: "Kubernetes" },
    { id: "pay", name: "Payments" },
  ],
  grid: {},
  ...extra,
});

/** The matrix as tool.skills_matrix.reset leaves it, written by an older client. */
const LEGACY: SkillsMatrix = {
  id: SKILLS_MATRIX_ID,
  members: [
    { id: "m1", name: "ana " },
    { id: "m2", name: "Dee", description: "Contractor" },
  ],
  skills: [
    { id: "s1", name: "TypeScript" },
    { id: "s2", name: "React" },
  ],
  grid: { s1: { m1: 3, m2: 0 }, s2: { m1: 0, m2: 2 }, gone: { m1: 4 } },
};

const ws = () => useWorkspaceStore.getState();
const stored = () => ws().skillsMatrices?.find((d) => d.id === SKILLS_MATRIX_ID);
const seed = (matrix: SkillsMatrix | null, roster: TeamMember[] = ROSTER) =>
  useWorkspaceStore.setState({ skillsMatrices: matrix ? [matrix] : [], teamMembers: roster });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <SkillsMatrixTool />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

/** Click Undo on the newest toast. */
const undoLast = () => {
  const call = toastSpy.mock.calls.at(-1);
  const opts = call?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

/** Open a cell's level picker and pick a level ("2 Intermediate") or Clear. */
const pick = async (skill: string, person: string, option: string | "Clear") => {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${skill} · ${person}: `) }));
  const group = await screen.findByRole("radiogroup", { name: `${skill} · ${person}` });
  if (option === "Clear") {
    fireEvent.click(screen.getByRole("button", { name: `Clear ${skill} · ${person}` }));
  } else {
    fireEvent.click(within(group).getByRole("radio", { name: option }));
  }
  // The picker closes and hands focus back to its cell a tick later; a
  // second cell opened before that would see the focus move and close.
  await waitFor(() => expect(screen.queryByRole("radiogroup")).toBeNull());
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
};

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const run = <T,>(verb: string, params: Record<string, unknown> = {}) => {
  const action = registry.get(`tool.skills_matrix.${verb}`)!;
  return action.handler(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

beforeEach(() => {
  toastSpy.mockReset();
  toastSpy.error.mockReset();
  logs.length = 0;
  seed(null);
});

afterEach(() => {
  useWorkspaceStore.setState({ skillsMatrices: [], teamMembers: [] });
});

/* ── The rules (lib/skills/coverage) ────────────────────────────────── */

describe("columns come from the roster", () => {
  it("lists roster people, folds a legacy member in by name, and keeps the rest as not on the team", () => {
    const cols = matrixColumns(LEGACY, ROSTER);
    expect(cols.map((c) => [c.id, c.name, c.onRoster])).toEqual([
      ["member_ana", "Ana", true],
      ["member_bo", "Bo", true],
      ["member_chen", "Chen", true],
      ["m2", "Dee", false],
    ]);
    expect(cols[0].legacyIds).toEqual(["m1"]);
    // Ana reads the legacy member's rating until the next write re-keys it.
    expect(ratingOf(LEGACY, "s1", cols[0])).toBe(3);
  });

  it("leaves example people out of the real roster", () => {
    expect(
      realRoster([ANA, { id: "example-person-x", name: "X" }, { id: "y", name: " " }])
    ).toEqual([ANA]);
  });
});

describe("Not rated is not None", () => {
  it("reads a stored 0 on an older doc as Not rated, and on a version 2 doc as None", () => {
    expect(ratingOf(LEGACY, "s2", "m1")).toBeNull();
    expect(ratingOf({ ...LEGACY, version: 2 }, "s2", "m1")).toBe(0);
    expect(ratingOf(doc(), "k8s", "member_ana")).toBeNull();
  });

  it("clamps a stored level out of range instead of counting it raw", () => {
    const d = doc({ grid: { k8s: { member_ana: 7 as never, member_bo: -2 as never } } });
    expect(ratingOf(d, "k8s", "member_ana")).toBe(4);
    expect(ratingOf(d, "k8s", "member_bo")).toBe(0);
  });

  it("normalises an older doc once: its 0s dropped, orphan rows gone, version 2, idempotent", () => {
    const once = normalizeSkillsMatrix(LEGACY);
    expect(once.version).toBe(2);
    expect(once.grid).toEqual({ s1: { m1: 3 }, s2: { m2: 2 } });
    expect(once.training).toEqual([]);
    expect(normalizeSkillsMatrix(once)).toEqual(once);
    expect(normalizeSkillsMatrix(undefined)).toEqual({
      id: SKILLS_MATRIX_ID,
      members: [],
      skills: [],
      grid: {},
      version: 2,
    });
  });

  it("re-keys legacy members matched to the roster, keeping a roster rating, and runs twice safely", () => {
    const base = normalizeSkillsMatrix({
      ...LEGACY,
      grid: { s1: { m1: 3, member_ana: 1 }, s2: { m1: 2 } },
      training: [
        { id: "t", skillId: "s2", learnerId: "m2", mentorId: "m1", toLevel: 3, createdAt: "" },
      ],
    });
    const cols = matrixColumns(base, ROSTER);
    const once = rekeyToRoster(base, cols);
    expect(once.members.map((m) => m.id)).toEqual(["m2"]);
    expect(once.grid).toEqual({ s1: { member_ana: 1 }, s2: { member_ana: 2 } });
    expect(once.training?.[0]).toMatchObject({ learnerId: "m2", mentorId: "member_ana" });
    expect(rekeyToRoster(once, matrixColumns(once, ROSTER))).toEqual(once);
  });
});

describe("coverage per skill", () => {
  const cols = matrixColumns(doc(), ROSTER);

  it("calls one person at Intermediate a single point of failure, and nobody a gap", () => {
    const d = doc({ grid: { k8s: { member_ana: 2, member_bo: 1 }, pay: { member_ana: 1 } } });
    const [k8s, pay] = skillCoverage(d, cols, ROSTER);
    expect(k8s).toMatchObject({ capable: 1, spof: true, gap: false, holders: ["Ana"], unrated: 1 });
    expect(pay).toMatchObject({ capable: 0, gap: true, spof: false, unrated: 2 });
  });

  it("doesn't flag three Intermediates and an Advanced, and counts a target from its level", () => {
    const four = [...ROSTER, { id: "member_dee", name: "Dee" }];
    const d = doc({
      skills: [{ id: "k8s", name: "Kubernetes", targetPeople: 2, targetLevel: 3 }],
      grid: { k8s: { member_ana: 3, member_bo: 2, member_chen: 2, member_dee: 2 } },
    });
    const [c] = skillCoverage(d, matrixColumns(d, four), four);
    expect(c).toMatchObject({ capable: 4, spof: false, gap: false, atTarget: 1, target: 2 });
    expect(c.meetsTarget).toBe(false);
    expect(c.holders[0]).toBe("Ana");
    expect(coverageCounts([c])).toMatchObject({ belowTarget: 1, withTarget: 1, atTarget: 0 });
  });

  it("lists who names the skill on the Team page, by name key", () => {
    const [k8s] = skillCoverage(doc(), cols, ROSTER);
    expect(k8s.listedBy).toEqual(["member_ana"]);
    expect(rosterSkillsMissing(doc(), ROSTER)).toEqual(["Go", "SQL"]);
  });

  it("counts nothing at zero people or zero skills", () => {
    expect(skillCoverage(doc(), [], [])[0]).toMatchObject({ capable: 0, gap: true, unrated: 0 });
    expect(skillCoverage(doc({ skills: [] }), cols)).toEqual([]);
    expect(ratedCellsPct(doc(), [])).toBe(0);
  });
});

describe("targets", () => {
  it("allows no target, refuses a fraction, zero, too many for the team or the cap", () => {
    expect(targetPeopleError(null, 3)).toBeNull();
    expect(targetPeopleError(2, 3)).toBeNull();
    expect(targetPeopleError(0, 3)).toMatch(/1 or more/);
    expect(targetPeopleError(1.5, 3)).toMatch(/whole number/);
    expect(targetPeopleError(4, 3)).toBe("The team has 3 people.");
    expect(targetPeopleError(51, 0)).toMatch(/At most 50/);
    expect(targetPeopleError(5, 0)).toBeNull();
  });
});

describe("cross-training suggestions", () => {
  const cols = matrixColumns(doc(), ROSTER);

  it("pairs a SPOF's holder as mentor, a gap with outside help, highest learner first", () => {
    const d = doc({
      grid: {
        k8s: { member_ana: 3, member_bo: 1, member_chen: 0 },
        pay: { member_ana: 1, member_bo: 1 },
      },
    });
    const s = suggestCrossTraining(d, cols, skillCoverage(d, cols, ROSTER));
    // The gap comes first: two learners, nobody to learn from in the team.
    expect(s.slice(0, 2)).toEqual([
      { skillId: "pay", learnerId: "member_ana", toLevel: 2, from: 1, reason: "gap" },
      { skillId: "pay", learnerId: "member_bo", toLevel: 2, from: 1, reason: "gap" },
    ]);
    // Kubernetes needs one more capable person; Bo (Beginner) beats Chen (None).
    expect(s[2]).toEqual({
      skillId: "k8s",
      learnerId: "member_bo",
      mentorId: "member_ana",
      toLevel: CAPABLE_LEVEL,
      from: 1,
      reason: "spof",
    });
    expect(s).toHaveLength(3);
  });

  it("counts open pairs toward the skill and never suggests someone already learning it", () => {
    const d = doc({
      grid: { k8s: { member_ana: 3, member_bo: 1, member_chen: 1 } },
      skills: [{ id: "k8s", name: "Kubernetes" }],
      training: [{ id: "t1", skillId: "k8s", learnerId: "member_bo", toLevel: 2, createdAt: "" }],
    });
    expect(suggestCrossTraining(d, cols, skillCoverage(d, cols))).toEqual([]);
    const done = { ...d, training: [{ ...d.training![0], doneAt: "2026-10-01" }] };
    expect(suggestCrossTraining(done, cols, skillCoverage(done, cols))).toHaveLength(1);
  });

  it("says a pair has reached its level without ticking it", () => {
    const pair = {
      id: "t",
      skillId: "k8s",
      learnerId: "member_bo",
      toLevel: 2 as const,
      createdAt: "",
    };
    expect(trainingReached(doc({ grid: { k8s: { member_bo: 2 } } }), pair, cols)).toBe(true);
    expect(trainingReached(doc(), pair, cols)).toBe(false);
  });
});

describe("removing with Undo, in the lib", () => {
  it("takes a skill's ratings and pairs with it, and puts them back in place", () => {
    const d = doc({
      grid: { k8s: { member_ana: 3 } },
      training: [{ id: "t", skillId: "k8s", learnerId: "member_bo", toLevel: 2, createdAt: "" }],
    });
    const out = withoutSkill(d, "k8s")!;
    expect(out.doc.skills.map((s) => s.id)).toEqual(["pay"]);
    expect(out.doc.training).toEqual([]);
    expect(restoreSkill(out.doc, out.removed)).toEqual(d);
    expect(withoutSkill(d, "nope")).toBeNull();
  });

  it("removes only a matrix-only person, their mentoring going to outside help", () => {
    const d = normalizeSkillsMatrix({
      ...LEGACY,
      version: 2,
      training: [
        {
          id: "t",
          skillId: "s1",
          learnerId: "member_bo",
          mentorId: "m2",
          toLevel: 2,
          createdAt: "",
        },
      ],
    });
    const out = withoutColumn(d, "m2")!;
    expect(out.doc.members.map((m) => m.id)).toEqual(["m1"]);
    expect(out.doc.training?.[0].mentorId).toBeUndefined();
    expect(restoreColumn(out.doc, out.removed)).toEqual(d);
    expect(withoutColumn(d, "member_ana")).toBeNull();
  });
});

describe("the verdict", () => {
  it("names the empty cases", () => {
    expect(skillsVerdict([], [])).toMatch(/^No skills yet/);
    const c = skillCoverage(doc(), [], []);
    expect(skillsVerdict(c, [])).toMatch(/^Nobody to rate yet/);
    const cols = matrixColumns(doc(), ROSTER);
    expect(skillsVerdict(skillCoverage(doc(), cols), cols)).toBe(
      "Nobody is rated yet on 2 skills."
    );
  });

  it("names who each skill hangs on, the gaps and the targets met, so far", () => {
    const cols = matrixColumns(doc(), ROSTER);
    const d = doc({
      skills: [
        { id: "k8s", name: "Kubernetes", targetPeople: 2 },
        { id: "pay", name: "Payments" },
      ],
      grid: { k8s: { member_ana: 3, member_bo: 1, member_chen: 1 }, pay: { member_ana: 0 } },
    });
    expect(skillsVerdict(skillCoverage(d, cols), cols)).toBe(
      "1 skill depends on one person (Kubernetes: Ana); 1 skill has nobody at Intermediate or above; 0 of 1 skill meet their target; 2 ratings still missing."
    );
    const fine = doc({
      skills: [{ id: "k8s", name: "Kubernetes" }],
      grid: { k8s: { member_ana: 3, member_bo: 2, member_chen: 4 } },
    });
    expect(skillsVerdict(skillCoverage(fine, cols), cols)).toBe(
      "The skill has at least two people at Intermediate or above."
    );
  });
});

describe("the add form", () => {
  it("requires a name no other skill has, and keeps a target within the team", () => {
    const d = doc();
    expect(validateSkill(EMPTY_SKILL, d, 3)).toEqual({
      ok: false,
      errors: { name: "Name the skill." },
    });
    expect(validateSkill({ ...EMPTY_SKILL, name: " kubernetes " }, d, 3)).toEqual({
      ok: false,
      errors: { name: "“Kubernetes” is already on the matrix." },
    });
    expect(validateSkill({ ...EMPTY_SKILL, name: "Go", targetPeople: "4" }, d, 3)).toMatchObject({
      ok: false,
      errors: { targetPeople: "The team has 3 people." },
    });
    expect(validateSkill({ ...EMPTY_SKILL, name: "Go", targetPeople: "x" }, d, 3).ok).toBe(false);
    expect(
      validateSkill({ ...EMPTY_SKILL, name: " Go ", targetPeople: "2", targetLevel: "3" }, d, 3)
    ).toEqual({ ok: true, values: { name: "Go", targetPeople: 2, targetLevel: 3 } });
  });

  it("checks a pair's people against the matrix", () => {
    const d = doc();
    const cols = matrixColumns(d, ROSTER);
    expect(validatePair(EMPTY_PAIR, d, cols)).toMatchObject({
      ok: false,
      errors: { skillId: "Pick the skill to learn.", learner: "Pick who learns it." },
    });
    expect(validatePair({ ...EMPTY_PAIR, skillId: "k8s", learner: "Zed" }, d, cols)).toMatchObject({
      ok: false,
      errors: { learner: expect.stringMatching(/isn't on the matrix/) },
    });
    expect(
      validatePair({ ...EMPTY_PAIR, skillId: "k8s", learner: "bo", mentor: "Bo" }, d, cols)
    ).toMatchObject({ ok: false, errors: { mentor: "The mentor can't be the learner." } });
    expect(
      validatePair({ ...EMPTY_PAIR, skillId: "k8s", learner: "bo", mentor: "ana" }, d, cols)
    ).toEqual({
      ok: true,
      values: { skillId: "k8s", learnerId: "member_bo", mentorId: "member_ana", toLevel: 2 },
    });
  });
});

describe("the example and the export", () => {
  it("is all example- ids, with a single point of failure, a gap and a pair", () => {
    const ex = buildExample(new Date(2026, 9, 26));
    expect(ex.roster.every((m) => isExampleId(m.id))).toBe(true);
    expect(ex.doc.skills.every((s) => isExampleId(s.id))).toBe(true);
    expect(ex.doc.training?.every((p) => isExampleId(p.id))).toBe(true);
    const cols = matrixColumns(ex.doc, ex.roster);
    const cov = skillCoverage(ex.doc, cols, ex.roster);
    expect(cov.find((c) => c.name === "Kubernetes")?.spof).toBe(true);
    expect(cov.find((c) => c.name === "Payments")?.gap).toBe(true);
    expect(cov.find((c) => c.name === "CI/CD")?.meetsTarget).toBe(false);
  });

  it("exports the verdict, coverage, ratings with Not rated, and the plan", () => {
    const ex = buildExample(new Date(2026, 9, 26));
    const cols = matrixColumns(ex.doc, ex.roster);
    const cov = skillCoverage(ex.doc, cols, ex.roster);
    const md = skillsToMarkdown({
      doc: ex.doc,
      columns: cols,
      coverage: cov,
      suggestions: suggestCrossTraining(ex.doc, cols, cov),
      verdict: skillsVerdict(cov, cols),
    });
    expect(md).toContain("# Team skills matrix");
    expect(md).toContain("> 1 skill depends on one person (Kubernetes: Bo)");
    expect(md).toContain("| Kubernetes | 1 | — | Single point of failure | Bo | 0 |");
    expect(md).toContain("| React | Advanced | Not rated | Intermediate | Not rated |");
    expect(md).toContain("- [ ] Dee learns Kubernetes to Intermediate (with Bo)");
    expect(md).toContain("Suggested:");
    expect(coverageStatus(cov.find((c) => c.name === "TypeScript")!)).toBe("At target");
  });
});

describe("Insights' bus-factor rule", () => {
  it("counts the matrix's single points of failure once it is rated, else the Team page tags", () => {
    const tags = detectBusFactorRisk({
      teamMembers: ROSTER,
      skillsMatrices: [],
    } as unknown as Workspace);
    expect(tags?.evidence).toEqual(["Kubernetes", "Go", "go", "SQL"]);
    const unrated = { teamMembers: ROSTER, skillsMatrices: [doc()] } as unknown as Workspace;
    expect(detectBusFactorRisk(unrated)?.evidence).toEqual(tags?.evidence);
    const rated = {
      teamMembers: ROSTER,
      skillsMatrices: [
        doc({ grid: { k8s: { member_ana: 3, member_bo: 2 }, pay: { member_chen: 2 } } }),
      ],
    } as unknown as Workspace;
    expect(detectBusFactorRisk(rated)).toMatchObject({
      title: "Bus factor = 1 on 1 skill",
      evidence: ["Payments: Chen"],
    });
    const covered = {
      teamMembers: ROSTER,
      skillsMatrices: [
        doc({
          grid: { k8s: { member_ana: 3, member_bo: 2 }, pay: { member_chen: 2, member_bo: 4 } },
        }),
      ],
    } as unknown as Workspace;
    expect(detectBusFactorRisk(covered)).toBeNull();
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("the page", () => {
  it("starts empty with an example on offer, and writes nothing until asked", () => {
    renderPage();
    expect(screen.getByText(/No skills yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
    expect(ws().skillsMatrices).toEqual([]);
  });

  it("points at the Team page when there is no roster", () => {
    seed(doc(), []);
    renderPage();
    expect(screen.getByRole("link", { name: "Add your team on the Team page" })).toHaveAttribute(
      "href",
      "/team"
    );
    expect(screen.getByText(/^Nobody to rate yet/)).toBeInTheDocument();
  });

  it("adds a skill through the form: errors inline, nothing saved until valid", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
    expect(screen.getByText("Name the skill.")).toBeInTheDocument();
    expect(stored()).toBeUndefined();
    fireEvent.change(screen.getByLabelText(/^Skill/), { target: { value: "Kubernetes" } });
    fireEvent.change(screen.getByLabelText("Target people"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
    expect(stored()?.skills).toEqual([
      expect.objectContaining({ name: "Kubernetes", targetPeople: 2 }),
    ]);
    expect(stored()?.version).toBe(2);
    expect(logs.map((l) => l.action)).toContain("skill_added");
  });

  it("offers the skills the Team page lists, all at once with Undo", () => {
    seed(doc());
    renderPage();
    expect(
      screen.getByText(/2 skills are listed on the Team page but not here/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add all 2" }));
    expect(stored()?.skills.map((s) => s.name)).toEqual(["Kubernetes", "Payments", "Go", "SQL"]);
    undoLast();
    expect(stored()?.skills.map((s) => s.name)).toEqual(["Kubernetes", "Payments"]);
  });

  it("rates with the picker, tells Not rated from None, and clears back", async () => {
    seed(doc());
    renderPage();
    expect(
      screen.getByRole("button", { name: "Kubernetes · Ana: Not rated. Change rating" })
    ).toHaveTextContent("listed on Team page");
    await pick("Kubernetes", "Ana", "2 Intermediate");
    expect(stored()?.grid.k8s).toEqual({ member_ana: 2 });
    expect(screen.getByText("Single point of failure: Ana")).toBeInTheDocument();
    await pick("Kubernetes", "Bo", "0 None");
    expect(stored()?.grid.k8s).toEqual({ member_ana: 2, member_bo: 0 });
    expect(
      screen.getByRole("button", { name: "Kubernetes · Bo: None. Change rating" })
    ).toBeInTheDocument();
    await pick("Kubernetes", "Ana", "Clear");
    expect(stored()?.grid.k8s).toEqual({ member_bo: 0 });
    expect(logs.filter((l) => l.action === "rating_changed")).toHaveLength(3);
  });

  it("reads a legacy matrix by name, keeps the unmatched as not on the team, and re-keys on write", async () => {
    seed(LEGACY);
    renderPage();
    expect(
      screen.getByRole("button", { name: "TypeScript · Ana: Advanced. Change rating" })
    ).toBeInTheDocument();
    // A legacy 0 was never a rating.
    expect(
      screen.getByRole("button", { name: "React · Ana: Not rated. Change rating" })
    ).toBeInTheDocument();
    expect(screen.getByText("Not on the team")).toBeInTheDocument();
    await pick("React", "Bo", "1 Beginner");
    expect(stored()).toMatchObject({
      version: 2,
      members: [{ id: "m2", name: "Dee", description: "Contractor" }],
      grid: { s1: { member_ana: 3 }, s2: { m2: 2, member_bo: 1 } },
    });
    expect(ws().teamMembers).toEqual(ROSTER);
  });

  it("adds a not-on-the-team person to the roster only when asked, or removes them with Undo", () => {
    seed(normalizeSkillsMatrix({ ...LEGACY, version: 2 }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Remove Dee from the matrix" }));
    // The write also re-keys "ana " onto Ana's roster id.
    expect(stored()?.members.map((m) => m.id)).toEqual([]);
    expect(stored()?.grid.s1).toEqual({ member_ana: 3 });
    undoLast();
    expect(stored()?.members.map((m) => m.id)).toEqual(["m2"]);
    // On a version 2 doc a 0 is a real None, so it moves with Ana too.
    expect(stored()?.grid.s2).toEqual({ member_ana: 0, m2: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Add to the team" }));
    expect(ws().teamMembers?.map((m) => m.name)).toEqual(["Ana", "Bo", "Chen", "Dee"]);
    expect(screen.queryByText("Not on the team")).toBeNull();
  });

  it("deletes a skill with its ratings, and Undo puts it back in place", () => {
    seed(doc({ grid: { k8s: { member_ana: 3 } } }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Kubernetes" }));
    expect(stored()?.skills.map((s) => s.id)).toEqual(["pay"]);
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Deleted “Kubernetes”");
    undoLast();
    expect(stored()?.skills.map((s) => s.id)).toEqual(["k8s", "pay"]);
    expect(stored()?.grid.k8s).toEqual({ member_ana: 3 });
  });

  it("refuses a rename to another skill's name", () => {
    seed(doc());
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Payments" }));
    const input = screen.getByRole("textbox", { name: "Rename Payments" });
    fireEvent.change(input, { target: { value: "kubernetes" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(toastSpy.error).toHaveBeenCalledWith("“Kubernetes” is already on the matrix.");
    expect(stored()?.skills.map((s) => s.name)).toEqual(["Kubernetes", "Payments"]);
  });

  it("sets a target in place and shows below / at target in words", () => {
    seed(doc({ grid: { k8s: { member_ana: 3 } } }));
    renderPage();
    fireEvent.change(screen.getByLabelText("Target people for Kubernetes"), {
      target: { value: "2" },
    });
    expect(stored()?.skills[0]).toMatchObject({ targetPeople: 2 });
    expect(screen.getByText("Below target 1/2")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Target people for Kubernetes"), {
      target: { value: "1" },
    });
    expect(screen.getByText("At target 1/1")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Target people for Kubernetes"), {
      target: { value: "" },
    });
    expect(stored()?.skills[0].targetPeople).toBeUndefined();
  });

  it("plans a suggested pair, marks it done today and reopens it with Undo", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 26, 9));
    try {
      seed(
        doc({
          skills: [{ id: "k8s", name: "Kubernetes" }],
          grid: { k8s: { member_ana: 3, member_bo: 1 } },
        })
      );
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "Add to plan: Bo learns Kubernetes" }));
      const pair = stored()?.training?.[0];
      expect(pair).toMatchObject({
        skillId: "k8s",
        learnerId: "member_bo",
        mentorId: "member_ana",
        toLevel: 2,
      });
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      expect(stored()?.training?.[0].doneAt).toBe("2026-10-26");
      undoLast();
      expect(stored()?.training?.[0].doneAt).toBeUndefined();
      fireEvent.click(
        screen.getByRole("button", { name: "Delete the pair: Bo learns Kubernetes" })
      );
      expect(stored()?.training).toEqual([]);
      undoLast();
      expect(stored()?.training).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets only after confirming, keeps the roster, and Undo brings it all back", async () => {
    const before = doc({ grid: { k8s: { member_ana: 3 } } });
    seed(before);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(stored()).toEqual(before);
    fireEvent.click(await screen.findByRole("button", { name: "Reset matrix" }));
    expect(stored()).toEqual({
      id: SKILLS_MATRIX_ID,
      members: [],
      skills: [],
      grid: {},
      version: 2,
    });
    expect(ws().teamMembers).toEqual(ROSTER);
    expect(logs.map((l) => l.action)).toContain("skills_reset");
    undoLast();
    expect(stored()).toEqual(before);
  });

  it("shows the example without touching the workspace, and clears it", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText("Example data.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Single point of failure: Bo")).toBeInTheDocument();
    await pick("Payments", "Ana", "3 Advanced");
    expect(
      screen.getByRole("button", { name: "Payments · Ana: Advanced. Change rating" })
    ).toBeInTheDocument();
    expect(ws().skillsMatrices).toEqual([]);
    expect(ws().teamMembers).toEqual(ROSTER);
    expect(logs).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    await waitFor(() => expect(screen.getByText(/No skills yet/)).toBeInTheDocument());
  });

  it("says the same as the agent for the same data", async () => {
    seed(
      doc({
        grid: { k8s: { member_ana: 3, member_bo: 1 }, pay: { member_chen: 2, member_ana: 2 } },
      })
    );
    renderPage();
    const state = await run<{ verdict: string; spofCount: number; gapCount: number }>("list_state");
    expect(screen.getByText(state.verdict)).toBeInTheDocument();
    expect(state).toMatchObject({ spofCount: 1, gapCount: 0 });
    expect(screen.getByTestId("export-markdown").textContent).toContain(`> ${state.verdict}`);
  });
});
