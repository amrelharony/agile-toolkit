import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Activity inbox: the pure model (merging, pruning, the payload
 * clean-up, grouping) and the persisted store (round trip, rollback-safe
 * payloads, read state), plus `kind: "celebration"` toasts landing in it.
 */

const h = vi.hoisted(() => {
  const sonner = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    promise: vi.fn(),
    dismiss: vi.fn(),
  });
  return { sonner, emitFeedback: vi.fn() };
});
vi.mock("sonner", () => ({ toast: h.sonner }));
vi.mock("@/lib/sonification/emit", () => ({ emitFeedback: h.emitFeedback }));

import {
  ACTIVITY_STORAGE_KEY,
  INBOX_CAP,
  INBOX_MAX_AGE_MS,
  INBOX_VERSION,
  addInboxItem,
  groupInbox,
  migrateInbox,
  pruneInbox,
  unreadCount,
  type InboxItem,
} from "@/lib/notify/inbox";
import { useInboxStore, withInbox } from "@/lib/notify/inbox-store";
import { __resetNotifyForTests, __setPolicyContextForTests, notify } from "@/lib/notify/notify";

const NOW = new Date(2026, 10, 8, 14, 0).getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function item(over: Partial<InboxItem> = {}): InboxItem {
  return {
    id: over.id ?? `i${Math.random().toString(36).slice(2)}`,
    kind: "achievement",
    title: "Badge",
    icon: "Award",
    rarity: "common",
    at: new Date(NOW).toISOString(),
    read: false,
    momentShown: false,
    ...over,
  };
}

