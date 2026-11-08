/**
 * The Activity inbox model: item shape, merging, pruning and the persisted-
 * payload clean-up. Pure (no React, no zustand, no "use client"), so the
 * store (`inbox-store.ts`), the celebration code and tests share it.
 *
 * - Cap 100 items: read items go first (oldest first), then the oldest
 *   unread ones.
 * - Items older than 30 days are pruned.
 * - Items with the same `mergeKey` merge into one row: challenge completions
 *   on the same day group under one row, a kudos replaces its own row.
 */

/** What an inbox row is about. A newer build may store kinds this one doesn't know. */
export type InboxKind =
  | "level-up"
  | "achievement"
  | "challenge"
  | "prestige"
  | "kudos"
  | "xp-cap"
  | "carried-over"
  | "recap"
  | "note";

/** How rare an item is; moments (PR I) play only rare items and up. */
export type Rarity = "common" | "rare" | "epic" | "legendary";

export const RARITY_RANK: Record<Rarity, number> = {
  common: 0,
  rare: 1,
  epic: 2,
  legendary: 3,
};

export function rarityRank(r: string | undefined): number {
  return r && r in RARITY_RANK ? RARITY_RANK[r as Rarity] : 0;
}

export function maxRarity(a: Rarity, b: Rarity): Rarity {
  return rarityRank(b) > rarityRank(a) ? b : a;
}

/** A row folded into another one (a second challenge, the level an achievement reached…). */
export interface InboxChild {
  title: string;
  xp?: number;
  icon?: string;
  kind?: InboxKind | string;
}

export interface InboxItem {
  id: string;
  kind: InboxKind | string;
  title: string;
  body?: string;
  /** XP this row stands for (summed over its children). */
  xp?: number;
  /** lucide icon name. */
  icon: string;
  rarity: Rarity;
  /** ISO time of the latest thing in the row. */
  at: string;
  read: boolean;
  /** A moment with Amr has already played for it (PR I). */
  momentShown: boolean;
  href?: string;
  children?: InboxChild[];
  /** Rows with the same key merge (`challenge:<day>`, `kudos:<id>`). */
  mergeKey?: string;
  /**
   * A gamification row (XP, badges, challenges). Settings › Notifications'
   * "Gamification off" hides these.
   */
  gamification?: boolean;
}

/** What a caller adds; the store fills in id, read and momentShown. */
export interface InboxInput {
  kind: InboxKind | string;
  title: string;
  body?: string;
  xp?: number;
  icon: string;
  rarity?: Rarity;
  at?: string;
  href?: string;
  children?: InboxChild[];
  mergeKey?: string;
  gamification?: boolean;
  /**
   * How a row with the same `mergeKey` is merged:
   * - `group` (default): the existing row gains this one as a child, its XP
   *   is summed and its title becomes `groupTitle(count)`.
   * - `replace`: this row takes the old one's place (same id).
   */
  merge?: "group" | "replace";
  /** Title of a grouped row holding `count` items. */
  groupTitle?: (count: number) => string;
}

