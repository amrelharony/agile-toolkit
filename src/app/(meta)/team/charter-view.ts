/**
 * The team charter as plain data: what each standing agreement holds, one
 * status line per card, and the whole charter as Markdown. Pure.
 */

import type { Story, TeamMember, WorkingAgreement } from "@/lib/stores/workspace-types";
import { CEREMONY_LABEL, WEEKDAY_LABEL, type CeremonyCadence } from "@/lib/sprints/cadence";
import { scales } from "@/lib/constants/scales";
import { isExampleId } from "@/components/tool-frame/example-data";
import { defaultDescription, entryKey, readEntry } from "@/app/(tools)/estimation-guide/entries";
import { isExampleNote } from "@/app/(tools)/estimation-guide/example";
import {
  pinDrift,
  pinnedIds,
  resolveReferenceStories,
} from "@/app/(tools)/estimation-guide/references";
import { dorCheckHistory } from "@/app/(tools)/refinement/session";
import type { StorySave } from "@/app/(tools)/refinement/store";
import type { DodDoc } from "@/app/(tools)/dod-builder/summary";

export interface DorDoc {
  criteria: { id: string; label: string; description?: string }[];
  /**
   * Checks saved by name, newest first: how stories were checked before the
   * refinement session read the backlog, and still the way to check one
   * that isn't in it. The session's checks live on the stories.
   */
  history: readonly StorySave[];
}

export interface EstimationDoc {
  selectedScale: string;
  descriptions: Record<string, string>;
  examples: Record<string, string>;
  /**
   * Done stories pinned as each card's reference ("Fibonacci:8" → story
   * ids, see estimation-guide/references). Optional: guides saved before
   * pins existed have none.
   */
  referenceStoryIds?: Record<string, string[]>;
}

export interface CharterDocs {
  members: readonly TeamMember[];
  cadence: CeremonyCadence;
  agreement: WorkingAgreement | undefined;
  dod: DodDoc;
  dor: DorDoc;
  estimation: EstimationDoc;
  /**
   * The workspace's stories: the Definition of Ready checks on them
   * (`Story.readiness`) and the titles of the guide's pinned reference
   * stories. Without them, only the checks saved by name count.
   */
  stories?: readonly Story[];
}