describe("inbox model", () => {
  it("adds newest first with defaults filled in", () => {
    const first = addInboxItem([], { kind: "note", title: "One", icon: "Sparkles" }, NOW);
    const second = addInboxItem(first.items, { kind: "note", title: "Two", icon: "Sparkles" }, NOW);
    expect(second.items.map((i) => i.title)).toEqual(["Two", "One"]);
    expect(first.item).toMatchObject({ read: false, momentShown: false, rarity: "common" });
    expect(first.item.id).toBeTruthy();
    expect(first.item.id).not.toBe(second.item.id);
  });

  it("groups challenge completions on the same day into one row", () => {
    const groupTitle = (n: number) => `${n} challenges done today`;
    let items = addInboxItem(
      [],
      { kind: "challenge", title: "A", xp: 30, icon: "Flag", mergeKey: "challenge:2026-11-08" },
      NOW
    ).items;
    items = addInboxItem(
      items.map((i) => ({ ...i, read: true })),
      { kind: "note", title: "Other", icon: "Sparkles" },
      NOW + 1000
    ).items;
    const merged = addInboxItem(
      items,
      {
        kind: "challenge",
        title: "B",
        xp: 50,
        icon: "Flag",
        rarity: "rare",
        mergeKey: "challenge:2026-11-08",
        groupTitle,
      },
      NOW + 2000
    );
    expect(merged.items).toHaveLength(2);
    expect(merged.items[0]).toBe(merged.item);
    expect(merged.item).toMatchObject({
      title: "2 challenges done today",
      xp: 80,
      rarity: "rare",
      read: false,
    });
    expect(merged.item.children?.map((c) => c.title)).toEqual(["A", "B"]);
    // Another day starts a new row.
    const nextDay = addInboxItem(
      merged.items,
      { kind: "challenge", title: "C", icon: "Flag", mergeKey: "challenge:2026-11-09" },
      NOW + DAY
    );
    expect(nextDay.items).toHaveLength(3);
  });

  it("a replace merge keeps the row id (kudos by id)", () => {
    const a = addInboxItem(
      [],
      { kind: "kudos", title: "Kudos", icon: "Heart", mergeKey: "kudos:k1", merge: "replace" },
      NOW
    );
    const b = addInboxItem(
      a.items.map((i) => ({ ...i, read: true })),
      {
        kind: "kudos",
        title: "Kudos again",
        icon: "Heart",
        mergeKey: "kudos:k1",
        merge: "replace",
      },
      NOW + 1000
    );
    expect(b.items).toHaveLength(1);
    expect(b.item.id).toBe(a.item.id);
    expect(b.item).toMatchObject({ title: "Kudos again", read: false });
  });

  it("a rarer item merged in earns a fresh moment; an equal one doesn't", () => {
    const shown = [item({ mergeKey: "m", rarity: "rare", momentShown: true })];
    const equal = addInboxItem(
      shown,
      { kind: "x", title: "y", icon: "Award", rarity: "rare", mergeKey: "m" },
      NOW
    );
    expect(equal.item.momentShown).toBe(true);
    const rarer = addInboxItem(
      shown,
      { kind: "x", title: "y", icon: "Award", rarity: "epic", mergeKey: "m" },
      NOW
    );
    expect(rarer.item).toMatchObject({ momentShown: false, rarity: "epic" });
  });

  it("prunes items older than 30 days", () => {
    const old = item({ at: new Date(NOW - INBOX_MAX_AGE_MS - 1).toISOString() });
    const edge = item({ at: new Date(NOW - INBOX_MAX_AGE_MS).toISOString() });
    expect(pruneInbox([old, edge], NOW)).toEqual([edge]);
  });

  it("caps at 100, evicting read items first, then the oldest unread", () => {
    const list: InboxItem[] = [];
    for (let k = 0; k < INBOX_CAP; k++) {
      list.push(item({ id: `u${k}`, at: new Date(NOW - k * 1000).toISOString() }));
    }
    const readOld = item({ id: "r-new", read: true, at: new Date(NOW).toISOString() });
    const kept = pruneInbox([readOld, ...list], NOW);
    expect(kept).toHaveLength(INBOX_CAP);
    expect(kept.some((i) => i.id === "r-new")).toBe(false);

    const extra = item({ id: "u-new", at: new Date(NOW + 1).toISOString() });
    const kept2 = pruneInbox([extra, ...list], NOW);
    expect(kept2).toHaveLength(INBOX_CAP);
    expect(kept2.some((i) => i.id === `u${INBOX_CAP - 1}`)).toBe(false);
    expect(kept2[0].id).toBe("u-new");
  });

  it("counts unread", () => {
    expect(unreadCount([item(), item({ read: true }), item()])).toBe(2);
  });

  it("groups Today / This week / Earlier by local day", () => {
    const now = new Date(NOW);
    const groups = groupInbox(
      [
        item({ id: "t", at: new Date(NOW - HOUR).toISOString() }),
        item({ id: "w", at: new Date(NOW - 2 * DAY).toISOString() }),
        item({ id: "e", at: new Date(NOW - 10 * DAY).toISOString() }),
      ],
      now
    );
    expect(groups.map((g) => [g.group, g.items.map((i) => i.id)])).toEqual([
      ["today", ["t"]],
      ["week", ["w"]],
      ["earlier", ["e"]],
    ]);
  });

  it("cleans up stored payloads: keeps unknown fields, drops unreadable items, idempotent", () => {
    const raw = {
      items: [
        { ...item({ id: "a" }), futureField: 1, rarity: "mythic" },
        { id: "", title: "no id", at: new Date(NOW).toISOString() },
        { id: "b", title: "bad date", at: "nope" },
        "garbage",
        { ...item({ id: "a" }), title: "duplicate id" },
      ],
      seeded: true,
      newerTopLevel: { x: 1 },
    };
    const once = migrateInbox(raw, NOW);
    expect(once.items).toHaveLength(1);
    expect(once.items[0]).toMatchObject({ id: "a", rarity: "common", futureField: 1 });
    expect(once).toMatchObject({ seeded: true, newerTopLevel: { x: 1 } });
    expect(migrateInbox(once, NOW)).toEqual(once);
    expect(migrateInbox("garbage", NOW)).toEqual({ items: [], seeded: false });
    expect(migrateInbox(null, NOW)).toEqual({ items: [], seeded: false });
  });
});

