/**
 * What went out and when: every ship of every release, the reopened ones'
 * earlier ships included, so the on-time rate, the change-failure rate and
 * DORA's deployment frequency count the same deployments. Shared by the
 * Release Readiness page, its agent actions and DORA. Pure.
 */

import type { Release, ReleaseReadiness } from "@/lib/stores/workspace-types";
import { gatesOf } from "./gates";

/**
 * Whether a release went out: shipped, or rolled back after shipping (it
 * keeps its ship date). One rolled back straight from planning never went out.
 */
export function wentOut(r: Pick<Release, "status" | "shippedDate">): boolean {
  return r.status === "shipped" || (r.status === "rolled_back" && Boolean(r.shippedDate));
}

/** One time a release went out. */
export interface ShipEvent {
  releaseId: string;
  name: string;
  plannedDate: string;
  shippedDate: string;
  rolledBack: boolean;
  rolledBackAt?: string;
  /** Gates still open when it shipped. */
  gatesOpen: number;
  gatesTotal: number;
  /** The ids of those open gates. */
  skippedGateIds: string[];
}

interface Ship {
  shippedDate?: string;
  rolledBack: boolean;
  rolledBackAt?: string;
  gateIds?: string[];
  gates: Record<string, boolean>;
  gatesOpenAtShip?: number;
}

/** A release's ships: its earlier ones (kept when it was reopened), then its current one if it went out. */
function shipsOf(r: Release): Ship[] {
  const ships: Ship[] = (r.previousShips ?? []).map((s) => ({
    shippedDate: s.shippedDate,
    rolledBack: Boolean(s.rolledBackAt),
    rolledBackAt: s.rolledBackAt,
    gateIds: s.gateIds,
    gates: s.gates ?? {},
    gatesOpenAtShip: s.gatesOpenAtShip,
  }));
  if (wentOut(r)) {
    ships.push({
      shippedDate: r.shippedDate,
      rolledBack: r.status === "rolled_back",
      rolledBackAt: r.rolledBackAt,
      gateIds: r.gateIds,
      gates: r.gates ?? {},
      gatesOpenAtShip: r.gatesOpenAtShip,
    });
  }
  return ships.filter((s) => Boolean(s.shippedDate));
}

/** Every ship, oldest first by ship date. */
export function shipEvents(doc: ReleaseReadiness | undefined): ShipEvent[] {
  const events: ShipEvent[] = [];
  for (const r of doc?.releases ?? []) {
    for (const ship of shipsOf(r)) {
      const defs = gatesOf({ status: "shipped", gateIds: ship.gateIds }, doc);
      const skipped = defs.filter((g) => !ship.gates[g.id]).map((g) => g.id);
      events.push({
        releaseId: r.id,
        name: r.name,
        plannedDate: r.plannedDate,
        shippedDate: ship.shippedDate as string,
        rolledBack: ship.rolledBack,
        ...(ship.rolledBackAt ? { rolledBackAt: ship.rolledBackAt } : {}),
        gatesOpen: ship.gatesOpenAtShip ?? skipped.length,
        gatesTotal: defs.length,
        skippedGateIds: skipped,
      });
    }
  }
  return events.sort((a, b) => a.shippedDate.localeCompare(b.shippedDate));
}

const day = (iso: string) => iso.slice(0, 10);

/** Ships dated `from` to `to` (YYYY-MM-DD, both included). */
export function shippedBetween(
  events: readonly ShipEvent[],
  from: string,
  to: string
): ShipEvent[] {
  return events.filter((e) => day(e.shippedDate) >= from && day(e.shippedDate) <= to);
}

export interface OnTimeRate {
  /** % of ships that went out by their planned date, or null with none. */
  pct: number | null;
  /** Ships counted. */
  shipped: number;
  onTime: number;
  /** Of them, rolled back. */
  rolledBack: number;
}

/** "% on time" over every ship; a rolled-back ship still went out, so it counts. */
export function onTimeRate(events: readonly ShipEvent[]): OnTimeRate {
  const onTime = events.filter((e) => day(e.shippedDate) <= e.plannedDate).length;
  return {
    pct: events.length === 0 ? null : (onTime / events.length) * 100,
    shipped: events.length,
    onTime,
    rolledBack: events.filter((e) => e.rolledBack).length,
  };
}

export interface ReleaseStats extends OnTimeRate {
  /** Mean gates still open at ship; null with no ships. */
  avgGatesOpen: number | null;
  /** How often each gate was open at ship, out of the ships it applied to; most skipped first. */
  skippedByGate: { gateId: string; skipped: number; of: number }[];
}

/** The numbers Release Readiness shows, over every ship. */
export function releaseStats(doc: ReleaseReadiness | undefined): ReleaseStats {
  const events = shipEvents(doc);
  const tally = new Map<string, { skipped: number; of: number }>();
  for (const r of doc?.releases ?? []) {
    for (const ship of shipsOf(r)) {
      for (const g of gatesOf({ status: "shipped", gateIds: ship.gateIds }, doc)) {
        const t = tally.get(g.id) ?? { skipped: 0, of: 0 };
        t.of++;
        if (!ship.gates[g.id]) t.skipped++;
        tally.set(g.id, t);
      }
    }
  }
  return {
    ...onTimeRate(events),
    avgGatesOpen:
      events.length === 0 ? null : events.reduce((a, e) => a + e.gatesOpen, 0) / events.length,
    skippedByGate: Array.from(tally.entries())
      .map(([gateId, t]) => ({ gateId, ...t }))
      .sort((a, b) => b.skipped - a.skipped || a.gateId.localeCompare(b.gateId)),
  };
}
