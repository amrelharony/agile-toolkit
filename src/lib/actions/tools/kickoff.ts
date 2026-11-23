/**
 * Kickoff — tool-local actions.
 *
 * Category: Strategic Planning (tools plan, phase 2)
 *
 * Agent surface: tool.kickoff.*
 * Backing CRUD : workspace.kickoff.* (create, list, update, delete): one
 *                Kickoff per team or piece of work, under its own id
 *                ("kickoff_…"), kind KICKOFF_KIND.
 *
 *   1. list_state  — every kickoff with its format, sections, sliders and
 *                    what's still open, newest change first, plus the
 *                    team's purpose (the newest agreed Team Canvas).
 *                    Example kickoffs are listed and marked, but left out of
 *                    the totals and the purpose, as the page does.
 *   2. start       — a new kickoff in one of the six formats: a Team Canvas
 *                    starts with the team's people, an Inception deck or
 *                    Trade-offs with the default sliders.
 *   3. add_items   — lines in one section, within its room.
 *   4. set_sliders — the trade-offs' order, holds firm first.
 *   5. set_status  — agree it, or put it back to draft.
 *
 * Every write reads the row through lib/kickoff/model and stamps updatedAt
 * as the page does. Writes to example kickoffs are refused ("example").
 * Sending lines on (risks, rules, scope) stays on the page. Nothing here
 * reaches other people: every verb is the visitor's own data.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import {
  KICKOFF_BRIEF_MAX,
  KICKOFF_FORMATS,
  KICKOFF_ITEM_MAX,
  KICKOFF_KIND,
  KICKOFF_SLIDER_LABEL_MAX,
  KICKOFF_STATUSES,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type Kickoff,
  type KickoffItem,
  type TeamMember,
} from "@/lib/stores/workspace-types";
import { KICKOFF_FORMAT_DEFS, kickoffSection } from "@/lib/kickoff/formats";
import {
  answerOf,
  blankKickoff,
  coveringItems,
  cutLine,
  fitsRow,
  formatOf,
  isRated,
  itemsOf,
  kickoffGaps,
  newKickoffId,
  newKickoffItemId,
  normalizeKickoff,
  oneLine,
  orderedSliders,
  readKickoffs,
  statementFrom,
  teamPurpose,
  withSectionItems,
  withSliderOrder,
  withStatus,
} from "@/lib/kickoff/model";
import { lineKey, roomLeft } from "@/lib/sectioned/model";
import { cutText } from "@/lib/utils/cut-text";
import { isExampleId } from "@/lib/utils/example-id";

const ws = () => useWorkspaceStore.getState();
const nowIso = () => new Date().toISOString();
const KIND_TEAM = "workspace:teamMember";

/** Where the verbs read and write: the browser's store, or the user's rows on the server. */
interface Store {
  list: () => Promise<unknown[]>;
  get: (id: string) => Promise<unknown | null>;
  put: (k: Kickoff) => Promise<void>;
  roster: () => Promise<TeamMember[]>;
}

const browserStore: Store = {
  list: async () => ws().kickoffs ?? [],
  get: async (id) => (ws().kickoffs ?? []).find((k) => k.id === id) ?? null,
  put: async (k) => ws().upsertKickoff(k),
  roster: async () => ws().teamMembers ?? [],
};

const serverStore = (userId: string): Store => ({
  list: () => serverListEntities<Kickoff>(userId, KICKOFF_KIND),
  get: (id) => serverGetEntity<Kickoff>(userId, KICKOFF_KIND, id),
  put: async (k) => {
    await serverUpsertEntity<Kickoff>(userId, KICKOFF_KIND, k);
  },
  roster: () => serverListEntities<TeamMember>(userId, KIND_TEAM),
});

/** The kickoff to write, or why not. */
async function writable(
  store: Store,
  id: string
): Promise<{ kickoff: Kickoff } | { reason: "not_found" | "example" }> {
  const k = normalizeKickoff(await store.get(id));
  if (!k) return { reason: "not_found" };
  if (isExampleId(k.id)) return { reason: "example" };
  return { kickoff: k };
}

