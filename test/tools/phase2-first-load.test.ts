// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * What a tool page's first load must leave out: code only a later part of
 * the page uses, which loads behind a dynamic import (next/dynamic or an
 * `import()` call) when that part shows or runs.
 *
 * The walk follows static imports and re-exports from a page's client
 * module and never an `import()` call, so a module it reaches is in the
 * page's first load. Type-only imports are skipped (the compiler drops
 * them); a plain import used only for types is still followed, so the walk
 * errs on the strict side.
 */
const ROOT = process.cwd();
const abs = (f: string) => path.join(ROOT, f);

/** The specifiers a module imports values from (type-only imports are erased). */
function valueImports(src: string): string[] {
  const from = Array.from(
    src.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+["']([^"']+)["']/gm)
  ).map((m) => m[1]);
  const bare = Array.from(src.matchAll(/^import\s+["']([^"']+)["']/gm)).map((m) => m[1]);
  return [...from, ...bare];
}

/** A source file for an "@/" or relative specifier, or null for a package or an asset. */
function resolve(spec: string, importer: string): string | null {
  const base = spec.startsWith("@/")
    ? path.join(ROOT, "src", spec.slice(2))
    : spec.startsWith(".")
      ? path.resolve(path.dirname(importer), spec)
      : null;
  if (base === null) return null;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (existsSync(base + ext)) return base + ext;
  }
  if (/\.(css|json|svg|png)$/.test(spec)) return null;
  throw new Error(`${importer} imports ${spec}, which doesn't resolve`);
}

/** Every repo module the entry reaches by static imports, as repo paths with "/". */
function firstLoad(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [abs(entry)];
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of valueImports(readFileSync(file, "utf8"))) {
      const next = resolve(spec, file);
      if (next) queue.push(next);
    }
  }
  return new Set(Array.from(seen, (f) => path.relative(ROOT, f).split(path.sep).join("/")));
}

