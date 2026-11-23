import type { AbTest } from "@/lib/stores/workspace-types";
import {
  HOW_TO_READ,
  liftText,
  pText,
  percentText,
  pointsText,
  rateText,
} from "@/lib/experiments/ab";
import { DECISION_LABEL, STATUS_LABEL, countText, testSummary } from "@/lib/experiments/model";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
/** A table cell: one line, its pipes escaped. */
const cell = (s: string) => oneLine(s).replace(/\|/g, "\\|");

/** "+20% of the baseline" or "+2.0 points". */
export function changeText(t: Pick<AbTest, "plan">): string {
  return t.plan.mdeMode === "relative"
    ? `${liftText(t.plan.mde)} of the current rate`
    : `${pointsText(t.plan.mde)} points`;
}

/** "95% confidence, 80% power, two-sided". */
export const planSettingsText = (t: Pick<AbTest, "plan">) =>
  `${percentText(t.plan.confidence)} confidence, ${percentText(t.plan.power)} power, ${t.plan.sided === "two" ? "two-sided" : "one-sided"}`;

/**
 * The saved tests as Markdown, one section per test: its plan (inputs, the
 * people each version needs and how long), each version's counts and rate
 * with its interval, B against A with the intervals and p, the verdict
 * ("Too early to call" below the plan), the split check, guardrails, the
 * decision and its note, then the two lines of "How to read this".
 */
export function testsToMarkdown(tests: readonly AbTest[]): string {
  const lines = ["# A/B tests", ""];
  if (tests.length === 0) {
    lines.push("No saved tests yet.");
    return `${lines.join("\n")}\n`;
  }
  for (const t of tests) lines.push(...testLines(t), "");
  lines.push("## How to read this", "", ...HOW_TO_READ.map((l) => `- ${l}`));
  return `${lines.join("\n").trimEnd()}\n`;
}

function testLines(t: AbTest): string[] {
  const s = testSummary(t);
  const out = [`## ${oneLine(t.name) || "Untitled test"}`, ""];
  const item = (term: string, value: string | undefined) => {
    const text = oneLine(value ?? "");
    if (text) out.push(`- **${term}:** ${text}`);
  };
  item("Status", STATUS_LABEL[t.status] ?? t.status);
  item("Question", t.question);
  item("Metric", t.metricName);
  item(
    "Plan",
    `${rateText(t.plan.baseline)} today, smallest change worth finding ${changeText(t)}; ${planSettingsText(t)}`
  );
  if (s.plan) {
    const run = s.plan.run
      ? `, ${s.plan.run.days} days at ${countText(t.plan.dailyTraffic ?? 0)} visitors a day (${s.plan.run.weeks} ${s.plan.run.weeks === 1 ? "week" : "weeks"})`
      : "";
    item(
      "Sample",
      `${countText(s.plan.perVariant)} people a version, ${countText(s.plan.total)} in all${run}`
    );
  }
  const days = [
    t.startedOn ? `started ${t.startedOn}` : null,
    t.endedOn ? `ended ${t.endedOn}` : null,
  ].filter(Boolean);
  if (days.length > 0) item("Days", days.join(" · "));
  const r = s.result;
  if (r) {
    const level = percentText(r.analysis.level);
    out.push(
      "",
      `| Variant | Visitors | Conversions | Rate (${level} interval) |`,
      "| --- | ---: | ---: | --- |"
    );
    const [a, b] = t.variants;
    for (const [v, reading] of [
      [a, r.analysis.a],
      [b, r.analysis.b],
    ] as const) {
      out.push(
        `| ${cell(v.name || v.id)} | ${countText(reading.visitors)} | ${countText(reading.conversions)} | ${rateText(reading.rate)} (${rateText(reading.interval[0])} to ${rateText(reading.interval[1])}) |`
      );
    }
    out.push("");
    const [dl, dh] = r.analysis.differenceInterval;
    item(
      "Difference",
      `${pointsText(r.analysis.difference)} points (${level} interval ${pointsText(dl)} to ${pointsText(dh)})`
    );
    if (r.analysis.lift !== null && r.analysis.liftInterval) {
      const [ll, lh] = r.analysis.liftInterval;
      item(
        "Lift",
        `${liftText(r.analysis.lift)} (${level} interval ${liftText(ll)} to ${liftText(lh)})`
      );
    }
    item("p", `${pText(r.analysis.p)}${r.analysis.sided === "one" ? " (one-sided)" : ""}`);
    item("Verdict", r.verdict);
    if (r.note) item("Note", r.note);
    item(
      "Split check",
      r.splitWarning ?? `p ${pText(r.analysis.split.p)}: the split is as even as planned.`
    );
  } else {
    item("Result", "No counts yet.");
  }
  if (t.guardrails && t.guardrails.length > 0) {
    item(
      "Guardrails",
      t.guardrails.map((g) => (g.why ? `${g.name} (${g.why})` : g.name)).join("; ")
    );
  }
  item("Decision", t.decision ? DECISION_LABEL[t.decision] : undefined);
  item("Note", t.note);
  return out;
}
