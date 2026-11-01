/**
 * Every reader of an OKR's progress uses lib/okrs/progress: the OKR page's
 * imports, Sprint Goal's linked OKRs, the AI prompt and the Canvas import.
 * A key result that should fall (churn 22% → 15%, now 18%) is 57% of the
 * way everywhere; before Phase 8 the prompt and the Canvas read it as
 * current / target (120%) and the page clamped that to 100%.
 */

import { describe, expect, it } from "vitest";
import type { Okr } from "@/lib/stores/workspace-types";
import * as lib from "@/lib/okrs/progress";
import * as page from "@/app/(tools)/okrs/progress";
import * as sprintGoal from "@/app/(tools)/sprint-goal/okr-links";
import { generateOkrsPrompts } from "@/lib/ai-prompts/okrs";
import { importFromOkrs } from "@/lib/whiteboard/cross-tool-import";

const OKR: Okr = {
  id: "o1",
  objective: "Customers stay",
  quarter: "2026 Q4",
  keyResults: [
    {
      id: "churn",
      title: "Monthly churn",
      unit: "%",
      baseline: 22,
      target: 15,
      current: 18,
      direction: "decrease",
    },
    { id: "zero", title: "Legacy zero target", target: 0, current: 3 },
  ],
};

describe("one OKR progress formula", () => {
  it("is what the OKR page and Sprint Goal import", () => {
    expect(page.krProgress).toBe(lib.krProgress);
    expect(page.objectiveHealth).toBe(lib.objectiveProgress);
    expect(sprintGoal.krProgressText).toBe(lib.krProgressText);
    expect(sprintGoal.okrPercent).toBe(lib.objectivePercent);
  });

  it("reads a falling key result the same in the AI prompt", () => {
    const prompt = generateOkrsPrompts({ okrs: [OKR] })[0].prompt;
    const churnRow = prompt.split("\n").find((l) => l.includes("Monthly churn")) ?? "";
    expect(churnRow).toContain("| 57% |");
    const zeroRow = prompt.split("\n").find((l) => l.includes("Legacy zero target")) ?? "";
    expect(zeroRow).toContain("| 0% |");
  });

  it("labels a Canvas key-result card with the same percentage", () => {
    const cards = importFromOkrs("board", [OKR]);
    const churn = cards.find((c) => c.sourceRef?.entityId === "churn");
    expect((churn as { content?: string }).content).toBe("Monthly churn\n57%");
    const zero = cards.find((c) => c.sourceRef?.entityId === "zero");
    expect((zero as { content?: string }).content).toBe("Legacy zero target\n0%");
  });
});
