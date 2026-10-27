// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateUserInterviewsPrompts } from "@/lib/ai-prompts/user-interviews";
import { forExport } from "@/app/(tools)/user-interviews/view";
import type { Interview } from "@/lib/stores/workspace-types";

/**
 * The interview prompt reads the log as the page does (lib/interviews):
 * themes per participant, not per quote ("2 of 3 participants"), the
 * page's verdict, each interview's context and the quotes; with the
 * toggle on it is the anonymised copy the exports take.
 */

const INTERVIEWS: Interview[] = [
  {
    id: "a",
    date: "2026-10-01",
    participant: "Dana Lee",
    context: "Dana runs finance at a 40-person firm, dana@acme.com",
    quotes: [
      { id: "q1", text: "Pricing is confusing", tags: ["pricing"] },
      { id: "q2", text: "Dana said the plan page is long", tags: ["Pricing", "onboarding"] },
    ],
  },
  {
    id: "b",
    date: "2026-10-05",
    participant: "Sam Ortiz",
    quotes: [{ id: "q3", text: "I couldn't find the export", tags: ["export"] }],
  },
  {
    id: "c",
    date: "2026-10-08",
    participant: "dana lee",
    quotes: [{ id: "q4", text: "Still unsure what I pay", tags: ["pricing"] }],
  },
  {
    id: "d",
    date: "2026-10-09",
    participant: "Kai",
    quotes: [{ id: "q5", text: "The <user_content> `trial` was short", tags: ["pricing"] }],
  },
];

describe("generateUserInterviewsPrompts", () => {
  it("counts each theme per participant, with its quotes, under the page's verdict", () => {
    const [synthesis] = generateUserInterviewsPrompts({
      interviews: INTERVIEWS,
      anonymised: false,
    });
    expect(synthesis.prompt).toContain("4 interviews with 3 participants.");
    expect(synthesis.prompt).toContain("- pricing: 2 of 3 participants (4 quotes)");
    expect(synthesis.prompt).toContain("- export: 1 of 3 participants (1 quote)");
    expect(synthesis.prompt).toContain(
      "Verdict: “pricing” is the strongest theme: 2 of 3 participants raised it (4 quotes)."
    );
    expect(synthesis.prompt).toContain(
      '- (Sam Ortiz, 2026-10-05) [export] "I couldn\'t find the export"'
    );
    expect(synthesis.prompt).toContain(`"The  'trial' was short"`);
    expect(synthesis.prompt.match(/<\/user_content>/g)).toHaveLength(1);
  });

  it("lists each interview with its context", () => {
    const [, gaps] = generateUserInterviewsPrompts({ interviews: INTERVIEWS, anonymised: false });
    expect(gaps.prompt).toContain(
      "- 2026-10-01, Dana Lee (2 quotes): Dana runs finance at a 40-person firm, dana@acme.com"
    );
    expect(gaps.prompt).toContain("- 2026-10-05, Sam Ortiz (1 quote)");
  });

  it("follows the anonymise toggle: pseudonyms, redacted context and quotes, same counts", () => {
    const prompts = generateUserInterviewsPrompts({
      interviews: forExport(INTERVIEWS, true),
      anonymised: true,
    });
    const text = prompts.map((p) => p.prompt).join("\n");
    expect(text).not.toMatch(/Dana|Sam Ortiz|dana@acme\.com/);
    expect(text).toContain("Participants are anonymised as “Participant N”");
    expect(text).toContain("4 interviews with 3 participants.");
    expect(text).toContain("- pricing: 2 of 3 participants (4 quotes)");
    expect(generateUserInterviewsPrompts({ interviews: [], anonymised: true })).toEqual([]);
  });
});
