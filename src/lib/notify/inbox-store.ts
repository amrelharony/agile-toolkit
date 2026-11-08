"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
import { mergePersisted } from "@/lib/stores/persist-migrate";
import {
  ACTIVITY_STORAGE_KEY,
  INBOX_VERSION,
  addInboxItem,
  migrateInbox,
  pruneInbox,
  unreadCount,
  type InboxInput,
  type InboxItem,
} from "./inbox";

/**
 * The Activity inbox: where every celebration lands (levels, badges,
 * challenges, kudos, "Today's XP is full"). Nothing here interrupts; the
 * avatar dot and the Activity panel show it, and rare items may also get a
 * moment with Amr (PR I).
 *
 * Local to this browser and left out of backups (lib/data/backup.ts), so a
 * restore never brings back stale unread rows. The model lives in inbox.ts.
 */

interface InboxActions {
  /** Add (or merge) a row; returns it as stored. */
  add: (input: InboxInput, now?: number) => InboxItem;
  markRead: (ids: readonly string[]) => void;
  markAllRead: () => void;
  markMomentShown: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  setSeeded: () => void;
  /** Drop rows older than 30 days (the panel calls it when it opens). */
  prune: (now?: number) => void;
}

export interface InboxState extends InboxActions {
  items: InboxItem[];
  seeded: boolean;
}

export const useInboxStore = create<InboxState>()(
  persist(
    (set, get) => ({
      items: [],
      seeded: false,
      add: (input, now = Date.now()) => {
        const { items, item } = addInboxItem(get().items, input, now);
        set({ items });
        return item;
      },
      markRead: (ids) => {
        if (ids.length === 0) return;
        const wanted = new Set(ids);
        set((s) => {
          if (!s.items.some((i) => wanted.has(i.id) && !i.read)) return s;
          return { items: s.items.map((i) => (wanted.has(i.id) ? { ...i, read: true } : i)) };
        });
      },
      markAllRead: () =>
        set((s) => {
          if (!s.items.some((i) => !i.read)) return s;
          return { items: s.items.map((i) => (i.read ? i : { ...i, read: true })) };
        }),
      markMomentShown: (id) =>
        set((s) => ({
          items: s.items.map((i) => (i.id === id ? { ...i, momentShown: true } : i)),
        })),
      remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
      clear: () => set({ items: [] }),
      setSeeded: () => set((s) => (s.seeded ? s : { seeded: true })),
      prune: (now = Date.now()) =>
        set((s) => {
          const items = pruneInbox(s.items, now);
          return items.length === s.items.length ? s : { items };
        }),
    }),
    {
      name: ACTIVITY_STORAGE_KEY,
      storage: safeJSONStorage("activity"),
      skipHydration: true,
      version: INBOX_VERSION,
      partialize: (s) => ({ items: s.items, seeded: s.seeded }),
      // Any other stored version, older or newer: idempotent clean-up that
      // keeps unknown fields, so a rollback loses nothing.
      migrate: (persisted) => migrateInbox(persisted) as unknown as InboxState,
      // Same-version payloads skip `migrate`: clean them up here too.
      merge: (persisted, current) =>
        mergePersisted(
          persisted && typeof persisted === "object" && !Array.isArray(persisted)
            ? migrateInbox(persisted)
            : persisted,
          current
        ),
    }
  )
);

export function selectUnreadCount(s: Pick<InboxState, "items">): number {
  return unreadCount(s.items);
}

/** Unread rows, for the avatar dot and the menu badge. */
export function useUnreadCount(): number {
  return useInboxStore(selectUnreadCount);
}

/**
 * Run `fn` once the inbox has been read from storage. Adding before that
 * would save an empty inbox over the stored one (persist writes on set).
 */
export function withInbox(fn: () => void): void {
  if (typeof window === "undefined") return;
  if (useInboxStore.persist.hasHydrated()) {
    fn();
    return;
  }
  void Promise.resolve(useInboxStore.persist.rehydrate())
    .then(() => {
      if (useInboxStore.persist.hasHydrated()) fn();
    })
    .catch(() => {});
}
