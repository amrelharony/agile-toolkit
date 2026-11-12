/**
 * Parking Lot's reading of its records (workspace.parkingLotItems): the page,
 * its agent verbs, its export and its next step all read them through here.
 *
 * A point is parked "open", then decided: discussed, sent to another tool
 * (the backlog, the Impediment Tracker or Retro Actions, through the
 * hand-off routes in lib/handoffs) or dropped. Where it went is recorded the
 * way every hand-off source records it, as HandoffLink[] in `sentTo`, so
 * sendHandoff and liveLink work on it, and the item there links back to the
 * parking lot (sourceRef parking-lot).
 *
 * Pure: no store, no React. The agent's server handlers import it.
 */

import {
  PARKING_LOT_STATUSES,
  TOOL_TEXT_MAX,
  type HandoffLink,
  type ParkingLotItem,
  type ParkingLotStatus,
} from "@/lib/stores/workspace-types";
import type { HandoffSource } from "@/lib/handoffs/types";
import type { Validation } from "@/lib/utils/form";
import { isExampleId } from "@/lib/utils/example-id";

/** The routes a parked point can take, in menu order. */
export const PARKING_ROUTES = ["backlog-story", "impediment", "retro-action"] as const;
export type ParkingRoute = (typeof PARKING_ROUTES)[number];

/** Where a point can go, as the review and Amr name it: a route, or nowhere. */
export const PARKING_DESTINATIONS = ["backlog", "impediment", "action", "drop"] as const;
export type ParkingDestination = (typeof PARKING_DESTINATIONS)[number];

/** The route behind each destination that sends the point on. */
export const DESTINATION_ROUTE: Readonly<
  Record<Exclude<ParkingDestination, "drop">, ParkingRoute>
> = {
  backlog: "backlog-story",
  impediment: "impediment",
  action: "retro-action",
};

/** A destination as a button names it. */
export const DESTINATION_LABEL: Readonly<Record<ParkingDestination, string>> = {
  backlog: "Backlog story",
  impediment: "Impediment",
  action: "Retro action",
  drop: "Drop",
};

/** Where a sent point went, in a sentence: "sent to the backlog". */
export const ROUTE_PLACE: Readonly<Record<ParkingRoute, string>> = {
  "backlog-story": "the backlog",
  impediment: "the Impediment Tracker",
  "retro-action": "Retro Actions",
};

export const STATUS_LABEL: Readonly<Record<ParkingLotStatus, string>> = {
  open: "Open",
  discussed: "Discussed",
  sent: "Sent",
  dropped: "Dropped",
};

export const isParkingRoute = (v: unknown): v is ParkingRoute =>
  typeof v === "string" && (PARKING_ROUTES as readonly string[]).includes(v);

export const isParkingStatus = (v: unknown): v is ParkingLotStatus =>
  typeof v === "string" && (PARKING_LOT_STATUSES as readonly string[]).includes(v);

/** One line, trimmed: pasted line breaks become spaces. */
export const oneLine = (s: string): string => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

/* ── Reading ─────────────────────────────────────────────────────────── */

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

function linksOf(raw: unknown): HandoffLink[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (l): l is HandoffLink =>
      Boolean(l) &&
      typeof l === "object" &&
      typeof (l as HandoffLink).route === "string" &&
      typeof (l as HandoffLink).targetId === "string" &&
      typeof (l as HandoffLink).at === "string"
  );
}

/**
 * A stored row as the page reads it, or null for one it can't show (no id
 * or no text). An unknown status reads as open; blank optional fields are
 * left out. A synced row an older build or an agent wrote is never trusted
 * further than that.
 */
export function normalizeParkingItem(raw: unknown): ParkingLotItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const text = typeof r.text === "string" ? oneLine(r.text) : "";
  if (!id || !text) return null;
  const meeting = str(r.meeting);
  const raisedBy = str(r.raisedBy);
  const sentTo = linksOf(r.sentTo);
  return {
    id,
    text,
    status: isParkingStatus(r.status) ? r.status : "open",
    ...(meeting ? { meeting } : {}),
    ...(raisedBy ? { raisedBy } : {}),
    ...(sentTo.length > 0 ? { sentTo } : {}),
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
  };
}

