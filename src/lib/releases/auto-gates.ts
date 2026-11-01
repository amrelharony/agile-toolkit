/**
 * The readiness gates the toolkit checks by itself, and what a release's
 * gates read at each step of its life: ticked (or checked) while it is
 * planned, frozen when it ships, kept when it is rolled back and reopened.
 * Shared by the Release Readiness page and tool.release_readiness, so a
 * person and an agent tick, ship and count a release the same way. Pure.
 *
 *   - "Feature flag ready" (auto "flags") reads the Feature Flag Tracker:
 *     it passes once the release has live flags linked and each rollout or
 *     experiment flag among them has an owner and a removal date.
 *   - "Definition of Done met" (auto "dod") reads the DoD Builder: it
 *     passes once every done story the release links meets the DoD (or,
 *     for a release linking no stories, every required criterion is
 *     ticked at team level, while the DoD still carries the ticks from
 *     before stories had their own).
 *
 * A check that can't tell (no flags linked, no DoD yet) is `passed: null`,
 * and the gate falls back to a manual tick. A check that can tell decides
 * the gate, so it can't be ticked by hand. At ship the results are written
 * into the release's gates with the gate ids that applied (`gateIds`), so a
 * flag retired or a DoD changed later never rewrites what shipped.
 */

import type {
  FeatureFlag,
  Release,
  ReleaseGateAuto,
  ReleaseGateDef,
  ReleaseReadiness,
  ReleaseShip,
  Story,
} from "@/lib/stores/workspace-types";
import { BUILT_IN_GATES, DOD_GATE, gatesOf, teamGates } from "@/lib/releases/gates";
import { wentOut } from "@/lib/releases/model";
import { flagStaleness } from "@/lib/flags/model";
import { isIsoDate } from "@/lib/sprints/calendar";
import {
  hasLegacyTicks,
  normalizeDefinitionOfDone,
  openCriteria,
  requiredCriteria,
} from "@/lib/dod/model";

/** What an automatic check found. */
export interface GateCheck {
  /** Passed, failed, or null: it can't tell, so the gate takes a manual tick. */
  passed: boolean | null;
  /** One line on why: "checkout_v2 has no removal date". */
  detail: string;
  /** Where to fix it. */
  href: string;
}

/** The checks for one release, by the kind of gate they decide. */
export type GateChecks = Partial<Record<ReleaseGateAuto, GateCheck>>;

export const FLAGS_GATE_HREF = "/feature-flag-tracker";
export const DOD_GATE_HREF = "/dod-builder";

/** "a, b and c". */
function listAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The flag's name, or a stand-in for an unnamed one. */
const flagName = (f: FeatureFlag) => f.name.trim() || "An unnamed flag";

/**
 * "Feature flag ready" for `release`: the flags shipping behind it are
 * live, and each rollout or experiment flag (the ones meant to go) has an
 * owner and a removal date that hasn't passed. Kill switch and permission
 * flags only need to be live. Null with no live flag linked: the team may
 * not use flags for this release, so the gate is theirs to tick.
 */
export function checkFlagsGate(
  release: Pick<Release, "id">,
  flags: readonly FeatureFlag[] | undefined,
  today: string
): GateCheck {
  const href = FLAGS_GATE_HREF;
  const linked = (flags ?? []).filter((f) => f.releaseId === release.id);
  if (linked.length === 0) return { passed: null, detail: "No flags linked", href };
  const live = linked.filter((f) => f.status !== "retired");
  if (live.length === 0) {
    return {
      passed: null,
      detail:
        linked.length === 1 ? "The one linked flag is retired" : "Every linked flag is retired",
      href,
    };
  }
  const problems: string[] = [];
  for (const f of live) {
    const meantToGo = f.purpose === "rollout" || f.purpose === "experiment";
    const missing = [
      meantToGo && !f.owner?.trim() ? "owner" : "",
      meantToGo && !f.removeBy ? "removal date" : "",
    ].filter(Boolean);
    if (missing.length > 0) {
      problems.push(`${flagName(f)} has no ${missing.join(" and no ")}`);
    } else if (flagStaleness(f, today).stale) {
      problems.push(`${flagName(f)} is past its removal date`);
    }
  }
  if (problems.length > 0) return { passed: false, detail: problems.join("; "), href };
  return {
    passed: true,
    detail:
      live.length === 1
        ? `${flagName(live[0])} is ready`
        : `All ${live.length} linked flags are ready`,
    href,
  };
}