function summarize(rows: readonly unknown[]) {
  const kickoffs = readKickoffs(rows);
  const real = kickoffs.filter((k) => !isExampleId(k.id));
  const byFormat = Object.fromEntries(KICKOFF_FORMATS.map((f) => [f, 0])) as Record<
    (typeof KICKOFF_FORMATS)[number],
    number
  >;
  for (const k of real) byFormat[k.format]++;
  return {
    total: real.length,
    byFormat,
    teamPurpose: teamPurpose(real),
    kickoffs: kickoffs.map((k) => {
      const format = formatOf(k);
      return {
        id: k.id,
        example: isExampleId(k.id),
        title: k.title,
        format: k.format,
        formatName: format.name,
        status: k.status,
        agreedAt: k.agreedAt ?? null,
        date: k.date ?? null,
        participants: k.participants ?? [],
        brief: k.brief ?? null,
        sections: format.sections.map((def) => {
          const items = itemsOf(k, def.id);
          return {
            id: def.id,
            label: def.label,
            kind: def.kind,
            count: items.length,
            max: def.kind === "list" ? def.max : 1,
            items: items.map((item) => ({
              id: item.id,
              text: item.text,
              owner: item.owner ?? null,
              ...(def.ratings
                ? {
                    likelihood: item.likelihood ?? null,
                    impact: item.impact ?? null,
                    rated: isRated(item),
                  }
                : {}),
              ...(def.coverTarget ? { covered: coveringItems(k, item.id).length > 0 } : {}),
              ...(def.covers ? { covers: item.covers ?? null } : {}),
              sentTo: (item.sentTo ?? []).map((l) => l.route),
            })),
          };
        }),
        sliders: format.hasSliders
          ? orderedSliders(k).map((s) => ({
              label: s.label,
              position: s.position,
              note: s.note ?? null,
            }))
          : null,
        slidersSet: Boolean(k.slidersSetAt),
        gaps: kickoffGaps(k).map((g) => g.text),
        statement:
          k.format === "problem-framing" ? answerOf(k, "statement") || statementFrom(k) : null,
        updatedAt: k.updatedAt,
      };
    }),
  };
}

// ──────── tool.kickoff.list_state ────────
registry.register({
  id: "tool.kickoff.list_state",
  toolId: "tool.kickoff",
  name: "list_state",
  category: "read",
  description:
    "Summarise the kickoffs, newest change first. Each is one of six formats: 'alignment-map' (Team Alignment Map), 'project-poster' (Project Poster), 'team-canvas' (Team Canvas), 'inception' (Inception deck), 'trade-offs' (trade-off sliders) or 'problem-framing' (problem framing). Returns {total, byFormat, teamPurpose: {kickoffId, text}|null (the newest agreed Team Canvas's purpose) (total, byFormat and teamPurpose leave example kickoffs out), kickoffs:{id, example (true for an example from Load example), title, format, formatName, status ('draft'|'agreed'), agreedAt|null, date|null, participants, brief|null, sections:{id, label, kind, count, max, items:{id, text, owner|null, likelihood|null and impact|null and rated (worries and weaknesses), covered (worries), covers|null (the worry id a commitment, resource or need answers), sentTo (routes)}[]}[], sliders:{label, position (1 holds firm), note|null}[]|null, slidersSet, gaps (what's still open, as sentences), statement|null (problem framing), updatedAt}[]}. Create, edit or delete a kickoff with workspace.kickoff.*.",
  paramsSchema: z.object({}),
  handler: async () => summarize(await browserStore.list()),
  mcpHandler: async (_params, ctx) => summarize(await serverStore(ctx.userId).list()),
});

const StartParams = z.object({
  format: z
    .enum(KICKOFF_FORMATS)
    .describe(
      "'alignment-map' (who does what), 'project-poster' (the problem and how you'll know it worked), 'team-canvas' (a new team), 'inception' (a big piece of work), 'trade-offs' (what gives first) or 'problem-framing' (a problem in one line)."
    ),
  title: z
    .string()
    .trim()
    .min(1)
    .max(TOOL_TEXT_MAX.short)
    .describe("The team or the work it starts."),
  brief: z
    .string()
    .trim()
    .max(KICKOFF_BRIEF_MAX)
    .optional()
    .describe("What this is and why now, in a sentence or two."),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("When the kickoff is, YYYY-MM-DD."),
});

