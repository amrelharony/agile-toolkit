import { fmt } from "@/lib/charts/chart-text";
import { formatDay, ITERATIONS } from "./forecast";
import { signedPct, type ReleasePlan } from "./plan";
import { headlineText, lengthText, sampleText, scopeText } from "./describe";
import { releaseVerdict } from "./verdict";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const START_FROM = {
  user: "",
  sprint: " (the day after the active sprint ends)",
  today: " (today)",
};

/**
 * The forecast as Markdown, for a release update in a wiki, a ticket or a
 * stakeholder thread: the verdict, the inputs it rests on, the dates by
 * confidence and the target-date answers.
 */
export function toMarkdown(plan: ReleasePlan, now: Date = new Date()): string {
  const lines = [`# Release forecast — ${mdDate(now)}`, "", `**${releaseVerdict(plan)}**`, ""];

  lines.push(
    "## Inputs",
    "",
    "| Input | Value |",
    "|---|---|",
    `| Scope | ${md(scopeText(plan.scope))} |`,
    `| Expected scope change | ${signedPct(plan.scopeChangePct)} |`,
    `| Scope to forecast | ${plan.effective === null ? "—" : `${fmt(plan.effective)} points`} |`,
    `| Velocity | ${md(headlineText(plan))} |`,
    `| Simulation sample | ${md(sampleText(plan))} |`,
    `| Sprint length | ${md(lengthText(plan))} |`,
    `| Start | ${formatDay(plan.start.date)}${START_FROM[plan.start.from]} |`,
    ""
  );

  if (plan.rows.length > 0) {
    lines.push(
      `## When it finishes (${ITERATIONS.toLocaleString("en-US")} simulated runs)`,
      "",
      "| Confidence | Sprints | Finished by |",
      "|---:|---:|---|",
      ...plan.rows.map(
        (r) =>
          `| ${r.pct}% | ${r.sprints ?? "—"} | ${r.sprints === null ? "Not within the cap" : formatDay(r.date)} |`
      ),
      ""
    );
  }

  const t = plan.target;
  if (t) {
    lines.push(
      `## By ${formatDay(t.date)} (${t.sprints} ${t.sprints === 1 ? "sprint" : "sprints"})`,
      ""
    );
    if (t.sprints === 0) lines.push("- No full sprint fits between the start and this date.");
    else if (t.chance !== null) {
      lines.push(`- Chance of finishing the scope: ${Math.round(t.chance * 100)}%`);
    }
    if (t.deliverable) {
      lines.push(
        `- Scope the team can deliver: about ${fmt(Math.floor(t.deliverable.p50), 0)} points likely (P50), ${fmt(Math.floor(t.deliverable.p85), 0)} points to promise (P85)`
      );
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
