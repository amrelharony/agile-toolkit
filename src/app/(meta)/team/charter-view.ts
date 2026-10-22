/**
 * The team charter as plain data: what each standing agreement holds, one
 * status line per card, and the whole charter as Markdown. Pure.
 */

import type { TeamMember, WorkingAgreement } from "@/lib/stores/workspace-types";
import { CEREMONY_LABEL, WEEKDAY_LABEL, type CeremonyCadence } from "@/lib/sprints/cadence";
import { scales } from "@/lib/constants/scales";
import { defaultDescription, readEntry } from "@/app/(tools)/estimation-guide/entries";
import type { DodDoc } from "@/app/(tools)/dod-builder/summary";

export interface DorDoc {
  criteria: { id: string; label: string; description?: string }[];
  /** Saved checks, newest first. */
  history: { passRate: number; date: string; storyName: string }[];
}

export interface EstimationDoc {
  selectedScale: string;
  descriptions: Record<string, string>;
  examples: Record<string, string>;
}

export interface CharterDocs {
  members: readonly TeamMember[];
  cadence: CeremonyCadence;
  agreement: WorkingAgreement | undefined;
  dod: DodDoc;
  dor: DorDoc;
  estimation: EstimationDoc;
}

export type CharterCardId = "agreement" | "dod" | "dor" | "estimation";

