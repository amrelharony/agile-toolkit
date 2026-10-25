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
  "ice-score",
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
const LOCAL_STORAGE_OFFENDERS = ["agile-at-work", "canvas", "planning-poker"];

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

/** Every source file of a tool, comments stripped; read once per run. */
function toolCode(id: string): string {
  let src = codeCache.get(id);
  if (src === undefined) {
    const dir = path.join(TOOLS_DIR, id);
    src = existsSync(dir) ? filesIn(dir).map(code).join("\n") : "";
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
