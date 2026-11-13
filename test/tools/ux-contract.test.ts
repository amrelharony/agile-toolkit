import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { tools } from "@/lib/constants/tools";
import { isShelved } from "@/lib/tools/catalog";
import { toolsWithNextSteps } from "@/lib/tools/next-steps";

/**
 * The tool UX contract (plan: "upgrade every tool's logic for UX, UI and
 * usability"), checked statically for the tools whose upgrade has landed.
 *
 * Each phase adds its section's tools to UPGRADED_TOOLS. The ratchets at
 * the bottom cover every main tool: the lists of known offenders may only
 * shrink — a tool that stops offending must leave the list, and a new
 * offender fails the run.
 */

/** Tools that meet the contract. Grows phase by phase. */
const UPGRADED_TOOLS = [
  // Phase 2: Plan the sprint. Planning Poker joins once its local session
  // stops reading localStorage directly.
  "sprint-goal",
  "estimation-guide",
  "refinement",
  "story-mapper",
  "walking-skeleton",
  "release-planner",
  "jtbd-mapper",
  "epic-roadmap",
  "sprint-planning",
  "capacity-planner",
  "pi-planning",
  "scrum-of-scrums",
  "dependency-map",
  // Phase 3: Run the sprint.
  "kanban",
  "sprint",
  "standup",
  "async-standup",
  "impediments",
  "ceremony-timer",
  "sprint-review",
  // Phase 4: Retrospect & improve. Canvas is a scoped upgrade (below).
  "retro",
  "retro-actions",
  "premortem",
  "icebreaker",
  "liberating-structures",
  "six-hats",
  "design-sprint",
  // Phase 5: Track delivery.
  "burndown",
  "burnup",
  "velocity",
  "sprint-compare",
  "sprint-metrics",
  "cumulative-flow",
  "cycle-time",
  "value-stream",
  "health-dashboard",
  "dora-scorecard",
  "release-readiness",
  "feature-flag-tracker",
  // Phase 6: Team & people. Health Check, Psych Safety and Mood Tracker run
  // their anonymous rounds through the shared vote room.
  "health-check",
  "psych-safety",
  "mood-tracker",
  "kudos",
  "one-on-one",
  "onboarding-tracker",
  "stakeholder-map",
  "working-agreement",
  "dod-builder",
  "raci",
  "skills-matrix",
  "maturity",
  "adkar",
  // Phase 7: Prioritize & decide. ICE was the Phase 1A pilot; the method
  // tools now run on the shared shell (its source counts as theirs, below),
  // and DACI and RAPID are the Decision Log's record (MERGED_INTO).
  "prioritizer",
  "rice-scoring",
  "wsjf",
  "moscow",
  "ice-score",
  "value-effort-matrix",
  "kano-model",
  "cost-of-delay",
  "buy-a-feature",
  "hundred-dollar-test",
  "eisenhower",
  "decision-log",
  "daci",
  "rapid-decision",
  "weighted-decision",
  "cynefin",
  // Phase 8: Outcomes, quality & library. Risk Register and Tech Debt moved
  // into the workspace (one store each).
  "okrs",
  "nps-csat",
  "hypothesis-tracker",
  "user-interviews",
  "opportunity-tree",
  "riskiest-assumption",
  "risk-register",
  "tech-debt",
  "quality-cost",
  "test-pyramid",
  "flaky-tests",
  "code-review-metrics",
  // Tools plan, phase 1.
  "product-goal",
  "backlog-health",
  "interrupt-buffer",
  "picker",
  "quick-vote",
  "audience-wall",
  "facilitator-timers",
  "root-cause",
  "team-mixer",
  // Book readers: the Squad Session Kit. Meet the Cast and Which Colleague hold no
  // team data, so there's nothing to load, export or undo in them.
  "squad-session",
];

/**
 * Tools whose phase row limits the upgrade to named features ("no other
 * changes"): they get an upgrade test for those, not the whole contract.
 */
const SCOPED_UPGRADES: Record<string, string> = {
  canvas: "Phase 4: Sprint board and Story map templates bound to live data only",
};

/**
 * Tools merged into another: their route opens the other tool (in a mode
 * of its own), so the other tool's folder and upgrade test hold their
 * contract. The route's own folder keeps only its page.
 */
const MERGED_INTO: Record<string, string> = {
  "async-standup": "standup",
  daci: "decision-log",
  "rapid-decision": "decision-log",
};

/**
 * Upgraded tools with no add form, so there is no draft to validate. The
 * reason is the exemption, and it has to stay true.
 */
const CREATES_NOTHING: Record<string, string> = {
  "estimation-guide": "edits the notes of a fixed set of cards in place; nothing is created",
  "sprint-metrics":
    "a read-only trend view of the shared sprints; a new sprint goes through the shared NewSprintDialog, which validates",
};

/** Main tools still calling the browser's confirm(): none since Phase 5; keep it that way. */
const CONFIRM_OFFENDERS: string[] = [];

/** Main tools reading localStorage directly instead of a persisted store. */
const LOCAL_STORAGE_OFFENDERS = ["canvas", "planning-poker"];