/** "Pay by card (2 open)" for up to three stories, then how many more. */
function missText(misses: readonly { title: string; open: number }[]): string {
  const shown = misses
    .slice(0, 3)
    .map((m) => `${m.title.trim() || "An untitled story"} (${m.open} open)`);
  const more = misses.length - shown.length;
  return `Not met: ${listAnd(more > 0 ? [...shown, `${more} more`] : shown)}`;
}

/**
 * "Definition of Done met", against the DoD Builder's document (or its old
 * blob: lib/dod/model reads both).
 *
 *   - A release that links stories (`linked`) passes when every linked
 *     story that is done meets the DoD (each required criterion ticked on
 *     its Sprint board card), and fails naming the ones that don't. With
 *     none of them done yet it can't tell.
 *   - A release that links no stories falls back to the DoD's team-level
 *     ticks from before stories carried their own (`done` on a criterion),
 *     and says so, but only while the DoD still carries them
 *     (hasLegacyTicks). A DoD written since has none and nothing sets them
 *     any more, so reading their absence as "not ticked" would lock the
 *     gate failed for good: it can't tell, and the gate takes its tick.
 *
 * Null without a DoD, or with no required criteria: there is nothing to
 * check against.
 */
export function checkDodGate(dod: unknown, linked?: readonly Story[]): GateCheck {
  const href = DOD_GATE_HREF;
  const doc = normalizeDefinitionOfDone(dod);
  if (doc.items.length === 0) return { passed: null, detail: "No Definition of Done yet", href };
  const required = requiredCriteria(doc);
  if (required.length === 0) {
    return { passed: null, detail: "The Definition of Done has no required criteria", href };
  }
  if (linked && linked.length > 0) {
    const done = linked.filter((s) => s.status === "done");
    if (done.length === 0) {
      return {
        passed: null,
        detail:
          linked.length === 1
            ? "The linked story isn't done yet"
            : `None of the ${linked.length} linked stories is done yet`,
        href,
      };
    }
    const misses = done
      .map((s) => ({ title: s.title, open: openCriteria(s, doc).length }))
      .filter((m) => m.open > 0);
    if (misses.length > 0) return { passed: false, detail: missText(misses), href };
    return {
      passed: true,
      detail:
        done.length === 1
          ? "The done linked story meets the DoD"
          : `All ${done.length} done linked stories meet the DoD`,
      href,
    };
  }
  if (!hasLegacyTicks(doc)) {
    return {
      passed: null,
      detail: "Link the release's stories to check them against the DoD",
      href,
    };
  }
  const from = " (the DoD's old team-level ticks)";
  const open = required.filter((i) => i.done !== true);
  if (open.length === 0) {
    return {
      passed: true,
      detail:
        (required.length === 1
          ? "The required criterion is ticked"
          : `All ${required.length} required criteria are ticked`) + from,
      href,
    };
  }
  return {
    passed: false,
    detail: `Not ticked: ${listAnd(open.map((i) => i.label))}${from}`,
    href,
  };
}

/**
 * What "Feature flag ready" checks, in words. lib/releases/gates still
 * describes the built-in as "Kill switch in place", which checkFlagsGate
 * never asks for, and a team list saved from the built-ins copied that text.
 */
export const FLAGS_GATE_DESCRIPTION =
  "Linked flags are live; rollouts and experiments have an owner and a removal date";