export const ACTIVITY_STORAGE_KEY = "agile-toolkit:activity";
export const INBOX_VERSION = 1;
export const INBOX_CAP = 100;
export const INBOX_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const RARITIES: readonly Rarity[] = ["common", "rare", "epic", "legendary"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function timeOf(item: Pick<InboxItem, "at">): number {
  const t = Date.parse(item.at);
  return Number.isFinite(t) ? t : 0;
}

let seq = 0;
export function newInboxId(now: number): string {
  seq = (seq + 1) % 1_000_000;
  return `a${now.toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Drop items older than 30 days, then keep at most `INBOX_CAP`: read items
 * are evicted first (oldest first), then the oldest unread ones. The order
 * of what's kept is unchanged.
 */
export function pruneInbox(items: readonly InboxItem[], now: number): InboxItem[] {
  const fresh = items.filter((i) => now - timeOf(i) <= INBOX_MAX_AGE_MS);
  let excess = fresh.length - INBOX_CAP;
  if (excess <= 0) return fresh;
  const byAge = fresh
    .map((item, index) => ({ item, index }))
    .sort((a, b) => timeOf(a.item) - timeOf(b.item));
  const evict = new Set<number>();
  for (const pass of [true, false]) {
    for (const { item, index } of byAge) {
      if (excess <= 0) break;
      if (item.read !== pass || evict.has(index)) continue;
      evict.add(index);
      excess--;
    }
  }
  return fresh.filter((_item, index) => !evict.has(index));
}

function asChild(item: Pick<InboxItem, "title" | "xp" | "icon" | "kind">): InboxChild {
  return {
    title: item.title,
    ...(item.xp !== undefined ? { xp: item.xp } : {}),
    icon: item.icon,
    kind: item.kind,
  };
}

/**
 * Add `input` to the inbox, newest first. A row with the same `mergeKey`
 * absorbs it (moved to the top and marked unread again). Returns the new
 * list and the row as stored.
 */
export function addInboxItem(
  items: readonly InboxItem[],
  input: InboxInput,
  now: number
): { items: InboxItem[]; item: InboxItem } {
  const at = input.at ?? new Date(now).toISOString();
  const rarity = input.rarity ?? "common";
  const existing =
    input.mergeKey !== undefined ? items.find((i) => i.mergeKey === input.mergeKey) : undefined;

  let item: InboxItem;
  if (existing && input.merge === "replace") {
    item = {
      ...base(input, at, rarity),
      id: existing.id,
      momentShown: existing.momentShown && rarityRank(rarity) <= rarityRank(existing.rarity),
    };
  } else if (existing) {
    const children = [
      ...(existing.children && existing.children.length > 0
        ? existing.children
        : [asChild(existing)]),
      ...(input.children && input.children.length > 0
        ? input.children
        : [asChild({ ...input, xp: input.xp })]),
    ];
    const xp = (existing.xp ?? 0) + (input.xp ?? 0);
    const merged = maxRarity(existing.rarity, rarity);
    item = {
      ...existing,
      title: input.groupTitle ? input.groupTitle(children.length) : existing.title,
      ...(xp > 0 ? { xp } : {}),
      rarity: merged,
      at,
      read: false,
      // A rarer newcomer earns its moment; otherwise one moment per row.
      momentShown: existing.momentShown && rarityRank(rarity) <= rarityRank(existing.rarity),
      children,
    };
  } else {
    item = base(input, at, rarity);
    item.id = newInboxId(now);
  }

  const rest = items.filter((i) => i !== existing);
  return { items: pruneInbox([item, ...rest], now), item };
}

function base(input: InboxInput, at: string, rarity: Rarity): InboxItem {
  return {
    id: "",
    kind: input.kind,
    title: input.title,
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.xp !== undefined ? { xp: input.xp } : {}),
    icon: input.icon,
    rarity,
    at,
    read: false,
    momentShown: false,
    ...(input.href !== undefined ? { href: input.href } : {}),
    ...(input.children && input.children.length > 0 ? { children: input.children } : {}),
    ...(input.mergeKey !== undefined ? { mergeKey: input.mergeKey } : {}),
    ...(input.gamification !== undefined ? { gamification: input.gamification } : {}),
  };
}

export function unreadCount(items: readonly InboxItem[]): number {
  let n = 0;
  for (const i of items) if (!i.read) n++;
  return n;
}

/** Fix one stored item, or null when it can't be read at all. Unknown fields are kept. */
function cleanItem(raw: unknown): InboxItem | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (typeof raw.title !== "string") return null;
  const at = typeof raw.at === "string" && Number.isFinite(Date.parse(raw.at)) ? raw.at : null;
  if (!at) return null;
  return {
    ...raw,
    id: raw.id,
    kind: typeof raw.kind === "string" && raw.kind ? raw.kind : "note",
    title: raw.title,
    icon: typeof raw.icon === "string" && raw.icon ? raw.icon : "Sparkles",
    rarity: RARITIES.includes(raw.rarity as Rarity) ? (raw.rarity as Rarity) : "common",
    at,
    read: raw.read === true,
    momentShown: raw.momentShown === true,
    ...(Array.isArray(raw.children)
      ? {
          children: raw.children.filter(
            (c): c is InboxChild => isPlainObject(c) && typeof c.title === "string"
          ),
        }
      : {}),
  } as InboxItem;
}

export interface InboxPersisted {
  items: InboxItem[];
  /** The one-off "Your progress carried over" row has been considered. */
  seeded: boolean;
}

/**
 * Bring any stored payload to the current shape. Idempotent; keeps unknown
 * top-level fields and unknown item fields; drops items it can't read and
 * prunes old ones. A non-object yields an empty inbox.
 */
export function migrateInbox(persisted: unknown, now: number = Date.now()): InboxPersisted {
  if (!isPlainObject(persisted)) return { items: [], seeded: false };
  const rawItems = Array.isArray(persisted.items) ? persisted.items : [];
  const items: InboxItem[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    const item = cleanItem(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return {
    ...persisted,
    items: pruneInbox(items, now),
    seeded: persisted.seeded === true,
  };
}

/** "Today", "This week" (last 7 days) or "Earlier", by local calendar day. */
export type InboxGroup = "today" | "week" | "earlier";

export function inboxGroupOf(at: string, now: Date): InboxGroup {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return "earlier";
  const day = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / 86_400_000;
  const diff = Math.round(day(now) - day(d));
  if (diff <= 0) return "today";
  if (diff < 7) return "week";
  return "earlier";
}

export function groupInbox(
  items: readonly InboxItem[],
  now: Date
): { group: InboxGroup; items: InboxItem[] }[] {
  const order: InboxGroup[] = ["today", "week", "earlier"];
  const buckets: Record<InboxGroup, InboxItem[]> = { today: [], week: [], earlier: [] };
  for (const item of items) buckets[inboxGroupOf(item.at, now)].push(item);
  return order.filter((g) => buckets[g].length > 0).map((g) => ({ group: g, items: buckets[g] }));
}