export interface CharterCard {
  id: CharterCardId;
  title: string;
  /** The tool that edits it. */
  toolId: string;
  href: string;
  /** One line on what's there. */
  status: string;
  /** A second line, when there is more to say. */
  detail?: string;
  /** Nothing agreed yet. */
  empty: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The scale the baseline is on, with how many values the team described in its own words
 *  (the built-in meanings don't count) and how many have a reference story. */
export function estimationCoverage(doc: EstimationDoc): {
  scale: string;
  values: number;
  described: number;
  examples: number;
} {
  const scale = scales.find((s) => s.name === doc.selectedScale) ?? scales[0];
  let described = 0;
  let examples = 0;
  for (const v of scale.values) {
    const d = readEntry(doc.descriptions ?? {}, scale.name, v).trim();
    if (d && d !== defaultDescription(v).trim()) described++;
    if (readEntry(doc.examples ?? {}, scale.name, v).trim()) examples++;
  }
  return { scale: scale.name, values: scale.values.length, described, examples };
}

/** Mean pass rate of the latest `n` saved checks, or null. */
export function recentPassRate(history: DorDoc["history"], n = 10): number | null {
  const recent = history
    .slice(0, n)
    .map((h) => h.passRate)
    .filter((p) => Number.isFinite(p));
  if (recent.length === 0) return null;
  return Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
}

export function charterCards(docs: CharterDocs): CharterCard[] {
  const rules = docs.agreement?.rules ?? [];
  const agreed = rules.filter((r) => r.agreedBy.length > 0).length;
  const version = docs.agreement?.meta?.version;
  const agreement: CharterCard = {
    id: "agreement",
    title: "Working agreement",
    toolId: "working-agreement",
    href: "/working-agreement",
    empty: rules.length === 0,
    status:
      rules.length === 0
        ? "No rules agreed yet"
        : `${plural(rules.length, "rule")} · ${agreed} agreed by name`,
    detail:
      rules.length > 0 && typeof version === "number"
        ? `Version ${version}${docs.agreement?.meta?.publishedAt ? `, published ${docs.agreement.meta.publishedAt.slice(0, 10)}` : ""}`
        : undefined,
  };

  const items = docs.dod.items;
  const required = items.filter((i) => i.required).length;
  const last = docs.dod.history[docs.dod.history.length - 1];
  const dod: CharterCard = {
    id: "dod",
    title: "Definition of Done",
    toolId: "dod-builder",
    href: "/dod-builder",
    empty: items.length === 0,
    status:
      items.length === 0
        ? "Not written yet"
        : `${plural(items.length, "criterion", "criteria")} · ${required} required`,
    detail: last
      ? `Last check: ${last.sprintName}, ${last.completed} of ${last.totalRequired} required met`
      : undefined,
  };

  const criteria = docs.dor.criteria;
  const rate = recentPassRate(docs.dor.history);
  const dor: CharterCard = {
    id: "dor",
    title: "Definition of Ready",
    toolId: "refinement",
    href: "/refinement",
    empty: criteria.length === 0,
    status: criteria.length === 0 ? "No checks yet" : plural(criteria.length, "check"),
    detail:
      rate === null
        ? undefined
        : `${rate}% pass rate over the last ${plural(Math.min(10, docs.dor.history.length), "story", "stories")}`,
  };

  const cov = estimationCoverage(docs.estimation);
  const estimation: CharterCard = {
    id: "estimation",
    title: "Estimation baseline",
    toolId: "estimation-guide",
    href: "/estimation-guide",
    empty: cov.described === 0 && cov.examples === 0,
    status:
      cov.described === 0
        ? `${cov.scale} · built-in meanings only`
        : `${cov.scale} · ${cov.described} of ${cov.values} values in the team's words`,
    detail:
      cov.examples > 0
        ? `${plural(cov.examples, "reference story", "reference stories")}`
        : undefined,
  };

  return [agreement, dod, dor, estimation];
}

function cadenceLines(c: CeremonyCadence): string[] {
  const days = [1, 2, 3, 4, 5, 6, 0]
    .filter((d) => c.dailyWeekdays.includes(d))
    .map((d) => WEEKDAY_LABEL[d]);
  const lines = [
    `- ${CEREMONY_LABEL.daily}: ${c.dailyTime}, ${days.join(", ") || "no fixed days"}`,
    `- ${CEREMONY_LABEL.planning}: ${c.planningTime} on the first day`,
    `- ${CEREMONY_LABEL.review}: ${c.reviewTime} on the last day`,
    `- ${CEREMONY_LABEL.retro}: ${c.retroTime} on the last day`,
  ];
  lines.push(
    c.refinement
      ? `- ${CEREMONY_LABEL.refinement}: ${WEEKDAY_LABEL[c.refinement.weekday]} ${c.refinement.time}`
      : `- ${CEREMONY_LABEL.refinement}: no fixed slot`
  );
  lines.push(`- Sprint length: ${c.sprintLengthDays} days`);
  return lines;
}

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

/** The whole charter as one Markdown document. */
export function charterMarkdown(docs: CharterDocs, today: string): string {
  const teamName = docs.agreement?.meta?.teamName?.trim();
  const lines = [
    `# ${teamName ? `${teamName} — team charter` : "Team charter"}`,
    "",
    `As of ${today}.`,
    "",
  ];

  lines.push("## Team", "");
  if (docs.members.length === 0) lines.push("No members listed yet.");
  else {
    for (const m of docs.members) {
      const meta = [
        m.role?.trim(),
        typeof m.capacityPct === "number" ? `${m.capacityPct}% capacity` : null,
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(`- ${oneLine(m.name)}${meta ? ` (${meta})` : ""}`);
    }
  }

  lines.push("", "## Ceremonies", "", ...cadenceLines(docs.cadence));

  lines.push("", "## Working agreement", "");
  const rules = docs.agreement?.rules ?? [];
  if (rules.length === 0) lines.push("No rules agreed yet.");
  else {
    for (const r of rules) {
      lines.push(
        `- ${oneLine(r.text)}${r.category ? ` _(${r.category})_` : ""}${
          r.agreedBy.length > 0 ? ` — agreed by ${r.agreedBy.map(oneLine).join(", ")}` : ""
        }`
      );
    }
  }

  lines.push("", "## Definition of Ready", "");
  if (docs.dor.criteria.length === 0) lines.push("No checks yet.");
  else for (const c of docs.dor.criteria) lines.push(`- ${oneLine(c.label)}`);

  lines.push("", "## Definition of Done", "");
  if (docs.dod.items.length === 0) lines.push("Not written yet.");
  else {
    const byCategory = new Map<string, typeof docs.dod.items>();
    for (const i of docs.dod.items) {
      const list = byCategory.get(i.category) ?? [];
      list.push(i);
      byCategory.set(i.category, list);
    }
    for (const [category, items] of Array.from(byCategory.entries())) {
      lines.push(`**${category.charAt(0).toUpperCase()}${category.slice(1)}**`);
      for (const i of items)
        lines.push(`- ${oneLine(i.label)}${i.required ? "" : " _(optional)_"}`);
      lines.push("");
    }
    lines.pop();
  }

  lines.push("", "## Estimation baseline", "");
  const cov = estimationCoverage(docs.estimation);
  const scale = scales.find((s) => s.name === cov.scale) ?? scales[0];
  lines.push(`Scale: ${scale.name}`, "", "| Value | Means | Reference story |", "|---|---|---|");
  for (const v of scale.values) {
    const d = readEntry(docs.estimation.descriptions ?? {}, scale.name, v);
    const e = readEntry(docs.estimation.examples ?? {}, scale.name, v);
    lines.push(
      `| ${v} | ${oneLine(d).replace(/\|/g, "\\|")} | ${oneLine(e).replace(/\|/g, "\\|")} |`
    );
  }

  return `${lines.join("\n")}\n`;
}