const OLD_FLAGS_GATE_DESCRIPTION = "Kill switch in place";

/** `g` as the page and the agent describe it: the flag gate's old text read as what its check does. */
export function describedGate<T extends ReleaseGateDef>(g: T): T {
  return g.auto === "flags" && g.description === OLD_FLAGS_GATE_DESCRIPTION
    ? { ...g, description: FLAGS_GATE_DESCRIPTION }
    : g;
}

/** The stories `release` links (Release.storyIds), from `stories`; undefined when it links none. */
export function linkedStories(
  release: Pick<Release, "storyIds">,
  stories: readonly Story[] | undefined
): Story[] | undefined {
  const ids = Array.isArray(release.storyIds) ? new Set(release.storyIds) : null;
  if (!ids || ids.size === 0 || !stories) return undefined;
  return stories.filter((s) => ids.has(s.id));
}

/**
 * Both checks for `release`. With `stories`, the DoD gate reads the
 * release's linked stories (linkedStories); without, the DoD's old ticks
 * where it still has them.
 */
export function releaseChecks(
  release: Pick<Release, "id" | "storyIds">,
  flags: readonly FeatureFlag[] | undefined,
  dod: unknown,
  today: string,
  stories?: readonly Story[]
): GateChecks {
  return {
    flags: checkFlagsGate(release, flags, today),
    dod: checkDodGate(dod, linkedStories(release, stories)),
  };
}

/** A gate as it reads on one release. */
export interface GateResult extends ReleaseGateDef {
  passed: boolean;
  /** The automatic check, for an auto gate on a release being planned; null otherwise. */
  check: GateCheck | null;
  /** The tick can't be changed: the release went out (frozen), or the check decided it. */
  locked: boolean;
}

/** Whether a check decided its gate. */
const decides = (check: GateCheck | null | undefined): check is GateCheck & { passed: boolean } =>
  Boolean(check) && check!.passed !== null;

/**
 * The gates that apply to `release` (lib/releases/gates gatesOf) and how
 * each reads: frozen for a release that went out; for one being planned,
 * an auto gate's check when it can tell, else the tick.
 */
export function gateResults(
  release: Release,
  doc: Pick<ReleaseReadiness, "gates"> | undefined,
  checks: GateChecks
): GateResult[] {
  const defs = gatesOf(release, doc).map(describedGate);
  if (release.status !== "planning") {
    return defs.map((g) => ({
      ...g,
      passed: Boolean(release.gates?.[g.id]),
      check: null,
      locked: true,
    }));
  }
  return defs.map((g) => {
    const check = g.auto ? (checks[g.auto] ?? null) : null;
    return decides(check)
      ? { ...g, passed: check.passed, check, locked: true }
      : { ...g, passed: Boolean(release.gates?.[g.id]), check, locked: false };
  });
}

/**
 * `release.gates` with each of `defs` as it reads now: a deciding check's
 * result, else the tick. What Ship freezes; other keys are kept as stored.
 */
export function effectiveGates(
  release: Pick<Release, "gates">,
  defs: readonly ReleaseGateDef[],
  checks: GateChecks
): Record<string, boolean> {
  const out: Record<string, boolean> = { ...(release.gates ?? {}) };
  for (const g of defs) {
    const check = g.auto ? checks[g.auto] : undefined;
    out[g.id] = decides(check) ? check.passed : Boolean(release.gates?.[g.id]);
  }
  return out;
}

/* ── A release's life: ship, roll back, reopen ──────────────────────── */

/** The day a release shipped: a real day, not after today. Null when fine. */
export function shipDateError(day: string, today: string): string | null {
  if (!day.trim()) return "Pick the day it shipped.";
  if (!isIsoDate(day)) return "Use a date like 2026-10-24.";
  if (day > today) return "It can't ship in the future.";
  return null;
}

