/**
 * The Async Standup's digest summary (AI task `async-standup.digest`): the
 * facts it is given, fitted to the request's size, the summary without AI,
 * and the clean-up of what comes back. Pure and server-safe, with no zod:
 * the task's lite half (pages) and its def both build on this.
 *
 *   - The input is one day's updates (people with a problem first, then in
 *     the order the day reaches them), who hasn't posted, older blockers
 *     still open and the team's places east to west.
 *   - Nothing is saved from a summary; the page shows it and can copy it
 *     into the digest.
 */

import type { StandupEntry, StandupFormat } from "@/lib/stores/workspace-types";
import { TOOL_AI_BODY_BUDGET } from "@/lib/ai/contract";
import { isoDayNumber } from "@/lib/sprints/calendar";
import { nameKey } from "@/lib/team/names";
import type { StandupPlace } from "@/lib/team-time/sun";
import { jsonBytes } from "@/lib/utils/json-bytes";
import { hasBlocker, shiftChain } from "./entries";

/** The task's caps, input and output. */
export const DIGEST_MAX = {
  entries: 25,
  member: 80,
  site: 60,
  field: 600,
  dri: 80,
  handoff: 400,
  notes: 300,
  notPosted: 30,
  olderBlockers: 15,
  olderText: 300,
  ageDays: 365,
  shifts: 8,
  headline: 160,
  summary: 700,
  asks: 8,
  askText: 200,
  risks: 4,
  risk: 200,
  handoffs: 8,
  handoffText: 200,
} as const;

/** What fitting cuts to, in order (fitDigestInput). */
export const DIGEST_FIT = { handoff: 200, field: 300, olderBlockers: 5 } as const;

/** A blocker this many days old reads as a risk. */
export const DIGEST_RISK_DAYS = 3;

export const DIGEST_TASK_ID = "async-standup.digest";

export interface DigestEntryInput {
  member: string;
  format: StandupFormat;
  /** Where they work (Team Time), when known. */
  site?: string;
  /** Yesterday, or Progress. */
  done: string;
  /** Today, or Plans. */
  next: string;
  /** The open blocker, or Problems; "" for none. */
  problem: string;
  /** Who can clear the problem. */
  dri?: string;
  handoff?: string;
  notes?: string;
}

export interface DigestInput {
  /** YYYY-MM-DD. */
  date: string;
  entries: DigestEntryInput[];
  notPosted: string[];
  /** Blockers raised on earlier days and still open, oldest first. */
  olderBlockers: { member: string; text: string; ageDays: number; dri?: string }[];
  /** The team's places, east to west. */
  shifts: string[];
}

export interface DigestOutput {
  headline: string;
  summary: string;
  asks: { who: string; text: string }[];
  risks: string[];
  handoffs: { from: string; to: string; text: string }[];
}

