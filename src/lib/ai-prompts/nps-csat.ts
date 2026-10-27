import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { NpsResponse } from "../stores/workspace-types";
import { MIN_SAMPLE } from "../analytics/min-sample";
import {
  periodSeries,
  summarizeCsat,
  summarizeNps,
  tagCounts,
  type CsatSummary,
  type NpsSummary,
  type SurveyPeriod,
  type TagCount,
} from "../nps/score";
import { periodTrendText } from "@/app/(tools)/nps-csat/chart-text";
import { tagCsatText, tagNpsText } from "@/app/(tools)/nps-csat/tags";

/**
 * The survey as the NPS / CSAT page shows it: the responses on screen (the
 * tag filter applied, and which tag it is), the period it buckets them by,
 * the day the periods run on to, and the page's verdict.
 */
interface NpsCsatData {
  responses: readonly NpsResponse[];
  /**
   * The page's tag table: tagCounts over every response, the tag filter
   * aside, so a tag reads the same n and scores here as on the page.
   * Counted from `responses` when absent.
   */
  tags?: readonly TagCount[];
  by: SurveyPeriod;
  /** "YYYY-MM-DD": the periods run on to today's, so quiet recent ones show as empty. */
  today?: string;
  tag?: string | null;
  verdict?: string;
}

/** The most verbatims quoted, newest first. */
const MAX_VERBATIMS = 30;
/** The most periods and tags listed. */
const MAX_PERIODS = 24;
const MAX_TAGS = 20;

const signed = (v: number) => (v > 0 ? `+${v}` : String(v));
const responsesText = (n: number) => (n === 1 ? "1 response" : `${n} responses`);

/**
 * "NPS +20 from 10 responses. CSAT 80% satisfied (4–5) from 10 responses."
 * A survey with no answers of a kind says so: never NPS 0, a score nobody
 * gave.
 */
function headline(nps: NpsSummary, csat: CsatSummary): string {
  const npsText =
    nps.score === null
      ? "No NPS responses."
      : `NPS ${signed(nps.score)} from ${responsesText(nps.n)}.`;
  const csatText =
    csat.satisfiedPct === null
      ? "No CSAT responses."
      : `CSAT ${csat.satisfiedPct}% satisfied (4–5) from ${responsesText(csat.n)}.`;
  return `${npsText} ${csatText}`;
}

/** The split behind each number: "4 promoters, 4 passives, 2 detractors; CSAT average 4.1 of 5". */
function breakdown(nps: NpsSummary, csat: CsatSummary): string {
  const parts: string[] = [];
  if (nps.n > 0) {
    parts.push(
      `NPS: ${nps.promoters} promoters (9–10), ${nps.passives} passives (7–8), ${nps.detractors} detractors (0–6)`
    );
  }
  if (csat.n > 0 && csat.average !== null) {
    parts.push(`CSAT: ${csat.satisfied} of ${csat.n} satisfied, average ${csat.average} of 5`);
  }
  return parts.length > 0 ? `${parts.join("; ")}.` : "";
}

/** `- 2026-10-02, CSAT 2 [checkout]: "Charged twice"`, newest first. */
function verbatimLines(responses: readonly NpsResponse[]): string[] {
  return responses
    .filter((r) => r.verbatim?.trim())
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, MAX_VERBATIMS)
    .map((r) => {
      // Verbatims are written by external customers: the highest
      // injection-risk surface in the toolkit. Each is sanitised (newlines
      // collapsed, backticks and delimiter literals stripped) and clamped
      // at 400 characters so one rant can't take the prompt's budget.
      const tags = r.tags?.length
        ? ` [${r.tags.map((t) => sanitizePromptCell(t, 40)).join(", ")}]`
        : "";
      const day = String(r.date ?? "").slice(0, 10) || "no date";
      return `- ${day}, ${r.kind.toUpperCase()} ${r.score}${tags}: "${sanitizePromptCell(r.verbatim as string, 400)}"`;
    });
}

/**
 * The NPS / CSAT prompts with the page's numbers (lib/nps): NPS from
 * summarizeNps (no answers reads "No NPS responses", never 0), CSAT as the
 * % satisfied (4–5) of summarizeCsat, each with its n; every week or month
 * with its n, the thin ones marked; the theme tags with their own scores
 * from MIN_SAMPLE.surveyPeriod answers; and the newest verbatims.
 */