/** The day a release was rolled back: not before it shipped, not after today. Null when fine. */
export function rollbackDateError(
  day: string,
  shippedDate: string | undefined,
  today: string
): string | null {
  if (!day.trim()) return "Pick the day it was rolled back.";
  if (!isIsoDate(day)) return "Use a date like 2026-10-24.";
  if (day > today) return "It can't be rolled back in the future.";
  if (shippedDate && day < shippedDate.slice(0, 10))
    return "It can't be rolled back before it shipped.";
  return null;
}

/**
 * `release` shipped on `shippedDate`: the gates that apply now are frozen
 * on it (`gateIds`), each auto gate's result is written into its gates, and
 * the number still open is kept. Only a release in planning ships; callers
 * check that first.
 */
export function shipRelease(
  release: Release,
  doc: Pick<ReleaseReadiness, "gates"> | undefined,
  checks: GateChecks,
  shippedDate: string
): Release {
  const defs = gatesOf(release, doc);
  const gates = effectiveGates(release, defs, checks);
  const { rolledBackAt, ...rest } = release;
  void rolledBackAt;
  return {
    ...rest,
    status: "shipped",
    shippedDate,
    gateIds: defs.map((g) => g.id),
    gates,
    gatesOpenAtShip: defs.filter((g) => !gates[g.id]).length,
  };
}

/** `release` (shipped) rolled back on `rolledBackAt`. It still went out, so it stays in the stats. */
export function rollBackRelease(release: Release, rolledBackAt: string): Release {
  return { ...release, status: "rolled_back", rolledBackAt };
}

/**
 * A ship kept on a reopened release, with the planned date it went out
 * against. ReleaseShip (workspace-types) has no planned date, and
 * lib/releases/model judges every ship by the release's current one, so
 * re-planning the next try would turn an old late ship into an on-time
 * one; withShipPlans reads this field until the model does.
 */
export interface PlannedShip extends ReleaseShip {
  plannedDate?: string;
}

/** The planned date a kept ship went out against, when it was kept with one. */
function planOf(ship: ReleaseShip): string | undefined {
  const plan = (ship as PlannedShip).plannedDate;
  return typeof plan === "string" && plan ? plan : undefined;
}

/**
 * `release` back in planning. A ship it made is kept on `previousShips`
 * (its date, the plan it went out against, its rollback and frozen gates),
 * so the on-time rate, the rollback and the skipped gates still count it as
 * it was. The manual ticks stay for the next try; an auto gate's result
 * doesn't, since it was its check's at ship, not anybody's tick: the check
 * reads again, and when it can't tell, the gate waits for a tick of this
 * round. A rollback recorded before rollback days were kept has no day: it
 * is dated its ship day, the earliest it can have been, since a kept ship
 * without one would read as never rolled back.
 */
export function reopenRelease(release: Release, doc?: Pick<ReleaseReadiness, "gates">): Release {
  const { shippedDate, rolledBackAt, gateIds, gatesOpenAtShip, ...rest } = release;
  if (!wentOut(release) || !shippedDate) return { ...rest, status: "planning" };
  const ship: PlannedShip = {
    shippedDate,
    ...(typeof release.plannedDate === "string" && release.plannedDate
      ? { plannedDate: release.plannedDate }
      : {}),
    ...(release.status === "rolled_back" ? { rolledBackAt: rolledBackAt ?? shippedDate } : {}),
    ...(gateIds ? { gateIds: [...gateIds] } : {}),
    gates: { ...(release.gates ?? {}) },
    ...(gatesOpenAtShip !== undefined ? { gatesOpenAtShip } : {}),
  };
  // The auto gates it shipped with, and the ones the next try will check.
  const auto = new Set(
    [...gatesOf(release, doc), ...teamGates(doc)].filter((g) => g.auto).map((g) => g.id)
  );
  const ticks = Object.fromEntries(
    Object.entries(release.gates ?? {}).filter(([id]) => !auto.has(id))
  );
  return {
    ...rest,
    status: "planning",
    gates: ticks,
    previousShips: [...(release.previousShips ?? []), ship],
  };
}