const oneLine = (s: string | undefined) => (s ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim();

/** `s` on one line, cut to `max` with an ellipsis. */
export const cutText = (s: string | undefined, max: number): string => {
  const t = oneLine(s);
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

const daysApart = (from: string, to: string) => {
  const a = isoDayNumber(from);
  const b = isoDayNumber(to);
  return a === null || b === null ? 0 : b - a;
};

/**
 * The summary's facts for `date`: the day's updates (open problems first,
 * then east to west, those with no known place last), who hasn't posted,
 * the older blockers still open (oldest first) and the team's places.
 */
export function digestInput({
  entries,
  date,
  places,
  notPosted,
}: {
  entries: readonly StandupEntry[];
  date: string;
  places?: ReadonlyMap<string, StandupPlace>;
  notPosted: readonly string[];
}): DigestInput {
  const chain = shiftChain(places, date);
  const rank = (member: string) => {
    const p = places?.get(nameKey(member));
    const at = p ? chain.findIndex((c) => c.label === p.label && c.zone === p.zone) : -1;
    return at < 0 ? chain.length : at;
  };
  const day = entries
    .filter((e) => e.date === date)
    .map((e, i) => ({ e, i, open: hasBlocker(e) && !e.blockerResolved }))
    .sort(
      (a, b) => Number(b.open) - Number(a.open) || rank(a.e.member) - rank(b.e.member) || a.i - b.i
    )
    .slice(0, DIGEST_MAX.entries)
    .map(({ e, open }): DigestEntryInput => {
      const site = places?.get(nameKey(e.member))?.label;
      const problem = open ? cutText(e.blockers, DIGEST_MAX.field) : "";
      const dri = problem ? cutText(e.blockerDri, DIGEST_MAX.dri) : "";
      const handoff = cutText(e.handoff, DIGEST_MAX.handoff);
      const notes = cutText(e.description, DIGEST_MAX.notes);
      return {
        member: cutText(e.member, DIGEST_MAX.member),
        format: e.format === "ppp" ? "ppp" : "classic",
        ...(site ? { site: cutText(site, DIGEST_MAX.site) } : {}),
        done: cutText(e.yesterday, DIGEST_MAX.field),
        next: cutText(e.today, DIGEST_MAX.field),
        problem,
        ...(dri ? { dri } : {}),
        ...(handoff ? { handoff } : {}),
        ...(notes ? { notes } : {}),
      };
    })
    .filter((e) => e.member);
  const olderBlockers = entries
    .filter((e) => e.date < date && hasBlocker(e) && !e.blockerResolved)
    .sort((a, b) => a.date.localeCompare(b.date) || a.timestamp - b.timestamp)
    .map((e) => {
      const dri = cutText(e.blockerDri, DIGEST_MAX.dri);
      return {
        member: cutText(e.member, DIGEST_MAX.member),
        text: cutText(e.blockers, DIGEST_MAX.olderText),
        ageDays: Math.min(DIGEST_MAX.ageDays, Math.max(1, daysApart(e.date, date))),
        ...(dri ? { dri } : {}),
      };
    })
    .filter((b) => b.member && b.text)
    .slice(0, DIGEST_MAX.olderBlockers);
  return {
    date,
    entries: day,
    notPosted: notPosted
      .map((n) => cutText(n, DIGEST_MAX.member))
      .filter(Boolean)
      .slice(0, DIGEST_MAX.notPosted),
    olderBlockers,
    shifts: chain
      .map((p) => cutText(p.label, DIGEST_MAX.site))
      .filter(Boolean)
      .slice(0, DIGEST_MAX.shifts),
  };
}

/**
 * `input` cut until the request ({task, input}) fits `budget` bytes: drop
 * the notes, cut hand-overs to 200 characters, the main fields to 300, keep
 * the 5 oldest older blockers, then drop people without a problem from the
 * end, and last anyone from the end (one update is always kept).
 */
export function fitDigestInput(input: DigestInput, budget = TOOL_AI_BODY_BUDGET): DigestInput {
  const size = (i: DigestInput) => jsonBytes({ task: DIGEST_TASK_ID, input: i });
  let fit = input;
  if (size(fit) <= budget) return fit;
  const steps: ((i: DigestInput) => DigestInput)[] = [
    (i) => ({
      ...i,
      entries: i.entries.map((e) => {
        const rest = { ...e };
        delete rest.notes;
        return rest;
      }),
    }),
    (i) => ({
      ...i,
      entries: i.entries.map((e) =>
        e.handoff ? { ...e, handoff: cutText(e.handoff, DIGEST_FIT.handoff) } : e
      ),
    }),
    (i) => ({
      ...i,
      entries: i.entries.map((e) => ({
        ...e,
        done: cutText(e.done, DIGEST_FIT.field),
        next: cutText(e.next, DIGEST_FIT.field),
        problem: cutText(e.problem, DIGEST_FIT.field),
      })),
    }),
    (i) => ({ ...i, olderBlockers: i.olderBlockers.slice(0, DIGEST_FIT.olderBlockers) }),
  ];
  for (const step of steps) {
    fit = step(fit);
    if (size(fit) <= budget) return fit;
  }
  // People without a problem go first, from the end.
  while (size(fit) > budget && fit.entries.length > 1) {
    let last = -1;
    for (let k = fit.entries.length - 1; k >= 0; k--) {
      if (!fit.entries[k].problem) {
        last = k;
        break;
      }
    }
    if (last < 0) break;
    fit = { ...fit, entries: fit.entries.filter((_, k) => k !== last) };
  }
  while (size(fit) > budget && fit.entries.length > 1) {
    fit = { ...fit, entries: fit.entries.slice(0, -1) };
  }
  return fit;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const listAnd = (names: readonly string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** The next place after `site` in `shifts`, round to the first; null when there is none. */
function nextShift(shifts: readonly string[], site: string | undefined): string | null {
  if (!site || shifts.length < 2) return null;
  const at = shifts.indexOf(site);
  return at < 0 ? null : shifts[(at + 1) % shifts.length];
}

/**
 * The summary without AI, from the same facts: the counts as a headline,
 * who is blocked, the oldest open blocker and who hasn't posted; an ask per
 * problem to its DRI (else its owner); blockers 3 days old or more as risks;
 * and each hand-over to the next place. Throws on input with no updates,
 * which the task's schema refuses (the button then asks to post first).
 */
export function digestFallback(input: DigestInput): DigestOutput {
  if (!Array.isArray(input.entries) || input.entries.length === 0) {
    throw new Error("No updates to summarise.");
  }
  const blocked = input.entries.filter((e) => e.problem.trim());
  const open = blocked.length + input.olderBlockers.length;
  const headline = cutText(
    `${plural(input.entries.length, "update")} posted${
      input.notPosted.length > 0 ? `, ${input.notPosted.length} still to come` : ""
    }; ${open === 0 ? "no blockers open" : `${plural(open, "blocker")} open`}`,
    DIGEST_MAX.headline
  );
  const parts: string[] = [];
  if (blocked.length > 0) {
    parts.push(`Blocked today: ${listAnd(blocked.map((e) => e.member))}.`);
  } else {
    parts.push("Nobody raised a blocker today.");
  }
  const oldest = input.olderBlockers[0];
  if (oldest) {
    const what = cutText(oldest.text, 160).replace(/[.!?…]+$/, "");
    parts.push(
      `The oldest open blocker is ${oldest.member}'s, ${plural(oldest.ageDays, "day")} old: ${what}.`
    );
  }
  if (input.notPosted.length > 0) {
    parts.push(`Not posted yet: ${listAnd(input.notPosted)}.`);
  }
  const asks = blocked.slice(0, DIGEST_MAX.asks).map((e) => ({
    who: cutText(e.dri || e.member, DIGEST_MAX.member),
    text: cutText(e.problem, DIGEST_MAX.askText),
  }));
  const risks = input.olderBlockers
    .filter((b) => b.ageDays >= DIGEST_RISK_DAYS)
    .slice(0, DIGEST_MAX.risks)
    .map((b) =>
      cutText(
        `${b.member}'s blocker is ${plural(b.ageDays, "day")} old: ${b.text}`,
        DIGEST_MAX.risk
      )
    );
  const handoffs = input.entries
    .filter((e) => e.handoff?.trim())
    .map((e) => ({ e, to: nextShift(input.shifts, e.site) }))
    .filter((x): x is { e: DigestEntryInput; to: string } => x.to !== null)
    .slice(0, DIGEST_MAX.handoffs)
    .map(({ e, to }) => ({
      from: e.site as string,
      to,
      text: cutText(e.handoff, DIGEST_MAX.handoffText),
    }));
  return {
    headline,
    summary: cutText(parts.join(" "), DIGEST_MAX.summary),
    asks,
    risks,
    handoffs,
  };
}

/**
 * What came back, kept to the facts given: an ask to someone who isn't a
 * poster or a DRI in the input goes, and so does a hand-over between places
 * that aren't the input's shifts.
 */
export function cleanDigestOutput(input: DigestInput, out: DigestOutput): DigestOutput {
  const people = new Set<string>();
  for (const e of input.entries) {
    people.add(nameKey(e.member));
    if (e.dri) people.add(nameKey(e.dri));
  }
  for (const b of input.olderBlockers) {
    people.add(nameKey(b.member));
    if (b.dri) people.add(nameKey(b.dri));
  }
  const shifts = new Set(input.shifts.map((s) => s.trim().toLowerCase()));
  const isShift = (s: string) => shifts.has(s.trim().toLowerCase());
  return {
    ...out,
    asks: out.asks.filter((a) => people.has(nameKey(a.who))),
    handoffs: out.handoffs.filter((h) => isShift(h.from) && isShift(h.to)),
  };
}

/** A line of Markdown: one line, with Markdown's heading and emphasis marks escaped. */
const inline = (s: string) => oneLine(s).replace(/([\\`*_[\]#<>|])/g, "\\$1");

/**
 * The digest with the summary after its first line ("# Standup — date"):
 * a "## Summary" block of the headline, the summary, then the asks, risks
 * and hand-overs, each line escaped.
 */
export function digestWithSummary(digest: string, out: DigestOutput): string {
  const lines = digest.split("\n");
  const block = ["", "## Summary", inline(out.headline)];
  if (out.summary.trim()) block.push("", inline(out.summary));
  const items = [
    ...out.asks.map((a) => `- Ask ${inline(a.who)}: ${inline(a.text)}`),
    ...out.risks.map((r) => `- Risk: ${inline(r)}`),
    ...out.handoffs.map(
      (h) => `- Hand-over, ${inline(h.from)} → ${inline(h.to)}: ${inline(h.text)}`
    ),
  ];
  if (items.length > 0) block.push("", ...items);
  return [lines[0], ...block, ...lines.slice(1)].join("\n");
}