describe("inbox store", () => {
  beforeEach(() => {
    localStorage.clear();
    useInboxStore.setState({ items: [], seeded: false });
  });

  function stored() {
    return JSON.parse(localStorage.getItem(ACTIVITY_STORAGE_KEY) ?? "null");
  }

  it("persists under agile-toolkit:activity at version 1 and round-trips", async () => {
    await useInboxStore.persist.rehydrate();
    useInboxStore.getState().add({ kind: "note", title: "Hello", icon: "Sparkles" });
    expect(stored()).toMatchObject({ version: INBOX_VERSION, state: { seeded: false } });
    expect(stored().state.items[0].title).toBe("Hello");
    const saved = localStorage.getItem(ACTIVITY_STORAGE_KEY)!;
    // A new page: memory is empty (this set also writes), storage holds the save.
    useInboxStore.setState({ items: [], seeded: false });
    localStorage.setItem(ACTIVITY_STORAGE_KEY, saved);
    await useInboxStore.persist.rehydrate();
    expect(useInboxStore.getState().items.map((i) => i.title)).toEqual(["Hello"]);
  });

  it("loads a newer build's payload without losing its fields", async () => {
    const future = {
      state: {
        items: [{ ...item({ id: "f1", at: new Date().toISOString() }), glow: "gold" }],
        seeded: true,
        digestAt: 123,
      },
      version: 7,
    };
    localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(future));
    await useInboxStore.persist.rehydrate();
    const s = useInboxStore.getState() as unknown as Record<string, unknown>;
    expect(s.seeded).toBe(true);
    expect(s.digestAt).toBe(123);
    expect((s.items as Record<string, unknown>[])[0].glow).toBe("gold");
  });

  it("falls back to an empty inbox on a corrupted payload", async () => {
    localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify({ state: "garbage", version: 1 }));
    await useInboxStore.persist.rehydrate();
    expect(useInboxStore.getState().items).toEqual([]);
  });

  it("marks rows read, one by one or all at once", () => {
    const a = useInboxStore.getState().add({ kind: "note", title: "A", icon: "Sparkles" });
    useInboxStore.getState().add({ kind: "note", title: "B", icon: "Sparkles" });
    useInboxStore.getState().markRead([a.id]);
    expect(unreadCount(useInboxStore.getState().items)).toBe(1);
    useInboxStore.getState().markAllRead();
    expect(unreadCount(useInboxStore.getState().items)).toBe(0);
    useInboxStore.getState().clear();
    expect(useInboxStore.getState().items).toEqual([]);
  });

  it("withInbox waits for the stored inbox before writing", async () => {
    localStorage.setItem(
      ACTIVITY_STORAGE_KEY,
      JSON.stringify({
        state: { items: [item({ id: "kept", at: new Date().toISOString() })], seeded: true },
        version: 1,
      })
    );
    // A fresh page: not hydrated yet.
    vi.spyOn(useInboxStore.persist, "hasHydrated").mockReturnValueOnce(false);
    await new Promise<void>((resolve) =>
      withInbox(() => {
        useInboxStore.getState().add({ kind: "note", title: "New", icon: "Sparkles" });
        resolve();
      })
    );
    expect(useInboxStore.getState().items.map((i) => i.id)).toContain("kept");
    expect(useInboxStore.getState().items).toHaveLength(2);
    vi.restoreAllMocks();
  });
});

describe("celebration toasts", () => {
  beforeEach(async () => {
    localStorage.clear();
    __resetNotifyForTests();
    useInboxStore.setState({ items: [], seeded: true });
    await useInboxStore.persist.rehydrate();
  });

  afterEach(() => {
    __setPolicyContextForTests(null);
  });

  it("never toast: they become a quiet Activity row", async () => {
    const id = notify("success", "Badge earned", { kind: "celebration", description: "+50 XP" });
    expect(id).toBeTruthy();
    expect(h.sonner.success).not.toHaveBeenCalled();
    expect(h.emitFeedback).not.toHaveBeenCalled();
    expect(useInboxStore.getState().items[0]).toMatchObject({
      kind: "note",
      title: "Badge earned",
      body: "+50 XP",
      read: false,
    });
  });
});
