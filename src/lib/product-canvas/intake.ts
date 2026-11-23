/**
 * The idea inbox: every idea canvas, filtered by status and sorted by how
 * many asked for it, then by the newest; how many wait in each status; a
 * merge, which joins a duplicate into the idea it repeats (following a
 * chain of merges to its root) so the root keeps every ask; and taking one
 * out of its merge, which gives those asks back.
 *
 * One idea is one canvas (format "idea"), its intake beside its boxes, so
 * a big inbox is many small rows, never one big one. Single-idea writes
 * (asked again, triage) are the canvas model's; this module holds what
 * spans several ideas. Example ideas and the team's never mix: callers
 * pass one or the other.
 *
 * Pure and server-safe: no zod, no React, no store, no "use client" import.
 */

import {
  PRODUCT_IDEA_STATUSES,
  type ProductCanvas,
  type ProductIdeaStatus,
} from "@/lib/stores/workspace-types";
import { DEMAND_MAX, NEW_INTAKE, REQUESTERS_MAX, cleanRequesters, isOpenStatus } from "./fields";
import { finishAll, withIdeaStatus, type CanvasRefused, type TriageStatus } from "./model";

/** What the inbox can show: the open ideas, one status, or every idea. */
export const INBOX_FILTERS = ["open", ...PRODUCT_IDEA_STATUSES, "all"] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export const INBOX_FILTER_LABEL: Record<InboxFilter, string> = {
  open: "Open",
  new: "New",
  assessing: "Assessing",
  accepted: "Accepted",
  declined: "Declined",
  merged: "Merged",
  all: "All",
};

/** A stored inbox filter: a known one, or "open". */
export function readInboxFilter(raw: unknown): InboxFilter {
  return typeof raw === "string" && (INBOX_FILTERS as readonly string[]).includes(raw)
    ? (raw as InboxFilter)
    : "open";
}

const statusOf = (c: ProductCanvas): ProductIdeaStatus => c.intake?.status ?? "new";
const demandOf = (c: ProductCanvas) => c.intake?.demand ?? 1;

/** The idea canvases among `canvases`. */
export const ideasOf = (canvases: readonly ProductCanvas[]): ProductCanvas[] =>
  canvases.filter((c) => c.format === "idea");

/** Whether an idea is still in play: new, being assessed or accepted. */
export const isOpenIdea = (c: ProductCanvas) => c.format === "idea" && isOpenStatus(statusOf(c));

/** The inbox as `filter` shows it: most asked for first, then the newest, then by id. */
export function inboxView(
  canvases: readonly ProductCanvas[],
  filter: InboxFilter = "open"
): ProductCanvas[] {
  return ideasOf(canvases)
    .filter((c) =>
      filter === "all" ? true : filter === "open" ? isOpenIdea(c) : statusOf(c) === filter
    )
    .sort(
      (a, b) =>
        demandOf(b) - demandOf(a) ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.id.localeCompare(b.id)
    );
}

/** How many ideas wait in each status, and how many are open. */
export function inboxCounts(
  canvases: readonly ProductCanvas[]
): Record<ProductIdeaStatus, number> & { open: number; all: number } {
  const out = { new: 0, assessing: 0, accepted: 0, declined: 0, merged: 0, open: 0, all: 0 };
  for (const c of ideasOf(canvases)) {
    out[statusOf(c)]++;
    out.all++;
    if (isOpenIdea(c)) out.open++;
  }
  return out;
}

/**
 * The idea `id` ends up in: itself, or the root its merges lead to. Null
 * when it isn't an idea here, or its chain loops or leads to an idea that
 * is gone.
 */
export function rootOf(id: string, canvases: readonly ProductCanvas[]): ProductCanvas | null {
  const byId = new Map(ideasOf(canvases).map((c) => [c.id, c]));
  const seen = new Set<string>();
  let at = byId.get(id);
  while (at) {
    if (seen.has(at.id)) return null;
    seen.add(at.id);
    if (statusOf(at) !== "merged" || !at.intake?.mergedInto) return at;
    at = byId.get(at.intake.mergedInto);
  }
  return null;
}

export type MergeResult =
  | { ok: true; root: ProductCanvas; duplicate: ProductCanvas }
  | CanvasRefused;

/**
 * `duplicate` merged into `into`'s root: the root's demand grows by the
 * duplicate's (to DEMAND_MAX at most) and it gains the duplicate's
 * requesters (each once, REQUESTERS_MAX at most); the duplicate becomes
 * merged, naming the root. Refused for an idea already merged, a merge
 * into itself or into an idea merged into it (its root would be the
 * duplicate), and a chain that loops or ends in an idea that is gone. Both
 * are stamped `now`; the caller writes both, and its Undo puts both back.
 */
