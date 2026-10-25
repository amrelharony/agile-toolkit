/**
 * A quarter's DORA numbers worked out from the toolkit's own data, for the
 * scorecard's "Fill from your data" and tool.dora_scorecard.derive_sample.
 * Pure, and safe for the agent's server bundle.
 *
 *   - Deploy frequency: ships in the quarter (lib/releases/model, so a
 *     reopened release's earlier ship counts, as Release Readiness counts
 *     it) per week, over the weeks elapsed for the quarter in progress.
 *   - Change failure rate: of those ships, the share rolled back.
 *   - Lead time: the median, over the stories and Flow-board cards that
 *     SHIPPED in the quarter, of the days from the start of work to the
 *     release that shipped it (lib/flow leadTimeHours, whole days, a
 *     same-day item is 24 hours). The release is the one listing the story
 *     (`Release.storyIds`), else the first ship on or after the day it was
 *     done. Like the deploy count, it goes by the ship day (DORA measures
 *     lead time per deployment): work done on Mar 30 and shipped on Apr 5
 *     is Q2's, never lost between two quarters. DORA measures from commit to
 *     production; the start of work is the nearest stamp the boards have,
 *     and the result says so. Work done but not shipped yet isn't in
 *     production, so it is left out; a team that tracks no releases at all
 *     is measured from start to done, over the work done in the quarter.
 *   - Time to restore: the mean of opened → resolved over the incidents
 *     resolved in the quarter (Incident Commander), its own definition.
 *
 * A metric with nothing to go on stays null, with the reason in `missing`,
 * never 0. Example rows (`example-` ids) are left out.
 *
 * What a saved sample came from is its `derivedFrom` counts, one per
 * source: releases (deploy frequency and change failure rate), items (lead
 * time), incidents (time to restore). A count of 0 means that number wasn't
 * worked out from the data (it found none, or the number was typed over),
 * so a sample with every count 0 is typed, whatever its `source` says.
 */

import type {
  DoraDerivedFrom,
  DoraSample,
  Incident,
  IncidentCommander,
  ReleaseReadiness,
} from "@/lib/stores/workspace-types";
import { shipEvents, shippedBetween, type ShipEvent } from "@/lib/releases/model";
import { cycleDays, leadTimeHours, type FlowItem } from "@/lib/flow";
import { percentile } from "@/lib/sprints/metrics";
import { localDay } from "@/lib/sprints/series";
import { MIN_SAMPLE, needMore } from "@/lib/analytics/min-sample";
import { isDashQuarter, quarterBounds } from "@/lib/roadmap/quarters";
import { DORA_METRICS, type DoraMetric } from "./bands";

/** MUST match IC_ID in incident-commander/constants.ts. */
export const INCIDENT_DOC_ID = "incidentCommander:current";

const isExampleRow = (id: string | null | undefined) =>
  typeof id === "string" && id.startsWith("example-");

export interface DoraDerivation {
  quarter: string;
  /** The quarter's first day and the last day measured (today, while it runs). */
  from: string;
  to: string;
  /** The quarter is still running: deploy frequency is over the weeks so far. */
  inProgress: boolean;
  /** Weeks measured. */
  weeks: number;
  deployFreqPerWeek: number | null;
  /** 0..1. */
  changeFailRate: number | null;
  leadTimeHours: number | null;
  mttrHours: number | null;
  derivedFrom: DoraDerivedFrom;
  lead: {
    /** "start-to-ship" when the team tracks releases, else "start-to-done". */
    basis: "start-to-ship" | "start-to-done";
    /** Items measured: shipped in the quarter (done in it, start to done). */
    measured: number;
    /** Of them, tied to their release by `Release.storyIds`. */
    linked: number;
    /** Finished in the quarter but not shipped yet (left out). */
    notShipped: number;
  };
  /** Why a metric is empty. */
  missing: Partial<Record<DoraMetric, string>>;
}

const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The ships of the releases that list each story (`Release.storyIds`). A
 * story listed by a release that hasn't gone out maps to no ships: it is
 * known not to be in production yet.
 */