const TOOLS_DIR = path.resolve(__dirname, "../../src/app/(tools)");
const TESTS_DIR = path.resolve(__dirname);

const mainToolIds = tools.filter((t) => !isShelved(t)).map((t) => t.id);

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? filesIn(p) : /\.(tsx?|mts)$/.test(name) ? [p] : [];
  });
}

/** Source with comments stripped, so a note about confirm() isn't a call. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const codeCache = new Map<string, string>();

/**
 * The shared prioritization shell (Phase 7). A method tool that renders it
 * gets its empty state, example notice, Undo and export from there, so the
 * shell's source counts as part of the tool's.
 */
const METHOD_SHELL = path.resolve(__dirname, "../../src/components/prioritization/method-tool.tsx");
const usesMethodShell = (src: string) => /@\/components\/prioritization\/method-tool["']/.test(src);

/** Every source file of a tool, comments stripped; read once per run. */
function toolCode(id: string): string {
  let src = codeCache.get(id);
  if (src === undefined) {
    const dir = path.join(TOOLS_DIR, id);
    src = existsSync(dir) ? filesIn(dir).map(code).join("\n") : "";
    if (usesMethodShell(src)) src += "\n" + code(METHOD_SHELL);
    codeCache.set(id, src);
  }
  return src;
}

// Reading all 83 tools (Canvas alone is ~20k lines) takes a few seconds on
// a busy machine; the default 5 s test timeout is too tight for the scan.
const SCAN_TIMEOUT = 60_000;

const callsConfirm = (src: string) => /(?<![\w.])(?:window\.)?confirm\s*\(/.test(src);
const usesLocalStorage = (src: string) => /\blocalStorage\s*\./.test(src);

describe("tool UX contract", () => {
  it("only lists main tools that exist", () => {
    for (const id of UPGRADED_TOOLS) expect(mainToolIds, id).toContain(id);
  });

  it("merged tools open the tool they were merged into", () => {
    for (const [id, home] of Object.entries(MERGED_INTO)) {
      expect(UPGRADED_TOOLS, home).toContain(home);
      expect(code(path.join(TOOLS_DIR, id, "page.tsx")), id).toContain(`(tools)/${home}/`);
    }
  });

  describe.each(UPGRADED_TOOLS)("%s", (id) => {
    const home = MERGED_INTO[id] ?? id;
    const dir = path.join(TOOLS_DIR, home);
    const src = toolCode(home);

    it("has example data and a Markdown export", () => {
      expect(existsSync(path.join(dir, "example.ts")), "example.ts").toBe(true);
      expect(existsSync(path.join(dir, "markdown.ts")), "markdown.ts").toBe(true);
      expect(src).toMatch(/\bLoadExampleButton\b/);
      expect(src).toMatch(/\bExampleNotice\b/);
      expect(src).toMatch(/<ExportButton[\s\S]*?\bmarkdown=/);
    });

    it("has an empty state", () => {
      expect(src).toMatch(/<EmptyState\b/);
    });

    it("offers Undo for every delete or reset", () => {
      const deletes = /\b(remove|delete)\w*\s*\(|\bonRemove\b|\bonDelete\b/i.test(src);
      if (deletes) expect(src).toMatch(/\b(undoable|removeWithUndo|ResetButton)\b/);
    });

    it("validates before saving instead of defaulting", () => {
      if (id in CREATES_NOTHING) return;
      expect(src).toMatch(/\b(useItemForm|validate\w*)\b/);
    });

    it("never uses the browser's confirm() or raw localStorage", () => {
      expect(callsConfirm(src)).toBe(false);
      expect(usesLocalStorage(src)).toBe(false);
    });

    it("declares a data-aware next step", () => {
      expect(toolsWithNextSteps()).toContain(id);
    });

    it("has an upgrade test", () => {
      expect(existsSync(path.join(TESTS_DIR, `${home}-upgrade.test.tsx`))).toBe(true);
    });
  });
});

describe("scoped upgrades", () => {
  it.each(Object.keys(SCOPED_UPGRADES))("%s has an upgrade test", (id) => {
    expect(mainToolIds, id).toContain(id);
    expect(UPGRADED_TOOLS, id).not.toContain(id);
    expect(existsSync(path.join(TESTS_DIR, `${id}-upgrade.test.tsx`))).toBe(true);
  });
});

describe("ratchets across every main tool", () => {
  it(
    "no new tool calls the browser's confirm()",
    () => {
      const offenders = mainToolIds.filter((id) => callsConfirm(toolCode(id)));
      expect(offenders.sort()).toEqual([...CONFIRM_OFFENDERS].sort());
    },
    SCAN_TIMEOUT
  );

  it(
    "no new tool reads localStorage directly",
    () => {
      const offenders = mainToolIds.filter((id) => usesLocalStorage(toolCode(id)));
      expect(offenders.sort()).toEqual([...LOCAL_STORAGE_OFFENDERS].sort());
    },
    SCAN_TIMEOUT
  );
});
