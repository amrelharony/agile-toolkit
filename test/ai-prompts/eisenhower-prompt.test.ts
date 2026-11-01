// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateEisenhowerPrompts } from "@/lib/ai-prompts/eisenhower";
import { eisRows } from "@/app/(tools)/eisenhower/model";
import { eisVerdict } from "@/app/(tools)/eisenhower/verdict";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * The Eisenhower prompt reads the panes as the page does today: urgent is
 * the toggle or a due date within two days (overdue included), with the
 * reason said; a task missing an answer waits under "Not sorted yet",
 * never in Do; and who a task is handed to is named.
 */

const TODAY = "2026-10-26";

const task = (id: string, title: string, fields: Record<string, string>) =>
  ({
    id,
    framework: "eisenhower",
    title,
    fields,
    status: "open",
    updatedAt: "2026-10-20T09:00:00.000Z",
  }) satisfies PrioritizationItem;

const ranked = eisRows(
  [
    task("deck", "Board deck", { important: "true", urgent: "false", dueAt: "2026-11-20" }),
    task("outage", "Fix login outage", { important: "true", urgent: "false", dueAt: "2026-10-24" }),
    task("expenses", "Expense report", { important: "false", urgent: "true", delegateTo: "Ana" }),
    // Saved before the answers: a hand-picked quadrant only.
    task("news", "Old newsletter", { quadrant: "delete" }),
    task("half", "Half answered", { important: "true" }),
  ],
  TODAY
);

describe("generateEisenhowerPrompts", () => {
  const [p] = generateEisenhowerPrompts({ rows: ranked, today: TODAY }, null);

  it("puts a task due within two days in Do and says why", () => {
    expect(p.prompt).toContain("### Do (1): Urgent and important: do it now.");
    expect(p.prompt).toContain("- Fix login outage (urgent because it's 2 days overdue)");
    expect(p.prompt).toContain("- Board deck (due in 25 days)");
  });

  it("names the delegate, reads a legacy quadrant, and never sorts a half-answered task", () => {
    expect(p.prompt).toContain("- Expense report (marked urgent; handed to Ana)");
    expect(p.prompt).toContain("### Delete (1): Neither: drop it.\n- Old newsletter");
    expect(p.prompt).toContain(
      "### Not sorted yet (1): Answer whether each is urgent and important to sort it.\n- Half answered (whether it's urgent isn't answered)"
    );
    expect(p.prompt).toContain(`Verdict: ${eisVerdict(ranked, TODAY)}`);
  });

  it("shows an empty pane as such and leaves out an empty Not sorted yet", () => {
    const outage = ranked.filter((r) => r.row.id === "outage");
    const [only] = generateEisenhowerPrompts({ rows: outage, today: TODAY });
    expect(only.prompt).toContain(
      "### Schedule (0): Important, not urgent: put a time on it.\n(none)"
    );
    expect(only.prompt).not.toContain("Not sorted yet");
    expect(generateEisenhowerPrompts({ rows: [], today: TODAY })).toEqual([]);
  });
});
