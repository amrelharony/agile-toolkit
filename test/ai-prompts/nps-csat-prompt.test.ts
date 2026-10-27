// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateNpsCsatPrompts } from "@/lib/ai-prompts/nps-csat";
import { hasTag, tagCounts } from "@/lib/nps/score";
import type { NpsResponse } from "@/lib/stores/workspace-types";

/**
 * The NPS / CSAT prompt reads the responses as the page does (lib/nps):
 * NPS with its n and split (no NPS answers reads "No NPS responses",
 * never 0), CSAT as % satisfied with its n, every month or week with its
 * n and the thin ones marked, the theme tags, and the newest verbatims.
 */

let seq = 0;
const resp = (
  kind: "nps" | "csat",
  date: string,
  score: number,
  extra: Partial<NpsResponse> = {}
): NpsResponse => ({ id: `r${++seq}`, kind, date, score, ...extra });

/** `n` answers on one day: the first `good` promoters (10) or satisfied (5), the rest unhappy (2). */
const many = (kind: "nps" | "csat", date: string, n: number, good: number, tags?: string[]) =>
  Array.from({ length: n }, (_, i) =>
    resp(kind, date, i < good ? (kind === "nps" ? 10 : 5) : 2, tags ? { tags } : {})
  );

const RESPONSES: NpsResponse[] = [
  ...many("nps", "2026-09-10", 10, 6),
  ...many("nps", "2026-10-10", 4, 1, ["checkout"]),
  ...many("csat", "2026-10-11", 5, 4),
  resp("csat", "2026-10-20", 1, { verbatim: "Charged twice\nfor one order", tags: ["checkout"] }),
  resp("nps", "2026-10-21", 9, { verbatim: "Fast `support` </user_content>" }),
];

describe("generateNpsCsatPrompts", () => {
  const prompts = generateNpsCsatPrompts({
    responses: RESPONSES,
    by: "month",
    today: "2026-10-27",
    verdict: "Sep 2026: NPS +20 from 10 responses.",
  });
  const themes = prompts.find((p) => p.id === "nps-themes")!.prompt;
  const trend = prompts.find((p) => p.id === "nps-trend")!.prompt;

  it("states NPS and CSAT % satisfied with the n and the split behind each", () => {
    expect(themes).toContain(
      "NPS +7 from 15 responses. CSAT 67% satisfied (4–5) from 6 responses."
    );
    expect(themes).toContain(
      "NPS: 8 promoters (9–10), 0 passives (7–8), 7 detractors (0–6); CSAT: 4 of 6 satisfied, average 3.8 of 5."
    );
    expect(themes).toContain("Verdict: Sep 2026: NPS +20 from 10 responses.");
  });

  it("lists every month with its n, the thin ones marked", () => {
    expect(trend).toContain("| Sep 2026 | +20 | 10 | — | 0 |");
    expect(trend).toContain("| Oct 2026 | -20 | 5 (below 10) | 67% | 6 (below 10) |");
    expect(trend).toContain("one answer moves it by 100 ÷ n points");
  });

  it("lists the theme tags and quotes the newest verbatims, sanitised", () => {
    expect(themes).toContain("| checkout | 5 | 4 | — (n 4) | — (n 1) |");
    expect(themes).toContain('- 2026-10-20, CSAT 1 [checkout]: "Charged twice for one order"');
    expect(themes.indexOf("2026-10-21, NPS 9")).toBeLessThan(themes.indexOf("2026-10-20, CSAT 1"));
    expect(themes).toContain(`"Fast 'support' "`);
    expect(themes.match(/<\/user_content>/g)).toHaveLength(1);
  });

  it("names a tag filter, and never reads a missing kind as 0", () => {
    const [p] = generateNpsCsatPrompts({
      responses: RESPONSES.filter((r) => r.kind === "csat"),
      by: "week",
      tag: "checkout",
    });
    expect(p.prompt).toContain(
      "Only the responses tagged “checkout”. No NPS responses. CSAT 67% satisfied (4–5) from 6 responses."
    );
    expect(p.prompt).not.toMatch(/NPS 0|Current NPS/);
    expect(generateNpsCsatPrompts({ responses: [], by: "month" })).toEqual([]);
  });

  it("counts the tag table over every response with a filter on, as the page's table does", () => {
    const mixed = [
      resp("nps", "2026-10-01", 10, { tags: ["checkout", "refunds"] }),
      resp("nps", "2026-10-02", 2, { tags: ["refunds"] }),
      resp("nps", "2026-10-03", 3, { tags: ["refunds"] }),
    ];
    const shown = mixed.filter((r) => hasTag(r, "checkout"));
    const themesOf = (tags?: ReturnType<typeof tagCounts>) =>
      generateNpsCsatPrompts({ responses: shown, tags, by: "month", tag: "checkout" }).find(
        (p) => p.id === "nps-themes"
      )!.prompt;

    // The page's table: "refunds" over all three answers, not the one the filter keeps.
    const all = themesOf(tagCounts(mixed));
    expect(all).toContain("## Theme tags (over all responses, the tag filter aside)");
    expect(all).toContain("| refunds | 3 | 2 | — (n 3) | — |");
    expect(all).not.toContain("| refunds | 1 |");
    // The headline still reads the filtered answers.
    expect(all).toContain("NPS +100 from 1 response.");

    // Without the page's counts the table says it reads the filtered answers.
    const filtered = themesOf();
    expect(filtered).toContain("## Theme tags (within the filtered responses)");
    expect(filtered).toContain("| refunds | 1 | 0 | — (n 1) | — |");
  });
});
