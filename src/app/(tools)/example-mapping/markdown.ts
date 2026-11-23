import type { ExampleMap } from "@/lib/stores/workspace-types";
import { gwtLines } from "@/lib/stories/fields";
import {
  VERDICT_LABEL,
  examplesOf,
  isStructured,
  mapCounts,
  mapSignals,
} from "@/lib/example-mapping/model";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * One map as Markdown: the story with its verdict and counts, the rules
 * numbered with their examples under them (a structured one as
 * Given/When/Then lines), the questions with their status, owner and
 * answer, and what the map says.
 */
export function toMarkdown(map: ExampleMap, storyTitle?: string): string {
  const c = mapCounts(map);
  const lines = [`# Example map: ${oneLine(map.title)}`, ""];
  lines.push(
    [
      storyTitle ? `Story: ${oneLine(storyTitle)}` : "Not linked to a backlog story",
      map.verdict ? `Verdict: ${VERDICT_LABEL[map.verdict]}` : "No verdict yet",
      `${plural(c.rules, "rule", "rules")}, ${plural(c.examples, "example", "examples")}, ${plural(c.open, "open question", "open questions")}`,
    ].join(" · "),
    ""
  );

  lines.push("## Rules", "");
  if (map.rules.length === 0) lines.push("No rules yet.", "");
  map.rules.forEach((r, i) => {
    lines.push(`${i + 1}. ${oneLine(r.text)}`);
    for (const e of examplesOf(map, r.id)) {
      lines.push(`   - ${oneLine(e.text)}`);
      if (isStructured(e)) {
        for (const g of gwtLines([
          { id: e.id, given: e.given ?? "", when: e.when ?? "", then: e.then ?? "" },
        ])) {
          lines.push(`     - ${g}`);
        }
      }
    }
  });
  if (map.rules.length > 0) lines.push("");

  lines.push("## Questions", "");
  if (map.questions.length === 0) lines.push("No questions.", "");
  for (const q of map.questions) {
    const owner = q.owner ? ` (${oneLine(q.owner)})` : "";
    lines.push(`- [${q.status}] ${oneLine(q.text)}${owner}`);
    if (q.answer) lines.push(`  - Answer: ${oneLine(q.answer)}`);
  }
  if (map.questions.length > 0) lines.push("");

  const signals = mapSignals(map);
  if (signals.length > 0) {
    lines.push("## What the map says", "");
    for (const s of signals) lines.push(`- ${s.text}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}
