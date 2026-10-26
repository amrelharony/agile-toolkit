import type {
  CharterCheckInResult,
  TeamMember,
  WorkingAgreement,
} from "@/lib/stores/workspace-types";
import {
  adherenceCount,
  adherencePhrase,
  checkInAdherence,
  checkInTrend,
  consentLine,
  consentOf,
  dayLabel,
  diffIsEmpty,
  diffVersions,
  draftRules,
  lastCheckIn,
  latestVersion,
  type VersionDiff,
} from "@/lib/working-agreement/model";
import { CATEGORIES } from "./catalog";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
/** A table cell: one line, with pipes escaped so they don't split the cell. */
const cell = (v: string | number) => oneLine(String(v)).replace(/\|/g, "\\|");

/** The changes in a diff as Markdown bullets; [] when there are none. */
export function diffLines(diff: VersionDiff): string[] {
  return [
    ...diff.added.map((r) => `- Added: ${oneLine(r.text)}`),
    ...diff.removed.map((r) => `- Removed: ${oneLine(r.text)}`),
    ...diff.reworded.map((c) => `- Reworded: ${oneLine(c.before.text)} → ${oneLine(c.after.text)}`),
    ...diff.recategorised.map(
      (c) => `- Moved: ${oneLine(c.after.text)} (${c.before.category} → ${c.after.category})`
    ),
    ...diff.redescribed.map((c) => `- Description changed: ${oneLine(c.after.text)}`),
  ];
}

export interface AgreementMarkdownOptions {
  /** The page's one-sentence verdict, quoted under the title. */
  verdict?: string;
  sprintName?: (id: string | undefined) => string | undefined;
}

/**
 * The charter as Markdown: the rules by category with each one's consent,
 * the saved check-ins as a table, the published versions, and what changed
 * since the latest one.
 */
export function agreementMarkdown(
  doc: WorkingAgreement,
  roster: readonly Pick<TeamMember, "name">[],
  { verdict, sprintName = () => undefined }: AgreementMarkdownOptions = {}
): string {
  const title = doc.meta.teamName ? `${doc.meta.teamName} working agreement` : "Working agreement";
  const lines = [`# ${oneLine(title)}`, ""];
  const version =
    doc.meta.version > 0
      ? `Version ${doc.meta.version}${doc.meta.publishedAt ? `, published ${dayLabel(doc.meta.publishedAt, true)}` : ""}`
      : "Not published yet";
  lines.push(version, "");
  if (verdict) lines.push(`> ${oneLine(verdict)}`, "");
  if (doc.meta.description) lines.push(oneLine(doc.meta.description), "");

  if (doc.rules.length === 0) {
    lines.push("No rules agreed yet.");
    return `${lines.join("\n")}\n`;
  }

  for (const cat of CATEGORIES) {
    const rules = doc.rules.filter((r) => r.category === cat.id);
    if (rules.length === 0) continue;
    lines.push(`## ${cat.label}`, "");
    for (const r of rules) {
      const c = consentOf(r, roster);
      lines.push(`- ${oneLine(r.text)} — ${consentLine(c)}`);
      if (r.description) lines.push(`  ${oneLine(r.description)}`);
    }
    lines.push("");
  }

  const trend = checkInTrend(doc);
  if (trend.length > 0) {
    lines.push(
      "## Check-ins",
      "",
      "| Date | Version | Sprint | Working | Adherence |",
      "| --- | --- | --- | --- | --- |",
      ...trend.map(
        (t) =>
          `| ${cell(t.date)} | v${t.version} | ${cell(sprintName(t.sprintId) ?? "—")} | ${adherenceCount(t)} | ${t.pct === null ? "—" : `${t.pct}%`} |`
      ),
      ""
    );
    const last = lastCheckIn(doc);
    if (last) {
      const found = (result: CharterCheckInResult) =>
        Object.entries(last.results)
          .filter(([, v]) => v === result)
          .map(([id]) => doc.rules.find((r) => r.id === id)?.text ?? last.ruleTexts?.[id] ?? id);
      const broken = found("not_working");
      const partly = found("partly");
      const a = checkInAdherence(last);
      if (broken.length > 0) {
        lines.push(
          `Not working in the last check-in (${adherencePhrase(a)}): ${broken.map(oneLine).join("; ")}.`
        );
      }
      if (partly.length > 0) {
        lines.push(
          `${broken.length > 0 ? "Partly working" : `Partly working in the last check-in (${adherencePhrase(a)})`}: ${partly.map(oneLine).join("; ")}.`
        );
      }
      if (broken.length === 0 && partly.length === 0) {
        lines.push(`Every rule checked in the last check-in is working.`);
      }
      lines.push("");
    }
  }

  const versions = doc.versions ?? [];
  if (versions.length > 0) {
    lines.push("## Versions", "");
    for (const v of [...versions].reverse()) {
      lines.push(`- v${v.version}, ${dayLabel(v.publishedAt, true)}: ${v.rules.length} rules`);
    }
    lines.push("");
  }
  const latest = latestVersion(doc);
  if (latest) {
    const diff = diffVersions(latest.rules, draftRules(doc));
    if (!diffIsEmpty(diff)) {
      lines.push(`## Changes since v${latest.version}`, "", ...diffLines(diff), "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
