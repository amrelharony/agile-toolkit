"use client";

import { useInboxStore } from "@/lib/notify/inbox-store";
import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";
import type { InboxItem } from "@/lib/notify/inbox";
import { cn } from "@/lib/utils";

/** Rows the user can see: "Gamification off" hides the gamification ones. */
export function visibleInboxItems(
  items: readonly InboxItem[],
  gamificationEnabled: boolean
): InboxItem[] {
  return gamificationEnabled ? [...items] : items.filter((i) => !i.gamification);
}

/** Unread rows the user can see. */
export function useVisibleUnreadCount(): number {
  const gamificationEnabled = useNotificationPrefsStore((s) => s.gamificationEnabled);
  return useInboxStore((s) => {
    let n = 0;
    for (const i of s.items) if (!i.read && (gamificationEnabled || !i.gamification)) n++;
    return n;
  });
}

/**
 * The 8 px "something new in Activity" dot on the avatar. Decorative: the
 * menu's Activity row carries the count for screen readers. Renders nothing
 * when everything is read.
 */
export function ActivityDot({ className }: { className?: string }) {
  const unread = useVisibleUnreadCount();
  if (unread === 0) return null;
  return (
    <span
      data-testid="activity-dot"
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute top-0 right-0 w-2 h-2 rounded-full bg-accent ring-2 ring-[var(--bg)]",
        className
      )}
    />
  );
}