describe("what a tool page's first load leaves out", () => {
  it("the team charter reads the team's purpose without Kickoff's model and its formats", () => {
    const reached = firstLoad("src/app/(meta)/team/team-client.tsx");
    expect(reached).toContain("src/app/(meta)/team/charter-view.ts");
    expect(reached).toContain("src/lib/kickoff/purpose.ts");
    for (const lazy of [
      "src/lib/kickoff/model.ts",
      "src/lib/kickoff/formats.ts",
      "src/lib/sectioned/model.ts",
    ]) {
      expect(reached, lazy).not.toContain(lazy);
    }
  });

  it("Impediments loads its Blockers section, the AI kit and its clustering after the page", () => {
    const reached = firstLoad("src/app/(tools)/impediments/impediments-client.tsx");
    // The walk does see the page's own parts.
    expect(reached).toContain("src/app/(tools)/impediments/advanced.tsx");
    expect(reached).toContain("src/lib/impediments/blockers.ts");
    for (const lazy of [
      "src/app/(tools)/impediments/blockers-section.tsx",
      "src/app/(tools)/impediments/blocker-writes.ts",
      "src/components/ai/index.ts",
      "src/lib/ai/tasks/impediments.lite.ts",
    ]) {
      expect(reached, lazy).not.toContain(lazy);
    }
  });

  it("Kanban loads the hand-off sender and its targets only when the block dialog opens", () => {
    const reached = firstLoad("src/app/(tools)/kanban/kanban-client.tsx");
    // Both boards and their "Add why" dialog are in it; the light back-link helpers too.
    expect(reached).toContain("src/app/(tools)/kanban/flow-board.tsx");
    expect(reached).toContain("src/app/(tools)/kanban/sprint-board.tsx");
    expect(reached).toContain("src/app/(tools)/kanban/block-note-dialog.tsx");
    for (const lazy of [
      "src/lib/handoffs/send.ts",
      "src/lib/handoffs/registry.ts",
      "src/lib/handoffs/targets/impediment.ts",
    ]) {
      expect(reached, lazy).not.toContain(lazy);
    }
  });

  it("the Standup page loads the async digest's summary and the AI kit only when it shows", () => {
    const reached = firstLoad("src/app/(tools)/standup/standup-client.tsx");
    expect(reached).toContain("src/app/(tools)/standup/views.tsx");
    for (const lazy of [
      "src/app/(tools)/standup/digest-summary.tsx",
      "src/components/ai/index.ts",
      "src/lib/ai/tasks/async-standup.lite.ts",
      "src/lib/standup/digest-ai.ts",
    ]) {
      expect(reached, lazy).not.toContain(lazy);
    }
  });

  it("PI Planning's ROAM section reads the Risk Register's link without the hand-off registry", () => {
    const reached = firstLoad("src/app/(tools)/pi-planning/pi-planning-client.tsx");
    expect(reached).toContain("src/app/(tools)/pi-planning/roam-section.tsx");
    expect(reached).toContain("src/lib/handoffs/targets/risk.ts");
    for (const lazy of ["src/lib/handoffs/send.ts", "src/lib/handoffs/registry.ts"]) {
      expect(reached, lazy).not.toContain(lazy);
    }
  });

  it("Kanban's boards and export read the workflow's light helpers, not the Definition of Workflow engine", () => {
    const reached = firstLoad("src/app/(tools)/kanban/kanban-client.tsx");
    expect(reached).toContain("src/app/(tools)/kanban/markdown.ts");
    expect(reached).toContain("src/lib/kanban/workflow-view.ts");
    for (const lazy of [
      "src/lib/kanban/workflow.ts",
      "src/app/(tools)/kanban/workflow/workflow-section.tsx",
    ]) {
      expect(reached, lazy).not.toContain(lazy);
    }
  });

  it("the Working Agreement lists its charter templates and loads their forms when one opens", () => {
    const reached = firstLoad("src/app/(tools)/working-agreement/working-agreement-client.tsx");
    expect(reached).toContain("src/app/(tools)/working-agreement/templates-panel.tsx");
    expect(reached).toContain("src/lib/working-agreement/templates.ts");
    for (const lazy of [
      "src/app/(tools)/working-agreement/template-form.tsx",
      "src/app/(tools)/working-agreement/template-forms.tsx",
      "src/app/(tools)/team-time/fields.tsx",
      "src/lib/team-time/model.ts",
      "src/lib/team-time/rows.ts",
    ]) {
      expect(reached, lazy).not.toContain(lazy);
    }
  });

  it.each([
    ["the Standup and the Async Standup", "src/app/(tools)/standup/standup-client.tsx"],
    ["the Product Canvas", "src/app/(tools)/product-canvas/product-canvas-client.tsx"],
    ["the Working Agreement", "src/app/(tools)/working-agreement/working-agreement-client.tsx"],
  ])("%s draw Send to… without the hand-off registry, which loads with its items", (_, page) => {
    const reached = firstLoad(page);
    expect(reached).toContain("src/components/handoff/send-to-menu.tsx");
    for (const lazy of [
      "src/components/handoff/send-to-menu-items.tsx",
      "src/lib/handoffs/send.ts",
      "src/lib/handoffs/registry.ts",
    ]) {
      expect(reached, lazy).not.toContain(lazy);
    }
  });

  it("home reads the shared formatters without the metric tools' unit words", () => {
    const reached = firstLoad("src/components/home/home-page.tsx");
    expect(reached).toContain("src/lib/utils/formatters.ts");
    expect(reached, "src/lib/utils/unit-after.ts").not.toContain("src/lib/utils/unit-after.ts");
    // The metric tools that say "1 day" still reach it.
    expect(firstLoad("src/lib/improve/model.ts")).toContain("src/lib/utils/unit-after.ts");
    expect(firstLoad("src/lib/hypotheses/model.ts")).toContain("src/lib/utils/unit-after.ts");
  });

  it("Kickoff's Send to… loads its items and the sender when the menu is near; the reasons keep the registry", () => {
    const reached = firstLoad("src/app/(tools)/kickoff/kickoff-client.tsx");
    expect(reached).toContain("src/app/(tools)/kickoff/send-menu.tsx");
    // A line's reason for an off route reads the route's own check as the page draws.
    expect(reached).toContain("src/lib/handoffs/registry.ts");
    for (const lazy of [
      "src/components/handoff/send-to-menu-items.tsx",
      "src/lib/handoffs/send.ts",
    ]) {
      expect(reached, lazy).not.toContain(lazy);
    }
  });
});
