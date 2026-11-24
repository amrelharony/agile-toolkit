// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDES as CEREMONIES } from "@/lib/tools/guides/ceremonies";
import { GUIDES as QUALITY } from "@/lib/tools/guides/quality";

/*
 * The lead wrote these two guides before the chains built the buttons, and
 * the buttons came out with other words. A reader following How this works
 * (or saying the label to voice control) looks for the button by the name
 * the guide gives it, so the guide names both of the page's AI buttons
 * exactly as the page labels them.
 */

const guideText = (id: string) => {
  const g = [...CEREMONIES, ...QUALITY].find((x) => x.toolId === id);
  if (!g) throw new Error(`No guide for ${id}`);
  return [g.summary, ...g.steps, ...(g.tips ?? [])].join("\n");
};

/** Each `<AiButton label="…" fallbackLabel="…">` pair in a page file, in order. */
function aiLabels(file: string): { label: string; fallbackLabel: string }[] {
  const src = readFileSync(join(process.cwd(), "src/app/(tools)", file), "utf8");
  const pairs: { label: string; fallbackLabel: string }[] = [];
  // Each button's props run to the next button (an arrow's `=>` ends no tag).
  const parts = src.split(/<AiButton\b/).slice(1);
  for (const part of parts) {
    const label = /(?<![-\w])label="([^"]+)"/.exec(part)?.[1];
    const fallbackLabel = /\bfallbackLabel="([^"]+)"/.exec(part)?.[1];
    if (label && fallbackLabel) pairs.push({ label, fallbackLabel });
  }
  return pairs;
}

describe("the phase 2 guides name the AI buttons as the pages label them", () => {
  it.each([
    ["notes-to-actions", "notes-to-actions/notes-to-actions-client.tsx"],
    ["bug-triage", "bug-triage/triage-queue.tsx"],
  ])("%s", (id, file) => {
    const pairs = aiLabels(file);
    expect(pairs.length, file).toBeGreaterThan(0);
    const text = guideText(id);
    for (const { label, fallbackLabel } of pairs) {
      expect(text, label).toContain(label);
      expect(text, fallbackLabel).toContain(fallbackLabel);
    }
  });

  it("drops the names no button has", () => {
    expect(guideText("notes-to-actions")).not.toMatch(/\bFind without AI\b/);
    expect(guideText("bug-triage")).not.toMatch(/\bSuggest without AI\b/);
  });
});