async function start(store: Store, params: z.infer<typeof StartParams>) {
  const roster =
    params.format === "team-canvas" ? (await store.roster()).filter((m) => !isExampleId(m.id)) : [];
  const now = nowIso();
  const k = blankKickoff({
    id: newKickoffId(),
    format: params.format,
    title: params.title,
    ...(params.brief ? { brief: params.brief } : {}),
    ...(params.date ? { date: params.date } : {}),
    roster,
    now,
  });
  await store.put(k);
  return { created: true as const, kickoffId: k.id };
}

// ──────── tool.kickoff.start ────────
registry.register({
  id: "tool.kickoff.start",
  toolId: "tool.kickoff",
  name: "start",
  category: "write",
  requiresConfirmation: false,
  description:
    "Start a kickoff in one of the six formats, as a draft. A Team Canvas starts with the team's people (from the Team page, each with their role); an Inception deck or trade-off sliders start with Scope, Date, Cost and Quality. Returns {created: true, kickoffId}. Fill it in with add_items.",
  paramsSchema: StartParams,
  handler: (params) => start(browserStore, params),
  mcpHandler: (params, ctx) => start(serverStore(ctx.userId), params),
});

const AddItemsParams = z.object({
  kickoffId: z.string().min(1).describe("The kickoff's id (see list_state)."),
  section: z
    .string()
    .min(1)
    .max(32)
    .describe("The section's id in the kickoff's format (list_state lists them)."),
  items: z
    .array(
      z.object({
        text: z
          .string()
          .trim()
          .max(KICKOFF_ITEM_MAX)
          .describe("The line. For the team's people, their role (may be empty with an owner)."),
        owner: z
          .string()
          .trim()
          .max(TOOL_TEXT_MAX.short)
          .optional()
          .describe("Who owns it, for sections with an owner; for the team's people, the person."),
      })
    )
    .min(1)
    .max(10),
  replace: z
    .boolean()
    .optional()
    .describe("For a section that holds one answer: replace the answer that is there."),
});

type AddReason =
  | "not_found"
  | "example"
  | "unknown_section"
  | "full"
  | "single_filled"
  | "too_large";

async function addItems(store: Store, params: z.infer<typeof AddItemsParams>) {
  const found = await writable(store, params.kickoffId);
  if (!("kickoff" in found)) {
    return { added: 0, skipped: params.items.length, reason: found.reason as AddReason };
  }
  const k = found.kickoff;
  const def = kickoffSection(formatOf(k), params.section);
  if (!def)
    return { added: 0, skipped: params.items.length, reason: "unknown_section" as AddReason };
  const current = itemsOf(k, def.id);
  const fresh = params.items
    .map((i) => ({
      text: cutText(oneLine(i.text), KICKOFF_ITEM_MAX),
      owner: def.owner ? cutLine(i.owner ?? "", TOOL_TEXT_MAX.short) : "",
    }))
    .filter((i) => i.text || i.owner);
  let next: KickoffItem[];
  let added = 0;
  let reason: AddReason | undefined;
  if (def.kind !== "list") {
    const first = fresh[0];
    if (current.length > 0 && !params.replace) {
      return { added: 0, skipped: params.items.length, reason: "single_filled" as AddReason };
    }
    if (!first) return { added: 0, skipped: params.items.length };
    // A new answer: where the old one was sent doesn't carry over.
    next = [{ id: newKickoffItemId(), text: first.text }];
    added = 1;
  } else {
    const seen = new Set(current.map((i) => `${lineKey(i.text)}\u0000${lineKey(i.owner ?? "")}`));
    let room = roomLeft(def, current);
    next = [...current];
    for (const i of fresh) {
      const key = `${lineKey(i.text)}\u0000${lineKey(i.owner)}`;
      if (seen.has(key)) continue;
      if (room <= 0) {
        reason = "full";
        break;
      }
      seen.add(key);
      next.push({ id: newKickoffItemId(), text: i.text, ...(i.owner ? { owner: i.owner } : {}) });
      room--;
      added++;
    }
    if (added === 0 && !reason && roomLeft(def, current) === 0) reason = "full";
  }
  if (added === 0) {
    return { added: 0, skipped: params.items.length, ...(reason ? { reason } : {}) };
  }
  const written = withSectionItems(k, def.id, next, nowIso());
  if (!fitsRow(written)) {
    return { added: 0, skipped: params.items.length, reason: "too_large" as AddReason };
  }
  await store.put(written);
  return { added, skipped: params.items.length - added, ...(reason ? { reason } : {}) };
}

