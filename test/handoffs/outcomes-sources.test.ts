import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SOURCE_TOOLS, sourceHref, sourceLabel } from "@/lib/handoffs/registry";

/**
 * Every tool whose items land elsewhere with its sourceRef gets a "From …"
 * back-link: the Outcomes & quality ones (Phase 8) are a quote raised as an
 * opportunity, an assumption or an experiment sent to the Hypothesis
 * Tracker, a risk raised as an impediment, a debt item added to the backlog
 * (on the page and through the agent verbs). The scan reads every source
 * file, so a new sender anywhere can't land without its back-link.
 */

const SRC = join(process.cwd(), "src");

/** Every .ts and .tsx file under src (the generated action registry left out). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "_generated") out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * A hand-off's sourceRef written out: `sourceRef: { tool, id }` (or
 * `sourceRef: HandoffRef = …`), the tool a string or an UPPER_CASE constant.
 * A whiteboard card's `{ tool, entityId }` is another kind of link, and a
 * comment naming only `{ tool: "…" }` isn't a send.
 */
const SENT_RE =
  /sourceRef(?::\s*HandoffRef)?\s*[:=]\s*\{\s*tool:\s*(?:"([^"]+)"|([A-Z][A-Z0-9_]*))\s*,\s*id:/g;
const CONST_RE = /\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*"([^"]+)"/g;

/**
 * Tools named in a sourceRef that aren't pages to link back to: "story" marks
 * a sprint story queued for Planning Poker, so the accepted estimate is
 * written back to its points (lib/handoffs/poker-writeback.ts). "jira" marks
 * a story imported from a Jira CSV export (sprint-planning/jira.ts): no page
 * of ours made it, and its ticket key already links to the issue.
 */
const NOT_SOURCES = new Set(["story", "jira"]);

interface Scan {
  /** Each tool sent with, and the files (relative to src) that send it. */
  sent: Map<string, string[]>;
  /** "file: NAME" for a constant the scan couldn't read a tool name from. */
  unresolved: string[];
}

function scan(): Scan {
  const files = sourceFiles(SRC).map((f) => ({
    file: relative(SRC, f).replace(/\\/g, "/"),
    text: readFileSync(f, "utf8"),
  }));
  // A constant resolves to its definition in the same file, else to the one
  // value every definition of that name across src agrees on.
  const local = new Map<string, Map<string, string>>();
  const global = new Map<string, Set<string>>();
  for (const { file, text } of files) {
    const defs = new Map<string, string>();
    for (const [, name, value] of Array.from(text.matchAll(CONST_RE))) {
      defs.set(name, value);
      global.set(name, (global.get(name) ?? new Set()).add(value));
    }
    local.set(file, defs);
  }
  const sent = new Map<string, string[]>();
  const unresolved: string[] = [];
  for (const { file, text } of files) {
    for (const [, literal, constant] of Array.from(text.matchAll(SENT_RE))) {
      const values = constant ? global.get(constant) : undefined;
      const tool = constant
        ? (local.get(file)?.get(constant) ??
          (values?.size === 1 ? Array.from(values)[0] : undefined))
        : literal;
      if (!tool) {
        unresolved.push(`${file}: ${constant}`);
        continue;
      }
      const at = sent.get(tool) ?? [];
      if (!at.includes(file)) at.push(file);
      sent.set(tool, at);
    }
  }
  return { sent, unresolved };
}

describe("hand-off back-links", () => {
  const { sent, unresolved } = scan();

  it("read a tool name from every sourceRef in src", () => {
    expect(unresolved).toEqual([]);
    for (const tool of Array.from(NOT_SOURCES)) expect(sent.has(tool), tool).toBe(true);
  });

  it("list every tool any code sends with", () => {
    const missing = Array.from(sent.keys()).filter(
      (tool) => !NOT_SOURCES.has(tool) && !Object.prototype.hasOwnProperty.call(SOURCE_TOOLS, tool)
    );
    expect(missing.map((tool) => `${tool} (${sent.get(tool)!.join(", ")})`)).toEqual([]);
  });

  it("find each Phase 8 sender, page and agent", () => {
    expect(sent.get("user-interviews")).toContain("lib/interviews/model.ts");
    expect(sent.get("opportunity-tree")).toContain("lib/opportunity-tree/model.ts");
    expect(sent.get("riskiest-assumption")).toContain("lib/assumptions/model.ts");
    expect(sent.get("risk-register")).toContain("lib/risks/model.ts");
    // The Tech Debt page sends its backlog story under its TOOL_ID, the agent verb by name.
    expect(sent.get("tech-debt")).toEqual(
      expect.arrayContaining([
        "app/(tools)/tech-debt/tech-debt-client.tsx",
        "lib/actions/tools/tech-debt.ts",
      ])
    );
  });
});

