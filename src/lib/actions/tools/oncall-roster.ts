/**
 * On-call Roster — tool-local actions.
 *
 * Category: Incidents & Reliability (squad S8)
 * Tool:     On-call shifts + paging load with an expected-pages baseline.
 *
 * Agent surface: tool.oncall_roster.*
 * Backing CRUD : workspace.oncall_roster.* (auto-generated). Singleton: one
 *                OncallRoster document (shifts[]/pages[]) under a fixed id.
 *
 *   1. list_state         — shifts (+pageCount), totals, severity/person tallies.
 *   2. add_shift          — add a shift (rejects endDate < startDate).
 *   3. remove_shift       — delete a shift AND cascade its pages.
 *   4. log_page           — log a page against an existing shift.
 *   5. remove_page        — delete a page by id.
 *   6. set_expected_pages — set the expected-pages-per-week baseline.
 *
 * Entity kind "workspace:oncallRoster" + the fixed OR_ID match
 * oncall-roster-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { OncallRoster, OncallShift, OncallPage } from "@/lib/stores/workspace-types";

const KIND_OR = "workspace:oncallRoster";
// MUST match OR_ID in oncall-roster-client.tsx.
const OR_ID = "oncallRoster:current";

const ws = () => useWorkspaceStore.getState();

const nowISO = () => new Date().toISOString();

function emptyDoc(): OncallRoster {
  return { id: OR_ID, shifts: [], pages: [] };
}

function browserDoc(): OncallRoster | null {
  return (ws().oncallRosters ?? []).find((d) => d.id === OR_ID) ?? null;
}

function summarize(doc: OncallRoster | null) {
  const shifts = doc?.shifts ?? [];
  const pages = doc?.pages ?? [];
  const pagesBySeverity = { sev1: 0, sev2: 0, sev3: 0, sev4: 0 };
  for (const p of pages) pagesBySeverity[p.severity]++;
  const personByShift = new Map(shifts.map((s) => [s.id, s.person]));
  const pagesByPerson: Record<string, number> = {};
  const countByShift: Record<string, number> = {};
  for (const p of pages) {
    countByShift[p.shiftId] = (countByShift[p.shiftId] ?? 0) + 1;
    const person = personByShift.get(p.shiftId);
    if (person) pagesByPerson[person] = (pagesByPerson[person] ?? 0) + 1;
  }
  return {
    exists: doc !== null,
    totalShifts: shifts.length,
    totalPages: pages.length,
    expectedPagesPerWeek: doc?.expectedPagesPerWeek,
    pagesBySeverity,
    pagesByPerson,
    shifts: shifts.map((s) => ({
      id: s.id,
      person: s.person,
      startDate: s.startDate,
      endDate: s.endDate,
      pageCount: countByShift[s.id] ?? 0,
    })),
  };
}

// ──────── tool.oncall_roster.list_state ────────
registry.register({
  id: "tool.oncall_roster.list_state",
  toolId: "tool.oncall_roster",
  name: "list_state",
  category: "read",
  description:
    "Summarise the on-call roster. Returns {exists, totalShifts, totalPages, expectedPagesPerWeek, pagesBySeverity:{sev1..sev4}, pagesByPerson:{name:count} (burnout), shifts:{id,person,startDate,endDate,pageCount}[]}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<OncallRoster>(ctx.userId, KIND_OR, OR_ID);
    return summarize(doc ?? null);
  },
});

const shiftParams = z.object({
  person: z.string().min(1).max(200),
  startDate: z.string().min(1).max(40),
  endDate: z.string().min(1).max(40),
  description: z.string().max(2000).optional(),
});

// ──────── tool.oncall_roster.add_shift ────────
registry.register({
  id: "tool.oncall_roster.add_shift",
  toolId: "tool.oncall_roster",
  name: "add_shift",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add an on-call shift. Dates are YYYY-MM-DD. Returns {added:false} when endDate is before startDate, else {added:true, id}.",
  paramsSchema: shiftParams,
  handler: async (params) => {
    if (params.endDate < params.startDate) return { added: false };
    const base = browserDoc() ?? emptyDoc();
    const shift = newShift(params);
    ws().upsertOncallRoster({ ...base, id: OR_ID, shifts: [...base.shifts, shift] });
    return { added: true, id: shift.id };
  },
  mcpHandler: async (params, ctx) => {
    if (params.endDate < params.startDate) return { added: false };
    const base = (await serverGetEntity<OncallRoster>(ctx.userId, KIND_OR, OR_ID)) ?? emptyDoc();
    const shift = newShift(params);
    await serverUpsertEntity<OncallRoster>(ctx.userId, KIND_OR, {
      ...base,
      id: OR_ID,
      shifts: [...base.shifts, shift],
    });
    return { added: true, id: shift.id };
  },
});

// ──────── tool.oncall_roster.remove_shift ────────
registry.register({
  id: "tool.oncall_roster.remove_shift",
  toolId: "tool.oncall_roster",
  name: "remove_shift",
  category: "write",
  requiresConfirmation: false,
  description:
    "Delete a shift by id and cascade-remove its pages. Returns {removed:false} when the id is unknown.",
  paramsSchema: z.object({ shiftId: z.string() }),
  handler: async (params) => {
    const next = applyRemoveShift(browserDoc(), params.shiftId);
    if (!next) return { removed: false };
    ws().upsertOncallRoster(next);
    return { removed: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<OncallRoster>(ctx.userId, KIND_OR, OR_ID);
    const next = applyRemoveShift(base ?? null, params.shiftId);
    if (!next) return { removed: false };
    await serverUpsertEntity<OncallRoster>(ctx.userId, KIND_OR, next);
    return { removed: true };
  },
});

const pageParams = z.object({
  shiftId: z.string(),
  severity: z.enum(["sev1", "sev2", "sev3", "sev4"]),
  ts: z.string().max(40).optional(),
  description: z.string().max(2000).optional(),
});

// ──────── tool.oncall_roster.log_page ────────
registry.register({
  id: "tool.oncall_roster.log_page",
  toolId: "tool.oncall_roster",
  name: "log_page",
  category: "write",
  requiresConfirmation: false,
  description:
    "Log a page against an existing shift. severity is sev1..sev4; ts defaults to now (ISO). Returns {logged:false} when the shiftId is unknown, else {logged:true, id}.",
  paramsSchema: pageParams,
  handler: async (params) => {
    const r = applyLogPage(browserDoc(), params);
    if (!r) return { logged: false };
    ws().upsertOncallRoster(r.doc);
    return { logged: true, id: r.id };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<OncallRoster>(ctx.userId, KIND_OR, OR_ID);
    const r = applyLogPage(base ?? null, params);
    if (!r) return { logged: false };
    await serverUpsertEntity<OncallRoster>(ctx.userId, KIND_OR, r.doc);
    return { logged: true, id: r.id };
  },
});

// ──────── tool.oncall_roster.remove_page ────────
registry.register({
  id: "tool.oncall_roster.remove_page",
  toolId: "tool.oncall_roster",
  name: "remove_page",
  category: "write",
  requiresConfirmation: false,
  description: "Delete a page by id. Returns {removed:false} when the id is unknown.",
  paramsSchema: z.object({ pageId: z.string() }),
  handler: async (params) => {
    const next = applyRemovePage(browserDoc(), params.pageId);
    if (!next) return { removed: false };
    ws().upsertOncallRoster(next);
    return { removed: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<OncallRoster>(ctx.userId, KIND_OR, OR_ID);
    const next = applyRemovePage(base ?? null, params.pageId);
    if (!next) return { removed: false };
    await serverUpsertEntity<OncallRoster>(ctx.userId, KIND_OR, next);
    return { removed: true };
  },
});

// ──────── tool.oncall_roster.set_expected_pages ────────
registry.register({
  id: "tool.oncall_roster.set_expected_pages",
  toolId: "tool.oncall_roster",
  name: "set_expected_pages",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set the expected-pages-per-week baseline used for capacity planning. Creates the roster if absent. Returns {updated:true}.",
  paramsSchema: z.object({ expectedPagesPerWeek: z.number().min(0).max(10000) }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    ws().upsertOncallRoster({
      ...base,
      id: OR_ID,
      expectedPagesPerWeek: params.expectedPagesPerWeek,
    });
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = (await serverGetEntity<OncallRoster>(ctx.userId, KIND_OR, OR_ID)) ?? emptyDoc();
    await serverUpsertEntity<OncallRoster>(ctx.userId, KIND_OR, {
      ...base,
      id: OR_ID,
      expectedPagesPerWeek: params.expectedPagesPerWeek,
    });
    return { updated: true };
  },
});

function newShift(params: z.infer<typeof shiftParams>): OncallShift {
  return {
    id: crypto.randomUUID(),
    person: params.person,
    startDate: params.startDate,
    endDate: params.endDate,
    description: params.description,
  };
}

function applyRemoveShift(doc: OncallRoster | null, shiftId: string): OncallRoster | null {
  if (!doc || !doc.shifts.some((s) => s.id === shiftId)) return null;
  return {
    ...doc,
    shifts: doc.shifts.filter((s) => s.id !== shiftId),
    pages: doc.pages.filter((p) => p.shiftId !== shiftId),
  };
}

function applyLogPage(
  doc: OncallRoster | null,
  params: z.infer<typeof pageParams>
): { doc: OncallRoster; id: string } | null {
  if (!doc || !doc.shifts.some((s) => s.id === params.shiftId)) return null;
  const page: OncallPage = {
    id: crypto.randomUUID(),
    shiftId: params.shiftId,
    ts: params.ts || nowISO(),
    severity: params.severity,
    description: params.description,
  };
  return { doc: { ...doc, pages: [...doc.pages, page] }, id: page.id };
}

function applyRemovePage(doc: OncallRoster | null, pageId: string): OncallRoster | null {
  if (!doc || !doc.pages.some((p) => p.id === pageId)) return null;
  return { ...doc, pages: doc.pages.filter((p) => p.id !== pageId) };
}