function linkedShips(
  doc: ReleaseReadiness,
  events: readonly ShipEvent[]
): Map<string, ShipEvent[]> {
  const byRelease = new Map<string, ShipEvent[]>();
  for (const e of events) byRelease.set(e.releaseId, [...(byRelease.get(e.releaseId) ?? []), e]);
  const out = new Map<string, ShipEvent[]>();
  for (const r of doc.releases) {
    if (!Array.isArray(r.storyIds)) continue;
    const ships = byRelease.get(r.id) ?? [];
    for (const id of r.storyIds) out.set(id, [...(out.get(id) ?? []), ...ships]);
  }
  // Oldest ship first, as `shipEvents` orders them, across the releases listing a story.
  out.forEach((ships) => ships.sort((a, b) => a.shippedDate.localeCompare(b.shippedDate)));
  return out;
}

/** The first of `ships` (oldest first) on or after `day`. */
const firstOnOrAfter = (ships: readonly ShipEvent[], day: string) =>
  ships.find((e) => e.shippedDate.slice(0, 10) >= day);

/** Hours from opened to resolved, or null when either is missing or backwards. */
function restoreHours(i: Incident): number | null {
  if (!i.resolvedAt) return null;
  const ms = Date.parse(i.resolvedAt) - Date.parse(i.openedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms / 3_600_000 : null;
}

export interface DeriveInput {
  /** "YYYY-Qn". */
  quarter: string;
  /** Release Readiness (RELEASE_DOC_ID). */
  releases?: ReleaseReadiness | null;
  /** Stories and Flow-board cards (lib/flow storyItems + cardItems). */
  items: readonly FlowItem[];
  /** Incident Commander (INCIDENT_DOC_ID), or its incidents. */
  incidents?: IncidentCommander | readonly Incident[] | null;
  /** Local "YYYY-MM-DD". */
  today: string;
}

/** The quarter's numbers from the data, or null when `quarter` isn't a "YYYY-Qn". */
export function deriveDoraSample(input: DeriveInput): DoraDerivation | null {
  const { quarter, today } = input;
  if (!isDashQuarter(quarter)) return null;
  const bounds = quarterBounds(quarter);
  if (!bounds) return null;
  const from = bounds.start;
  const inProgress = today >= from && today < bounds.end;
  const to = inProgress ? today : bounds.end;
  const missing: Partial<Record<DoraMetric, string>> = {};
  const empty: DoraDerivation = {
    quarter,
    from,
    to,
    inProgress,
    weeks: 0,
    deployFreqPerWeek: null,
    changeFailRate: null,
    leadTimeHours: null,
    mttrHours: null,
    derivedFrom: { releases: 0, rolledBack: 0, items: 0, incidents: 0 },
    lead: { basis: "start-to-ship", measured: 0, linked: 0, notShipped: 0 },
    missing,
  };
  if (from > today) {
    const why = `${quarter} hasn't started yet.`;
    for (const m of ["deployFreqPerWeek", "changeFailRate", "leadTimeHours", "mttrHours"] as const)
      missing[m] = why;
    return empty;
  }
  const weeks = (cycleDays(from, to) ?? 1) / 7;

  /* Deployments. */
  const doc: ReleaseReadiness = {
    id: input.releases?.id ?? "releaseReadiness:current",
    ...(input.releases ?? {}),
    releases: (Array.isArray(input.releases?.releases) ? input.releases.releases : []).filter(
      (r) => r && typeof r === "object" && !isExampleRow(r.id)
    ),
  };
  const events = shipEvents(doc);
  const inQuarter = shippedBetween(events, from, to);
  const rolledBack = inQuarter.filter((e) => e.rolledBack).length;
  if (events.length === 0) {
    missing.deployFreqPerWeek = "No releases are tracked yet.";
    missing.changeFailRate = "No releases are tracked yet.";
  } else if (inQuarter.length === 0) {
    missing.deployFreqPerWeek = `No release went out in ${quarter}.`;
    missing.changeFailRate = `No release went out in ${quarter}.`;
  }
  const deployFreqPerWeek = inQuarter.length > 0 ? round(inQuarter.length / weeks, 2) : null;
  const changeFailRate = inQuarter.length > 0 ? round(rolledBack / inQuarter.length, 4) : null;

  /* Lead time. */
  const tracksReleases = events.length > 0;
  const links = linkedShips(doc, events);
  // Everything done by the quarter's end: work done before it can ship in it.
  const done = input.items
    .filter((item) => item.startedOn)
    .map((item) => ({ item, day: localDay(item.doneOn) }))
    .filter((x): x is { item: FlowItem; day: string } => x.day !== null && x.day <= to);
  const finished = done.filter((x) => x.day >= from).length;
  const hours: number[] = [];
  let linked = 0;
  let notShipped = 0;
  for (const { item, day } of done) {
    if (!tracksReleases) {
      // Start to done: the quarter the work was done in.
      if (day < from) continue;
      const h = leadTimeHours(item);
      if (h !== null) hours.push(h);
      continue;
    }
    const own = item.kind === "story" ? links.get(item.id) : undefined;
    const exact = own ? firstOnOrAfter(own, day) : undefined;
    // A release listing the story that shipped before it was done is a
    // stale link: the first ship after it stands in, as for unlisted work.
    // One listing it that hasn't gone out means it isn't out yet.
    const ship = exact ?? (own && own.length === 0 ? undefined : firstOnOrAfter(events, day));
    if (!ship) {
      if (day >= from) notShipped++;
      continue;
    }
    // Start to ship: the quarter it shipped in, as deploys are counted.
    const shipped = ship.shippedDate.slice(0, 10);
    if (shipped < from || shipped > to) continue;
    const h = leadTimeHours(item, shipped);
    if (h === null) continue;
    hours.push(h);
    if (exact) linked++;
  }
  const enoughLead = hours.length >= MIN_SAMPLE.average;
  if (!enoughLead) {
    if (hours.length === 0 && notShipped > 0) {
      missing.leadTimeHours = `None of the ${plural(finished, "item")} finished in ${quarter} has shipped yet.`;
    } else if (hours.length === 0 && tracksReleases) {
      missing.leadTimeHours = `No story or card with a start date shipped in ${quarter}.`;
    } else if (hours.length === 0) {
      missing.leadTimeHours = `No story or card with a start date was finished in ${quarter}.`;
    } else {
      const more = needMore(hours.length, "average");
      missing.leadTimeHours = `Only ${plural(hours.length, "item")} to measure in ${quarter}; ${more} more needed for a median.`;
    }
  }

  /* Time to restore. */
  const incidentList: readonly Incident[] = Array.isArray(input.incidents)
    ? input.incidents
    : Array.isArray((input.incidents as IncidentCommander | null | undefined)?.incidents)
      ? (input.incidents as IncidentCommander).incidents
      : [];
  const restores: number[] = [];
  for (const i of incidentList) {
    if (!i || typeof i !== "object" || isExampleRow(i.id)) continue;
    const day = localDay(i.resolvedAt);
    if (!day || day < from || day > to) continue;
    const h = restoreHours(i);
    if (h !== null) restores.push(h);
  }
  if (restores.length === 0) missing.mttrHours = `No incident was resolved in ${quarter}.`;

  return {
    ...empty,
    weeks: round(weeks, 2),
    deployFreqPerWeek,
    changeFailRate,
    leadTimeHours: enoughLead ? percentile(hours, 50) : null,
    mttrHours: restores.length
      ? round(restores.reduce((a, b) => a + b, 0) / restores.length, 2)
      : null,
    derivedFrom: {
      releases: inQuarter.length,
      rolledBack,
      // Too few for a median: no lead time came from them.
      items: enoughLead ? hours.length : 0,
      incidents: restores.length,
    },
    lead: {
      basis: tracksReleases ? "start-to-ship" : "start-to-done",
      measured: hours.length,
      linked,
      notShipped,
    },
  };
}

/* ── What a sample came from ────────────────────────────────────────── */

/** A stored count, 0 when it isn't a usable number (a hand-edited doc). */
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

const listText = (xs: readonly string[]) =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

const METRIC_WORDS: Record<DoraMetric, string> = {
  deployFreqPerWeek: "deploy frequency",
  leadTimeHours: "lead time",
  changeFailRate: "change failure rate",
  mttrHours: "time to restore",
};

/** The numbers `from` says came from the data, in the scorecard's order. */
export function derivedMetrics(from: DoraDerivedFrom | null | undefined): DoraMetric[] {
  if (!from) return [];
  const has: Record<DoraMetric, boolean> = {
    deployFreqPerWeek: count(from.releases) > 0,
    changeFailRate: count(from.releases) > 0,
    leadTimeHours: count(from.items) > 0,
    mttrHours: count(from.incidents) > 0,
  };
  return DORA_METRICS.filter((m) => has[m]);
}

/**
 * `from` with the count of every number `kept` says isn't the data's any
 * more set to 0, or null when none is left (the sample is typed). The
 * releases go unless deploy frequency and change failure rate are both
 * kept: they are the basis of both, and naming them for a typed number
 * would claim more than the data gave.
 */
export function keptProvenance(
  from: DoraDerivedFrom,
  kept: (metric: DoraMetric) => boolean
): DoraDerivedFrom | null {
  const releases = count(from.releases) > 0 && kept("deployFreqPerWeek") && kept("changeFailRate");
  const next: DoraDerivedFrom = {
    releases: releases ? count(from.releases) : 0,
    rolledBack: releases ? count(from.rolledBack) : 0,
    items: kept("leadTimeHours") ? count(from.items) : 0,
    incidents: kept("mttrHours") ? count(from.incidents) : 0,
  };
  return derivedMetrics(next).length > 0 ? next : null;
}

/**
 * Where an edited sample's numbers come from now: a number changed is
 * typed (its count goes), a new quarter makes them all typed (the counts
 * were that quarter's), and with no count left the sample is typed. The page's
 * editor and tool.dora_scorecard.update_sample both judge by this.
 */
export function editedSource(
  before: DoraSample,
  next: Pick<DoraSample, DoraMetric | "quarter">
): Pick<DoraSample, "source" | "derivedFrom"> {
  if (before.source !== "derived") return before.source ? { source: before.source } : {};
  const kept = (m: DoraMetric) => before.quarter === next.quarter && before[m] === next[m];
  // Derived without counts (an agent's write): it stays so only untouched.
  if (!before.derivedFrom) return { source: DORA_METRICS.every(kept) ? "derived" : "manual" };
  const from = keptProvenance(before.derivedFrom, kept);
  return from ? { source: "derived", derivedFrom: from } : { source: "manual" };
}

/** Whether a sample's numbers came from the data: all of them, some, or none. */
export type SampleOrigin = "derived" | "partly" | "typed";

export function sampleOrigin(s: Pick<DoraSample, "source" | "derivedFrom">): SampleOrigin {
  if (s.source !== "derived") return "typed";
  if (!s.derivedFrom) return "derived";
  const n = derivedMetrics(s.derivedFrom).length;
  return n === 0 ? "typed" : n === DORA_METRICS.length ? "derived" : "partly";
}

/**
 * "From 6 releases (1 rolled back), 14 finished items and 2 incidents.":
 * what a derivation was worked out from, naming only the sources that gave
 * a number ("From 2 incidents.", not "From 0 releases, 0 finished items…").
 */
export function provenanceText(from: DoraDerivedFrom): string {
  const releases = count(from.releases);
  const rolledBack = count(from.rolledBack);
  const parts = [
    releases > 0
      ? `${plural(releases, "release")}${rolledBack > 0 ? ` (${rolledBack} rolled back)` : ""}`
      : null,
    count(from.items) > 0 ? plural(count(from.items), "finished item") : null,
    count(from.incidents) > 0 ? plural(count(from.incidents), "incident") : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return "Nothing in your data gave a number.";
  return `From ${listText(parts)}.`;
}

/**
 * Where a saved sample's numbers came from, for its row and the export:
 * "Typed", or what the data gave and which numbers were typed ("From 4
 * releases. Lead time and time to restore typed.").
 */
export function sampleSourceText(s: Pick<DoraSample, "source" | "derivedFrom">): string {
  const origin = sampleOrigin(s);
  if (origin === "typed") return "Typed";
  if (!s.derivedFrom) return "From the data";
  const fromData = derivedMetrics(s.derivedFrom);
  const typed = DORA_METRICS.filter((m) => !fromData.includes(m)).map((m) => METRIC_WORDS[m]);
  const text = provenanceText(s.derivedFrom);
  if (typed.length === 0) return text;
  const words = listText(typed);
  return `${text} ${words[0].toUpperCase()}${words.slice(1)} typed.`;
}

/** How the lead time was measured, in a sentence. */
export function leadBasisText(d: DoraDerivation): string {
  if (d.lead.basis === "start-to-done") {
    return "Lead time runs from the start of work to done: no releases are tracked, so done stands in for production.";
  }
  const linked = d.lead.linked > 0 ? `, ${d.lead.linked} by the stories their release lists` : "";
  const waiting =
    d.lead.notShipped > 0 ? ` ${plural(d.lead.notShipped, "item")} not shipped yet left out.` : "";
  return `Lead time runs from the start of work to the release that shipped it (the nearest the boards get to DORA's commit to production)${linked}.${waiting}`;
}