describe("Outcomes & quality back-links", () => {
  it("label and link each back to its page", () => {
    const cases: [string, string, string][] = [
      ["user-interviews", "From user interviews", "/user-interviews"],
      ["opportunity-tree", "From opportunity tree", "/opportunity-tree"],
      ["riskiest-assumption", "From riskiest assumption", "/riskiest-assumption"],
      ["risk-register", "From Risk Register", "/risk-register"],
      ["tech-debt", "From tech debt", "/tech-debt"],
    ];
    for (const [tool, label, href] of cases) {
      const ref = { tool, id: "x1", doc: "d1" };
      expect(sourceLabel(ref), tool).toBe(label);
      expect(sourceHref(ref), tool).toBe(href);
    }
  });
});

describe("the tools plan's phase 1 back-links", () => {
  it("are listed ahead of their senders, Post-Mortem's factor for Root Cause among them", () => {
    const cases: [string, string, string][] = [
      ["parking-lot", "From parking lot", "/parking-lot"],
      ["root-cause", "From root-cause analysis", "/root-cause?analysis=x1"],
      ["audience-wall", "From Audience Wall", "/audience-wall"],
      ["quick-vote", "From Quick Vote", "/quick-vote"],
      ["interrupt-buffer", "From interrupt buffer", "/interrupt-buffer"],
      ["sm-notebook", "From Scrum Master Notebook", "/sm-notebook"],
      ["post-mortem", "From post-mortem", "/post-mortem"],
    ];
    for (const [tool, label, href] of cases) {
      const ref = { tool, id: "x1" };
      expect(sourceLabel(ref), tool).toBe(label);
      expect(sourceHref(ref), tool).toBe(href);
    }
  });
});

describe("the tools plan's phase 2 back-links", () => {
  it("are listed ahead of their senders, each opening the document its item came from", () => {
    // [tool, label, href with a doc "d1" and id "x1", href with no doc]
    const cases: [string, string, string, string][] = [
      ["example-mapping", "From example map", "/example-mapping?map=d1", "/example-mapping"],
      ["relative-sizing", "From relative sizing", "/relative-sizing?board=d1", "/relative-sizing"],
      ["bug-triage", "From bug triage", "/bug-triage?bug=x1", "/bug-triage?bug=x1"],
      ["hill-chart", "From hill chart", "/hill-chart?chart=d1", "/hill-chart"],
      ["test-sessions", "From test sessions", "/test-sessions?session=d1", "/test-sessions"],
      ["notes-to-actions", "From meeting notes", "/notes-to-actions?note=d1", "/notes-to-actions"],
      ["product-canvas", "From product canvas", "/product-canvas?canvas=d1", "/product-canvas"],
      ["impact-map", "From impact map", "/impact-map?map=d1", "/impact-map"],
      ["strategy-tree", "From strategy tree", "/strategy-tree?tree=d1", "/strategy-tree"],
      ["improve", "From improvement", "/improve?item=d1", "/improve?item=x1"],
      ["kickoff", "From kickoff", "/kickoff?kickoff=d1", "/kickoff"],
      ["kanban", "From Kanban board", "/kanban", "/kanban"],
    ];
    for (const [tool, label, withDoc, plain] of cases) {
      expect(sourceLabel({ tool, id: "x1", doc: "d1" }), tool).toBe(label);
      expect(sourceHref({ tool, id: "x1", doc: "d1" }), tool).toBe(withDoc);
      expect(sourceHref({ tool, id: "x1" }), tool).toBe(plain);
    }
    expect(sourceHref({ tool: "impact-map", id: "x", doc: "map 1" })).toBe(
      "/impact-map?map=map%201"
    );
  });
});