/** One card of the estimation scale and the team's reference stories pinned on it. */
export interface BaselineReferences {
  /** The card, e.g. "8". */
  value: string;
  /** In pin order. `drift` says why a pin no longer reads as the card ("now 5 pts"). */
  stories: { id: string; title: string; drift: string | null }[];
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
  /** The estimation baseline's pinned reference stories, card by card (none: absent). */
  references?: BaselineReferences[];
  /** Nothing agreed yet. */
  empty: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const scaleOf = (doc: EstimationDoc) =>
  scales.find((s) => s.name === doc.selectedScale) ?? scales[0];

/**
 * The team example on a card, or "" when there is none or it still reads
 * exactly as the guide's example wrote it: that text is the example's, not
 * the team's, and the charter only holds what the team agreed.
 */
function teamExample(doc: EstimationDoc, scale: string, value: string | number): string {
  const text = readEntry(doc.examples ?? {}, scale, value);
  return isExampleNote(entryKey(scale, value), text) ? "" : text;
}

/**
 * The team's reference stories on each card of the scale, in scale order;
 * cards without one are left out. Example pins ("example-" ids, from the
 * guide's example) aren't the team's, and a pin whose story isn't in the
 * workspace (deleted, or not loaded yet) has no title to show, so neither
 * is listed; the guide keeps both pins as they are.
 */
export function baselineReferences(
  doc: EstimationDoc,
  stories: readonly Story[] = []
): BaselineReferences[] {
  const scale = scaleOf(doc);
  const out: BaselineReferences[] = [];
  for (const v of scale.values) {
    const ids = pinnedIds(doc.referenceStoryIds, scale.name, v).filter((id) => !isExampleId(id));
    const pinned = resolveReferenceStories(ids, stories);
    if (pinned.length === 0) continue;
    out.push({
      value: String(v),
      stories: pinned.map((s) => ({ id: s.id, title: s.title, drift: pinDrift(s, v) })),
    });
  }
  return out;
}

/** The scale the baseline is on, with how many values the team described in its own words
 *  (the built-in meanings don't count), how many have a team example, and the reference
 *  stories pinned on them (see `baselineReferences`). */
export function estimationCoverage(
  doc: EstimationDoc,
  stories: readonly Story[] = []
): {
  scale: string;
  values: number;
  described: number;
  examples: number;
  /** Reference stories pinned, across `pinnedCards` cards. */
  references: number;
  pinnedCards: number;
} {
  const scale = scaleOf(doc);
  let described = 0;
  let examples = 0;
  for (const v of scale.values) {
    const d = readEntry(doc.descriptions ?? {}, scale.name, v).trim();
    if (d && d !== defaultDescription(v).trim()) described++;
    if (teamExample(doc, scale.name, v).trim()) examples++;
  }
  const pinned = baselineReferences(doc, stories);
  return {
    scale: scale.name,
    values: scale.values.length,
    described,
    examples,
    references: pinned.reduce((n, card) => n + card.stories.length, 0),
    pinnedCards: pinned.length,
  };
}

/** How many of the latest checks the Definition of Ready card averages. */
export const DOR_RECENT_CHECKS = 10;

/**
 * The Definition of Ready pass rate over the latest `n` checks, from the
 * same records the Refinement page charts (refinement/session.ts
 * `passRateRecords`): each workspace story's latest readiness, newest by
 * its `updatedAt` and counted against today's criteria, and the checks
 * saved by name. A check sent to the backlog counts once, as its story.
 * Example stories and checks ("example-" ids) are the tool's sample
 * session, not the team's, so they never count. Null with no checks.
 */
export function dorPassRate(
  dor: DorDoc,
  stories: readonly Story[] = [],
  n = DOR_RECENT_CHECKS
): { rate: number; checks: number } | null {
  const recent = dorCheckHistory(
    stories.filter((s) => !isExampleId(s.id)),
    dor.history.filter((h) => !isExampleId(h.id)),
    dor.criteria
  )
    .filter((h) => Number.isFinite(h.passRate))
    .slice(0, n);
  const rate = recentPassRate(recent, n);
  return rate === null ? null : { rate, checks: recent.length };
}

/** Mean pass rate of the latest `n` checks (newest first), or null. */
export function recentPassRate(
  history: readonly { passRate: number }[],
  n = DOR_RECENT_CHECKS
): number | null {
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
  const pass = dorPassRate(docs.dor, docs.stories);
  const dor: CharterCard = {
    id: "dor",
    title: "Definition of Ready",
    toolId: "refinement",
    href: "/refinement",
    empty: criteria.length === 0,
    status: criteria.length === 0 ? "No checks yet" : plural(criteria.length, "check"),
    detail:
      pass === null
        ? undefined
        : `${pass.rate}% pass rate over the last ${plural(pass.checks, "story", "stories")}`,
  };

  const cov = estimationCoverage(docs.estimation, docs.stories);
  const references = baselineReferences(docs.estimation, docs.stories);
  // The guide keeps a team example (free text) and pinned done stories
  // apart, so the card names them apart too.
  const baseline = [
    cov.examples > 0 ? plural(cov.examples, "team example") : "",
    cov.references > 0
      ? `${plural(cov.references, "reference story", "reference stories")} on ${plural(cov.pinnedCards, "card")}`
      : "",
  ].filter(Boolean);
  const estimation: CharterCard = {
    id: "estimation",
    title: "Estimation baseline",
    toolId: "estimation-guide",
    href: "/estimation-guide",
    empty: cov.described === 0 && cov.examples === 0 && cov.references === 0,
    status:
      cov.described === 0
        ? `${cov.scale} · built-in meanings only`
        : `${cov.scale} · ${cov.described} of ${cov.values} values in the team's words`,
    detail: baseline.length > 0 ? baseline.join(" · ") : undefined,
    references: references.length > 0 ? references : undefined,
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
  const scale = scaleOf(docs.estimation);
  const pinned = new Map(
    baselineReferences(docs.estimation, docs.stories).map((card) => [card.value, card.stories])
  );
  const cell = (s: string) => oneLine(s).replace(/\|/g, "\\|");
  lines.push(
    `Scale: ${scale.name}`,
    "",
    "| Value | Means | Team example | Reference stories |",
    "|---|---|---|---|"
  );
  for (const v of scale.values) {
    const d = readEntry(docs.estimation.descriptions ?? {}, scale.name, v);
    const e = teamExample(docs.estimation, scale.name, v);
    const refs = (pinned.get(String(v)) ?? [])
      .map((s) => `${s.title}${s.drift ? ` (${s.drift})` : ""}`)
      .join("; ");
    lines.push(`| ${v} | ${cell(d)} | ${cell(e)} | ${cell(refs)} |`);
  }

  return `${lines.join("\n")}\n`;
}
