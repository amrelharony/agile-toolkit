/**
 * Ceremony cadence — tool-local actions.
 *
 * Category: Sprint (the Sprint Cockpit's "Next ceremony" and the team charter)
 *
 * Agent surface: tool.ceremony_cadence.*
 * Backing CRUD : workspace.ceremony_cadence.* — one document under
 *                CEREMONY_CADENCE_ID, the row `useCeremonyCadence` reads, so
 *                a change here shows on /sprint and /team at once.
 *
 *   1. get — the cadence as the app uses it: normalised, the defaults when
 *            the team has not set one yet.
 *   2. set — patch some fields; the others keep their value (or default).
 *
 * Times are local "HH:MM"; weekdays are 0 = Sunday … 6 = Saturday; a sprint
 * is 1–60 calendar days long. A bad value is rejected, not defaulted.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import { CEREMONY_CADENCE_ID, type CeremonyCadenceDoc } from "@/lib/stores/workspace-types";
import { normalizeCadence, type CeremonyCadence } from "@/lib/sprints/cadence";
import { CeremonyCadencePatchSchema } from "@/lib/sprints/cadence-schema";

/** MUST match registerCollection("ceremonyCadence", …) in workspace-store.ts. */
const KIND = "workspace:ceremonyCadence";

const ws = () => useWorkspaceStore.getState();

function browserDoc(): CeremonyCadenceDoc | null {
  return (ws().ceremonyCadences ?? []).find((d) => d.id === CEREMONY_CADENCE_ID) ?? null;
}

/** What `get` returns, and `set` after writing. */
function reading(doc: CeremonyCadenceDoc | null): { exists: boolean; cadence: CeremonyCadence } {
  return { exists: doc !== null, cadence: normalizeCadence(doc) };
}

/** The document after a patch: the current (or default) cadence with the patch over it. */
function patched(
  doc: CeremonyCadenceDoc | null,
  patch: Partial<CeremonyCadence>
): CeremonyCadenceDoc {
  const given = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  return { id: CEREMONY_CADENCE_ID, ...normalizeCadence({ ...normalizeCadence(doc), ...given }) };
}

// ──────── tool.ceremony_cadence.get ────────
registry.register({
  id: "tool.ceremony_cadence.get",
  toolId: "tool.ceremony_cadence",
  name: "get",
  category: "read",
  description:
    "The team's ceremony cadence as the app uses it: sprintLengthDays, dailyTime and dailyWeekdays (0 = Sunday … 6 = Saturday), planningTime (day 0), reviewTime and retroTime (last day), refinement {weekday, time} or null. Times are local HH:MM. Returns {exists, cadence}; exists is false while the team still runs on the defaults.",
  paramsSchema: z.object({}),
  handler: async () => reading(browserDoc()),
  mcpHandler: async (_params, ctx) =>
    reading(await serverGetEntity<CeremonyCadenceDoc>(ctx.userId, KIND, CEREMONY_CADENCE_ID)),
});

// ──────── tool.ceremony_cadence.set ────────
registry.register({
  id: "tool.ceremony_cadence.set",
  toolId: "tool.ceremony_cadence",
  name: "set",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set some of the team's ceremony cadence; fields left out keep their value (the default when unset). Times are local HH:MM, weekdays 0 = Sunday … 6 = Saturday, sprintLengthDays 1–60, refinement {weekday, time} or null for no fixed slot. Creates the cadence document when there is none. Returns {updated: true, exists: true, cadence}.",
  paramsSchema: CeremonyCadencePatchSchema,
  handler: async (params) => {
    const next = patched(browserDoc(), params);
    ws().upsertCeremonyCadence(next);
    return { updated: true, ...reading(next) };
  },
  mcpHandler: async (params, ctx) => {
    const current = await serverGetEntity<CeremonyCadenceDoc>(
      ctx.userId,
      KIND,
      CEREMONY_CADENCE_ID
    );
    const next = patched(current, params);
    await serverUpsertEntity<CeremonyCadenceDoc>(ctx.userId, KIND, next);
    return { updated: true, ...reading(next) };
  },
});
