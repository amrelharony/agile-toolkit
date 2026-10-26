// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateStakeholderMapPrompts } from "@/lib/ai-prompts/stakeholder-map";
import { stakeholderVerdict, type Stakeholder } from "@/app/(tools)/stakeholder-map/model";

/**
 * The Stakeholder Map prompt sees everyone: someone not placed yet reads
 * "Not placed", a sentiment nobody set reads "not set", never a default;
 * the quadrant counts, blockers and touches overdue are the page's.
 */

const TODAY = "2026-10-26";

const person = (id: string, over: Partial<Stakeholder> = {}): Stakeholder => ({
  id,
  name: id,
  interest: null,
  authority: null,
  currentSentiment: null,
  desiredSentiment: null,
  ...over,
});

const LIST: Stakeholder[] = [
  person("Ana", {
    role: "CFO",
    interest: 8,
    authority: 9,
    currentSentiment: "skeptic",
    desiredSentiment: "supporter",
    lastContactAt: "2026-10-01",
    nextTouchAt: "2026-10-20",
  }),
  // Not placed, a blocker.
  person("Ben", { currentSentiment: "blocker", desiredSentiment: "neutral" }),
  // Placed, no sentiment yet.
  person("Cleo", { interest: 2, authority: 7 }),
];

const [strategy, blockers] = generateStakeholderMapPrompts({ stakeholders: LIST, today: TODAY });

describe("generateStakeholderMapPrompts", () => {
  it("counts every stakeholder as the page's cards do", () => {
    expect(strategy.prompt).toContain(
      "3 stakeholders (1 not placed on the map yet). Manage Closely: 1, Keep Satisfied: 1, Keep Informed: 0, Monitor: 0."
    );
    expect(strategy.prompt).toContain(`- ${stakeholderVerdict(LIST, TODAY)}`);
    expect(strategy.prompt).toContain("- Blockers: 1");
    expect(strategy.prompt).toContain("- Touches overdue: 1");
    expect(blockers.prompt).toContain("1 blocker(s) currently logged.");
  });

  it("reads an unplaced or unrated stakeholder as such, never as a default", () => {
    expect(strategy.prompt).toContain(
      "| Ana | CFO | Manage Closely | 8 | 9 | Skeptic → Supporter (2 steps short) | 2026-10-01 | 2026-10-20 |"
    );
    expect(strategy.prompt).toContain(
      "| Ben | — | Not placed | — | — | Blocker → Neutral (2 steps short) | — | — |"
    );
    expect(strategy.prompt).toContain("| Cleo | — | Keep Satisfied | 2 | 7 | sentiment not set |");
    // The unplaced blocker is in the blockers' table too.
    expect(blockers.prompt).toContain("| Ben | — | Not placed | — | Neutral | — |");
  });

  it("has no prompts without a stakeholder", () => {
    expect(generateStakeholderMapPrompts({ stakeholders: [], today: TODAY })).toEqual([]);
  });
});