/**
 * `doc` as lib/releases/model should read it: each earlier ship of a
 * reopened release judged against the plan it went out against. The model
 * dates every ship by the release's current plannedDate, so a re-plan for
 * the next try would change whether an old ship was on time. Here an
 * earlier ship kept with its own plan reads as a release of its own (same
 * id and name), which the model counts exactly as it counts a kept ship.
 * The page's stats and tool.release_readiness both go through it; a
 * document with no such ship comes back as it is.
 */
export function withShipPlans(doc: ReleaseReadiness | undefined): ReleaseReadiness | undefined {
  const replanned = (r: Release) =>
    (r.previousShips ?? []).some((s) => planOf(s) !== undefined && planOf(s) !== r.plannedDate);
  if (!doc || !Array.isArray(doc.releases) || !doc.releases.some(replanned)) return doc;
  return {
    ...doc,
    releases: doc.releases.flatMap((r) => {
      if (!replanned(r)) return [r];
      const earlier = (r.previousShips ?? []).map(
        (s): Release => ({
          id: r.id,
          name: r.name,
          plannedDate: planOf(s) ?? r.plannedDate,
          status: s.rolledBackAt ? "rolled_back" : "shipped",
          shippedDate: s.shippedDate,
          gates: s.gates ?? {},
          ...(s.rolledBackAt ? { rolledBackAt: s.rolledBackAt } : {}),
          ...(s.gateIds ? { gateIds: s.gateIds } : {}),
          ...(s.gatesOpenAtShip !== undefined ? { gatesOpenAtShip: s.gatesOpenAtShip } : {}),
        })
      );
      const { previousShips, ...current } = r;
      void previousShips;
      return [...earlier, current];
    }),
  };
}

/** `doc` with `release` in place of the one with its id. */
export function withRelease(doc: ReleaseReadiness, release: Release): ReleaseReadiness {
  return { ...doc, releases: doc.releases.map((r) => (r.id === release.id ? release : r)) };
}

/* ── The team's gate list ───────────────────────────────────────────── */

/**
 * The gate list the document starts from: its own, else the built-ins.
 * The flag gate's old description reads as what it checks (describedGate),
 * so the next edit of the list saves the new text.
 */
export function storedGates(doc: Pick<ReleaseReadiness, "gates"> | undefined): ReleaseGateDef[] {
  return (Array.isArray(doc?.gates) ? doc.gates : BUILT_IN_GATES).map((g) =>
    describedGate({ ...g })
  );
}

/**
 * `doc` with `next` as the team's gate list. A gate left out of `next` is
 * kept, archived, at the end: a shipped release that froze it still names it.
 */
export function withTeamGates(
  doc: ReleaseReadiness,
  next: readonly ReleaseGateDef[]
): ReleaseReadiness {
  const ids = new Set(next.map((g) => g.id));
  const dropped = storedGates(doc)
    .filter((g) => !ids.has(g.id))
    .map((g) => ({ ...g, archived: true }));
  return { ...doc, gates: [...next.map((g) => ({ ...g })), ...dropped] };
}

/**
 * A new gate's id from its label ("Smoke test" → "smoke_test"), unique
 * among `taken` (the document's gates, the built-ins and the DoD gate).
 */
export function newGateId(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (const g of BUILT_IN_GATES) used.add(g.id);
  used.add(DOD_GATE.id);
  const base =
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "gate";
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
  return id;
}

/** Every gate's label by id: the team's (archived ones too), the built-ins and the DoD gate. */
export function gateLabels(doc: Pick<ReleaseReadiness, "gates"> | undefined): Map<string, string> {
  const labels = new Map<string, string>();
  for (const g of BUILT_IN_GATES) labels.set(g.id, g.label);
  labels.set(DOD_GATE.id, DOD_GATE.label);
  for (const g of doc?.gates ?? []) labels.set(g.id, g.label);
  return labels;
}