export function generateNpsCsatPrompts(data: NpsCsatData): PromptDefinition[] {
  const { responses, by } = data;
  if (responses.length === 0) return [];
  const nps = summarizeNps(responses);
  const csat = summarizeCsat(responses);
  const series = periodSeries(responses, by, data.today ? { through: data.today } : {});
  const trend = periodTrendText(series.points.slice(-MAX_PERIODS), by);
  const tag = data.tag?.trim() ? sanitizePromptCell(data.tag, 40) : "";
  // The tag is user-typed: the preamble only says a filter is on, and the
  // wrapped data names it.
  const scope = tag
    ? "A tag filter is on: these numbers read only the responses with that tag (named in the data). "
    : "";
  const filter = tag ? `Tag filter: only the responses tagged “${tag}”.\n\n` : "";
  const context = `${scope}${headline(nps, csat)} ${breakdown(nps, csat)}`.trim();
  const notes = [
    series.undated > 0
      ? `${responsesText(series.undated)} with no valid date: counted, in no period.`
      : "",
    series.offScale > 0
      ? `${responsesText(series.offScale)} with a score off the scale: left out.`
      : "",
  ].filter(Boolean);
  const verdict = data.verdict ? `Verdict: ${sanitizePromptCell(data.verdict, 400)}\n\n` : "";

  const periodTable =
    series.points.length === 0
      ? "No dated responses."
      : `${formatTable(
          trend.table.columns,
          trend.table.rows.map((r) => r.map(String))
        )}\n\n${trend.summary}`;
  const periodsBlock = `## By ${by}\n\nA period with fewer than ${MIN_SAMPLE.surveyPeriod} responses of a kind is marked: one answer moves it by 100 ÷ n points.\n\n${periodTable}${
    notes.length > 0 ? `\n\n${notes.join(" ")}` : ""
  }`;

  const tags = (data.tags ?? tagCounts(responses)).slice(0, MAX_TAGS);
  const tagTable =
    tags.length === 0
      ? "No response is tagged yet."
      : formatTable(
          ["Tag", "Responses", "Unhappy", "NPS", "CSAT % satisfied"],
          tags.map((t) => [t.tag, t.n, t.unhappy, tagNpsText(t), tagCsatText(t)])
        );
  // With a tag filter on, the headline reads that tag's answers alone; the
  // page's tag table (passed as `tags`) still reads every response.
  const tagScope = !tag
    ? ""
    : data.tags
      ? " (over all responses, the tag filter aside)"
      : " (within the filtered responses)";
  const tagsBlock = `## Theme tags${tagScope}\n\nUnhappy = NPS detractors (0–6) and dissatisfied CSAT (1–2). A tag's own NPS or CSAT shows from ${MIN_SAMPLE.surveyPeriod} responses; below that, only its n.\n\n${tagTable}`;

  const verbatims = verbatimLines(responses);
  const verbatimBlock = verbatims.length === 0 ? "No verbatim comments yet." : verbatims.join("\n");

  return [
    {
      id: "nps-themes",
      title: "Verbatim Theme Analysis",
      description: "Cluster customer verbatims into themes and prioritize what to address.",
      prompt:
        buildPreamble("NPS/CSAT Tracker", context) +
        // The filter, tags and verbatims are user-typed (verbatims by customers).
        `${wrapUserContent(`${filter}${verdict}${tagsBlock}\n\n## Verbatim comments (newest first)\n\n${verbatimBlock}`)}\n\n## Questions\n\n1. What 3-5 themes emerge from the verbatims? Do the team's tags capture them?\n2. Which themes drive detractors and dissatisfied answers vs. promoters?\n3. Prioritize what to address first for the biggest lift, and say which themes rest on too few answers to act on yet.`,
    },
    {
      id: "nps-trend",
      title: "Score Trend Diagnosis",
      description: "Explain what's driving score movement over time.",
      prompt:
        buildPreamble(
          "NPS/CSAT Tracker",
          `${context} Trend shifts often correlate with product launches, outages, or policy changes.`
        ) +
        `${wrapUserContent(`${filter}${verdict}${periodsBlock}`)}\n\n## Questions\n\n1. Is the trend rising, falling, or stable, counting only the periods with enough responses?\n2. What could have caused any notable shifts?\n3. What would you investigate next?`,
    },
  ];
}