export function mergeIdeas(
  duplicate: ProductCanvas,
  into: ProductCanvas,
  canvases: readonly ProductCanvas[],
  now: string
): MergeResult {
  const fail = (reason: "merged" | "self_merge" | "not_found", message: string) =>
    ({ ok: false, reason, message }) as const;
  if (duplicate.format !== "idea" || into.format !== "idea") {
    return { ok: false, reason: "wrong_format", message: "Only ideas in the inbox are merged." };
  }
  if (statusOf(duplicate) === "merged") {
    return fail("merged", "This idea is already merged into another.");
  }
  const pool = [
    ...canvases.filter((c) => c.id !== duplicate.id && c.id !== into.id),
    duplicate,
    into,
  ];
  const root = rootOf(into.id, pool);
  if (!root)
    return fail("not_found", "That idea's merges lead to an idea that isn't here any more.");
  if (root.id === duplicate.id) {
    return fail(
      "self_merge",
      into.id === duplicate.id
        ? "An idea can't be merged into itself."
        : "That idea was merged into this one: merge it the other way round."
    );
  }
  const rootIntake = root.intake ?? { ...NEW_INTAKE, requesters: [] };
  const dupIntake = duplicate.intake ?? { ...NEW_INTAKE, requesters: [] };
  const requesters = cleanRequesters([...rootIntake.requesters, ...dupIntake.requesters]).slice(
    0,
    REQUESTERS_MAX
  );
  const written = finishAll(
    [
      {
        ...root,
        intake: {
          ...rootIntake,
          demand: Math.min(DEMAND_MAX, rootIntake.demand + dupIntake.demand),
          requesters,
        },
      },
      {
        ...duplicate,
        intake: { ...dupIntake, status: "merged", mergedInto: root.id },
      },
    ],
    now
  );
  if (!written.ok) return written;
  const [nextRoot, nextDuplicate] = written.canvases;
  return { ok: true, root: nextRoot, duplicate: nextDuplicate };
}

/**
 * The ideas a merged idea's demand was added to: the one it went into, then
 * each one that idea was merged into, up to the root. A merge adds to the
 * root of its day, and that root's own later merge carries the sum on, so
 * every idea along the chain counts the duplicate's asks. Stops at a loop
 * or an idea that is gone.
 */
function carriersOf(duplicate: ProductCanvas, canvases: readonly ProductCanvas[]): ProductCanvas[] {
  const byId = new Map(
    ideasOf(canvases)
      .filter((c) => c.id !== duplicate.id)
      .map((c) => [c.id, c])
  );
  const out: ProductCanvas[] = [];
  const seen = new Set<string>();
  let next = duplicate.intake?.mergedInto;
  while (next) {
    const at = byId.get(next);
    if (!at || seen.has(at.id)) break;
    seen.add(at.id);
    out.push(at);
    next = statusOf(at) === "merged" ? at.intake?.mergedInto : undefined;
  }
  return out;
}

export type UnmergeResult =
  | {
      ok: true;
      /** The idea out of its merge, with its new status. */
      duplicate: ProductCanvas;
      /** The ideas that gave its demand back, the one it went into first, the root last. */
      carriers: ProductCanvas[];
    }
  | CanvasRefused;

/**
 * A merged idea taken out of its merge and triaged to `status` (its note
 * as `withIdeaStatus` takes one). Every idea along its chain of merges, up
 * to the root, gives back the demand the merge added (never below 1), so
 * merging it again counts its asks once. Who asked stays listed there: a
 * name may have asked for both. An idea that isn't merged is only triaged.
 * All are stamped `now`; the caller writes them all, and its Undo puts
 * them back.
 */
export function unmergeIdea(
  duplicate: ProductCanvas,
  status: TriageStatus,
  note: string | undefined,
  canvases: readonly ProductCanvas[],
  now: string
): UnmergeResult {
  if (duplicate.format !== "idea") {
    return { ok: false, reason: "wrong_format", message: "Only an idea in the inbox is triaged." };
  }
  const intake = duplicate.intake ?? { ...NEW_INTAKE, requesters: [] };
  const merged = statusOf(duplicate) === "merged";
  // Triage rebuilds the intake without `mergedInto`; it only refuses the merged status.
  const freed: ProductCanvas = merged
    ? { ...duplicate, intake: { ...intake, status: "new" } }
    : duplicate;
  const w = withIdeaStatus(freed, status, note, now);
  if (!w.ok) return w;
  if (!merged) return { ok: true, duplicate: w.canvas, carriers: [] };
  const given = carriersOf(duplicate, canvases).map((c) => {
    const ci = c.intake ?? { ...NEW_INTAKE, requesters: [] };
    return { ...c, intake: { ...ci, demand: Math.max(1, ci.demand - intake.demand) } };
  });
  const written = finishAll(given, now);
  if (!written.ok) return written;
  return { ok: true, duplicate: w.canvas, carriers: written.canvases };
}
