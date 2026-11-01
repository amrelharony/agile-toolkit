// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateKanoPrompts } from "@/lib/ai-prompts/kano-model";
import { kanoRows } from "@/app/(tools)/kano-model/model";
import { kanoVerdict } from "@/app/(tools)/kano-model/verdict";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * The Kano prompt reads the features as the page does: each category from
 * the answer counts (the most common class, from 3 answers), the A / O / M
 * / I / R / Q counts, Better and Worse from 3 answers that count toward
 * them, one person's answer pair and a category picked by hand marked as
 * such, never a default category.
 */

const row = (id: string, title: string, fields: Record<string, number | string>) =>
  ({
    id,
    framework: "kano",
    title,
    fields,
    status: "open",
    updatedAt: "2026-10-20T09:00:00.000Z",
  }) satisfies PrioritizationItem;

const ranked = kanoRows([
  row("dark", "Dark mode", { kanoA: 6, kanoO: 1, kanoI: 3 }),
  row("sso", "SSO", { kanoA: 1, kanoO: 2, kanoM: 8, kanoI: 1 }),
  row("export", "Export", { kanoA: 1, kanoM: 1 }),
  row("sounds", "Sounds", { functional: "like", dysfunctional: "dislike" }),
  // Picked by hand on the old page.
  row("legacy", "Badges", { category: "attractive" }),
  row("blank", "Widgets", {}),
]);

describe("generateKanoPrompts", () => {
  const [p] = generateKanoPrompts({ rows: ranked }, null);

  it("states each category from the counts, with Better and Worse", () => {
    expect(p.prompt).toContain(
      "| Feature | Category | How answered | A | O | M | I | R | Q | Better | Worse | Note |"
    );
    expect(p.prompt).toContain(
      "| SSO | Must-be | 12 answers | 1 | 2 | 8 | 1 | 0 | 0 | 0.25 | -0.83 | — |"
    );
    expect(p.prompt).toContain(
      "| Dark mode | Attractive | 10 answers | 6 | 1 | 0 | 3 | 0 | 0 | 0.7 | -0.1 | — |"
    );
  });

  it("marks too few answers, one person's pair and a hand-picked category", () => {
    expect(p.prompt).toContain(
      "| Export | Needs more answers | 2 answers | 1 | 0 | 1 | 0 | 0 | 0 | — | — | Better and Worse from 3 answers, not counting Reverse or Questionable (2 so far) |"
    );
    expect(p.prompt).toContain(
      "| Sounds | Performance | One person's answers: I like it / I dislike it | — | — | — | — | — | — | — | — | — |"
    );
    expect(p.prompt).toContain(
      "| Badges | Attractive | Picked by hand | — | — | — | — | — | — | — | — | Picked by hand: add answers to derive the category. |"
    );
    expect(p.prompt).toContain("| Widgets | Not answered | Not answered |");
  });

  it("lists expected features first, with the page's verdict", () => {
    expect(p.prompt.indexOf("| SSO |")).toBeLessThan(p.prompt.indexOf("| Dark mode |"));
    expect(p.prompt.indexOf("| Dark mode |")).toBeLessThan(p.prompt.indexOf("| Widgets |"));
    expect(p.prompt).toContain(`Verdict: ${kanoVerdict(ranked)}`);
  });

  it("has nothing to ask without features", () => {
    expect(generateKanoPrompts({ rows: [] })).toEqual([]);
  });
});