// ──────── tool.kickoff.add_items ────────
registry.register({
  id: "tool.kickoff.add_items",
  toolId: "tool.kickoff",
  name: "add_items",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add lines to one section of a kickoff, up to the room it has left; a line it already holds is skipped. For a section that holds one answer, pass replace: true to change the answer there. Owners go only where the section has an owner; for a Team Canvas's 'people', the owner is the person and the text their role. Returns {added, skipped, reason?}: reason 'not_found', 'example' (example kickoffs aren't changed), 'unknown_section', 'full' (some or all didn't fit), 'single_filled' or 'too_large'.",
  paramsSchema: AddItemsParams,
  handler: (params) => addItems(browserStore, params),
  mcpHandler: (params, ctx) => addItems(serverStore(ctx.userId), params),
});

const SetSlidersParams = z.object({
  kickoffId: z.string().min(1).describe("The kickoff's id (see list_state)."),
  order: z
    .array(z.string().trim().min(1).max(KICKOFF_SLIDER_LABEL_MAX))
    .min(2)
    .max(TOOL_LIST_MAX.kickoffSliders)
    .describe(
      "Trade-off labels from what holds firm to what gives first, matched with case ignored. A new label is added if there is room; labels left out keep their order after these."
    ),
});

async function setSliders(store: Store, params: z.infer<typeof SetSlidersParams>) {
  const found = await writable(store, params.kickoffId);
  if (!("kickoff" in found)) return { set: false as const, reason: found.reason };
  const k = found.kickoff;
  if (!KICKOFF_FORMAT_DEFS[k.format].hasSliders) {
    return { set: false as const, reason: "no_sliders" as const };
  }
  const result = withSliderOrder(orderedSliders(k), params.order);
  if (!result.ok) return { set: false as const, reason: result.reason };
  const now = nowIso();
  await store.put({ ...k, sliders: result.sliders, slidersSetAt: now, updatedAt: now });
  return { set: true as const, order: result.sliders.map((s) => s.label) };
}

// ──────── tool.kickoff.set_sliders ────────
registry.register({
  id: "tool.kickoff.set_sliders",
  toolId: "tool.kickoff",
  name: "set_sliders",
  category: "write",
  requiresConfirmation: false,
  description:
    "Put an Inception deck's or trade-off sliders' trade-offs in order, from what holds firm to what gives first, and mark the order as set. Returns {set: true, order}, or {set: false, reason: 'not_found' | 'example' | 'no_sliders' (the format has none) | 'duplicate' | 'too_many'} (8 at most).",
  paramsSchema: SetSlidersParams,
  handler: (params) => setSliders(browserStore, params),
  mcpHandler: (params, ctx) => setSliders(serverStore(ctx.userId), params),
});

const SetStatusParams = z.object({
  kickoffId: z.string().min(1).describe("The kickoff's id (see list_state)."),
  status: z.enum(KICKOFF_STATUSES).describe("'agreed' once the team agrees it, or 'draft'."),
});

async function setStatus(store: Store, params: z.infer<typeof SetStatusParams>) {
  const found = await writable(store, params.kickoffId);
  if (!("kickoff" in found)) return { updated: false as const, reason: found.reason };
  const k = found.kickoff;
  if (k.status === params.status) return { updated: true as const, status: k.status };
  await store.put(withStatus(k, params.status, nowIso()));
  return { updated: true as const, status: params.status };
}

// ──────── tool.kickoff.set_status ────────
registry.register({
  id: "tool.kickoff.set_status",
  toolId: "tool.kickoff",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Mark a kickoff agreed (the team agrees it), or put it back to draft. Returns {updated: true, status}, or {updated: false, reason: 'not_found' | 'example'}.",
  paramsSchema: SetStatusParams,
  handler: (params) => setStatus(browserStore, params),
  mcpHandler: (params, ctx) => setStatus(serverStore(ctx.userId), params),
});