/** Oldest first, as the points were raised (ties by id, so the order is stable). */
export function byRaised(a: ParkingLotItem, b: ParkingLotItem): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/** Every readable row, in the order raised. */
export function parkingItems(raw: readonly unknown[] | undefined): ParkingLotItem[] {
  return (raw ?? [])
    .map(normalizeParkingItem)
    .filter((x): x is ParkingLotItem => x !== null)
    .sort(byRaised);
}

/** The team's own points: the example's only while there are no others. */
export function countedItems(items: readonly ParkingLotItem[]): ParkingLotItem[] {
  const own = items.filter((i) => !isExampleId(i.id));
  return own.length > 0 ? own : [...items];
}

/* ── Meetings ────────────────────────────────────────────────────────── */

/** A meeting's name as a key: "Daily Scrum" and "daily scrum " are one meeting. */
export const meetingKey = (m: string | undefined): string =>
  (m ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export interface MeetingGroup {
  /** meetingKey of the name; "" for points with no meeting. */
  key: string;
  /** The name as most recently typed; "" for no meeting. */
  name: string;
  total: number;
  open: number;
}

/** The meetings points were parked in, the most recently used first; "no meeting" last. */
export function meetingsOf(items: readonly ParkingLotItem[]): MeetingGroup[] {
  const groups = new Map<string, MeetingGroup & { last: string }>();
  for (const item of items) {
    const key = meetingKey(item.meeting);
    const g = groups.get(key) ?? { key, name: "", total: 0, open: 0, last: "" };
    g.total += 1;
    if (item.status === "open") g.open += 1;
    if (item.createdAt >= g.last) {
      g.last = item.createdAt;
      g.name = key ? (item.meeting ?? "").trim().replace(/\s+/g, " ") : "";
    }
    groups.set(key, g);
  }
  const noMeetingLast = (a: { key: string }, b: { key: string }) =>
    Number(a.key === "") - Number(b.key === "");
  return Array.from(groups.values())
    .sort((a, b) => noMeetingLast(a, b) || b.last.localeCompare(a.last))
    .map(({ key, name, total, open }) => ({ key, name, total, open }));
}

/**
 * The meeting the next point is parked in, remembered from the last point
 * the team parked (never the example's): "" when that had none, or there is
 * none yet.
 */
export function rememberedMeeting(items: readonly ParkingLotItem[]): string {
  let newest: ParkingLotItem | undefined;
  for (const item of items) {
    if (isExampleId(item.id)) continue;
    if (!newest || byRaised(newest, item) < 0) newest = item;
  }
  return newest?.meeting?.trim() ?? "";
}

/** null: every meeting; "": points with no meeting; else a meetingKey. */
export type MeetingFilter = string | null;

export const matchesMeeting = (item: ParkingLotItem, filter: MeetingFilter): boolean =>
  filter === null || meetingKey(item.meeting) === filter;

/* ── Counts ──────────────────────────────────────────────────────────── */

export interface ParkingSummary {
  total: number;
  open: number;
  discussed: number;
  sent: number;
  dropped: number;
}

export function parkingSummary(items: readonly ParkingLotItem[]): ParkingSummary {
  const out: ParkingSummary = { total: items.length, open: 0, discussed: 0, sent: 0, dropped: 0 };
  for (const item of items) out[item.status] += 1;
  return out;
}

/** Whole days since it was parked, or null for a row with no usable time. */
export function ageDays(item: Pick<ParkingLotItem, "createdAt">, now: Date): number | null {
  const at = Date.parse(item.createdAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((now.getTime() - at) / 86_400_000));
}

/** When it was parked, for its row: "today", "yesterday" or "3 Nov". */
export function parkedWhen(item: Pick<ParkingLotItem, "createdAt">, now: Date): string {
  const at = new Date(item.createdAt);
  if (!Number.isFinite(at.getTime())) return "";
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  return at.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(at.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** A one-line summary of the counts: "4 open · 1 discussed · 2 sent · 1 dropped". */
export function summaryText(s: ParkingSummary): string {
  const parts = [`${s.open} open`];
  if (s.discussed) parts.push(`${s.discussed} discussed`);
  if (s.sent) parts.push(`${s.sent} sent`);
  if (s.dropped) parts.push(`${s.dropped} dropped`);
  return parts.join(" · ");
}

/* ── Sending ─────────────────────────────────────────────────────────── */

/** What a point hands over on any route: its words, where it came up and who raised it. */
export function parkingSource(
  item: Pick<ParkingLotItem, "id" | "text" | "meeting" | "raisedBy">
): HandoffSource {
  const text = oneLine(item.text);
  const meeting = item.meeting?.trim();
  const raisedBy = item.raisedBy?.trim();
  const context = `${meeting ? `Parked in ${oneLine(meeting)}` : "Parked in a meeting"}${
    raisedBy ? `, raised by ${oneLine(raisedBy)}` : ""
  }.`;
  // A backlog story's title holds 200 characters: a longer point keeps its
  // whole text in the notes.
  const description = text.length > 200 ? `${text}\n\n${context}` : context;
  return {
    title: text,
    description,
    ...(raisedBy ? { raisedBy } : {}),
    sourceRef: { tool: "parking-lot", id: item.id },
  };
}

/**
 * The item with `links` recorded: "sent" while it has any; when the last
 * goes (an Undo), back to what it was before the send (`before`), or open.
 * Stamps updatedAt.
 */
export function withParkingLinks(
  item: ParkingLotItem,
  links: readonly HandoffLink[],
  before: ParkingLotStatus,
  now: string = new Date().toISOString()
): ParkingLotItem {
  if (links.length > 0) return { ...item, sentTo: [...links], status: "sent", updatedAt: now };
  const status: ParkingLotStatus =
    item.status === "sent" ? (before === "sent" ? "open" : before) : item.status;
  const next: ParkingLotItem = { ...item, status, updatedAt: now };
  delete next.sentTo;
  return next;
}

/** One suggestion of where a point goes, from Amr's AI or the keyword rules. */
export interface RouteSuggestion {
  id: string;
  destination: ParkingDestination;
  reason: string;
}

/**
 * The suggestions that still apply to `open` points, one per point, in the
 * points' order: an id the answer made up, a second suggestion for the same
 * point, or a point decided since is left out.
 */
export function matchSuggestions<S extends RouteSuggestion>(
  suggestions: readonly S[],
  open: readonly ParkingLotItem[]
): S[] {
  const byId = new Map<string, S>();
  for (const s of suggestions) {
    if (!byId.has(s.id) && (PARKING_DESTINATIONS as readonly string[]).includes(s.destination)) {
      byId.set(s.id, s);
    }
  }
  return open
    .filter((i) => i.status === "open")
    .map((i) => byId.get(i.id))
    .filter((s): s is S => s !== undefined);
}

/* ── The capture and edit form ───────────────────────────────────────── */

export interface ParkingDraft {
  text: string;
  meeting: string;
  raisedBy: string;
}

export type ParkingField = keyof ParkingDraft;

export interface ParkingValues {
  text: string;
  meeting?: string;
  raisedBy?: string;
}

/**
 * Check a point before it is parked or saved: the point is required, the
 * meeting and who raised it are optional, and each stays within the caps the
 * agents' schema holds (TOOL_TEXT_MAX), so a point the page saved is always
 * one an agent can update.
 */
export function validateParkingDraft(d: ParkingDraft): Validation<ParkingValues, ParkingField> {
  const errors: Partial<Record<ParkingField, string>> = {};
  const text = oneLine(d.text);
  const meeting = oneLine(d.meeting);
  const raisedBy = oneLine(d.raisedBy);
  if (!text) errors.text = "Say what the point is.";
  else if (text.length > TOOL_TEXT_MAX.text) {
    errors.text = `Keep it to ${TOOL_TEXT_MAX.text} characters.`;
  }
  if (meeting.length > TOOL_TEXT_MAX.short) {
    errors.meeting = `Keep the meeting's name to ${TOOL_TEXT_MAX.short} characters.`;
  }
  if (raisedBy.length > TOOL_TEXT_MAX.short) {
    errors.raisedBy = `Keep the name to ${TOOL_TEXT_MAX.short} characters.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: { text, ...(meeting ? { meeting } : {}), ...(raisedBy ? { raisedBy } : {}) },
  };
}

/** A new open point from checked values, stamped `now`. */
export function newParkingItem(values: ParkingValues, id: string, now: string): ParkingLotItem {
  return {
    id,
    text: values.text,
    ...(values.meeting ? { meeting: values.meeting } : {}),
    ...(values.raisedBy ? { raisedBy: values.raisedBy } : {}),
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
}

/** The item with checked values from its edit form: cleared fields go, updatedAt is `now`. */
export function editedParkingItem(
  item: ParkingLotItem,
  values: ParkingValues,
  now: string
): ParkingLotItem {
  const next: ParkingLotItem = { ...item, text: values.text, updatedAt: now };
  delete next.meeting;
  delete next.raisedBy;
  if (values.meeting) next.meeting = values.meeting;
  if (values.raisedBy) next.raisedBy = values.raisedBy;
  return next;
}

/** Which fields an edit changed, for the history log. */
export function changedFields(item: ParkingLotItem, values: ParkingValues): ParkingField[] {
  const out: ParkingField[] = [];
  if (item.text !== values.text) out.push("text");
  if ((item.meeting ?? "") !== (values.meeting ?? "")) out.push("meeting");
  if ((item.raisedBy ?? "") !== (values.raisedBy ?? "")) out.push("raisedBy");
  return out;
}

/* ── Next step ───────────────────────────────────────────────────────── */

/** A point open this many days has been parked, not reviewed. */
export const STALE_PARKED_DAYS = 7;

export interface ParkingStep {
  id: string;
  label: string;
  detail?: string;
  href: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const quoted = (text: string) => {
  const t = oneLine(text);
  return `“${t.length > 60 ? `${t.slice(0, 59).trimEnd()}…` : t}”`;
};

/**
 * Where the parking lot should go next (lib/tools/next-steps reads it): the
 * points parked over a week ago and still open, else the open points
 * waiting for the end-of-meeting review. Example points are left out.
 */
export function parkingLotSteps(
  raw: readonly unknown[] | undefined,
  now: Date = new Date()
): ParkingStep[] {
  const open = parkingItems(raw).filter((i) => i.status === "open" && !isExampleId(i.id));
  if (open.length === 0) return [];
  const stale = open.filter((i) => (ageDays(i, now) ?? 0) >= STALE_PARKED_DAYS);
  const [first] = stale;
  if (first) {
    return [
      {
        id: "parking-lot-stale",
        label:
          stale.length === 1
            ? "Decide on the point parked over a week ago"
            : `Decide on the ${stale.length} points parked over a week ago`,
        detail: `${quoted(first.text)}${
          stale.length > 1 ? `, and ${plural(stale.length - 1, "other")}` : ""
        } ${stale.length === 1 ? "is" : "are"} still open. Send each one on, or drop it: a parked point nobody reviews is a point forgotten.`,
        href: "/parking-lot",
      },
    ];
  }
  return [
    {
      id: "parking-lot-review",
      label:
        open.length === 1
          ? "Review the open parked point"
          : `Review the ${open.length} open parked points`,
      detail: `${quoted(open[0].text)}${
        open.length > 1 ? `, and ${plural(open.length - 1, "other")}` : ""
      } ${open.length === 1 ? "waits" : "wait"} for the end-of-meeting review: mark each discussed, send it on, or drop it.`,
      href: "/parking-lot",
    },
  ];
}
