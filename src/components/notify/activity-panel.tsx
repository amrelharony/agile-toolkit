"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Award,
  CheckCheck,
  Crown,
  Flag,
  Gauge,
  Heart,
  Sparkles,
  TrendingUp,
  Trophy,
  X,
  type LucideIcon,
} from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useMediaQuery } from "@/hooks/use-media-query";
import { PHONE_MEDIA_QUERY } from "@/lib/layout/breakpoints";
import { useActivityUiStore } from "@/lib/stores/activity-ui-store";
import { useInboxStore } from "@/lib/notify/inbox-store";
import { groupInbox, type InboxGroup, type InboxItem } from "@/lib/notify/inbox";
import { progressLine } from "@/lib/notify/copy";
import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { computeLevel } from "@/lib/gamification/xp-curve";
import { GLOBAL_DAILY_XP_CAP, localDateOf } from "@/lib/gamification/outcomes";
import { findDaily } from "@/lib/gamification/challenges";
import { cn } from "@/lib/utils";
import { visibleInboxItems } from "./activity-dot";

const GROUP_LABEL: Record<InboxGroup, string> = {
  today: "Today",
  week: "This week",
  earlier: "Earlier",
};

const KIND_ICON: Record<string, LucideIcon> = {
  "level-up": TrendingUp,
  achievement: Award,
  challenge: Flag,
  prestige: Crown,
  kudos: Heart,
  "xp-cap": Gauge,
  "carried-over": Sparkles,
  recap: Sparkles,
  note: Sparkles,
};

function iconFor(item: InboxItem): LucideIcon {
  return KIND_ICON[item.kind] ?? Sparkles;
}

function timeLabel(at: string, now: Date): string {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return "";
  if (localDateOf(d) === localDateOf(now)) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The Activity panel: the inbox of rewards (levels, badges, challenges,
 * kudos), your progress and today's challenges. Opened from the avatar menu
 * and, on larger screens, the XP bar.
 *
 * - Phones: a bottom sheet whose bottom edge and overlay stop at Amr's band
 *   (`--amr-band-bottom`), so he stays visible. 80 dvh max, 44 px rows.
 * - Larger screens: a 22 rem popover under the header's right cluster.
 *
 * Everything shown is marked read when the panel closes.
 */
export function ActivityPanel() {
  const open = useActivityUiStore((s) => s.activityOpen);
  const setOpen = useActivityUiStore((s) => s.setActivityOpen);
  const phone = useMediaQuery(PHONE_MEDIA_QUERY);
  const items = useInboxStore((s) => s.items);
  const gamificationEnabled = useNotificationPrefsStore((s) => s.gamificationEnabled);
  const visible = useMemo(
    () => visibleInboxItems(items, gamificationEnabled),
    [items, gamificationEnabled]
  );

  // What the panel showed, so closing marks exactly that read.
  const shownRef = useRef<string[]>([]);
  useEffect(() => {
    if (open) shownRef.current = visible.map((i) => i.id);
  }, [open, visible]);

  useEffect(() => {
    if (open) useInboxStore.getState().prune();
  }, [open]);

  const onOpenChange = (next: boolean) => {
    if (!next) {
      useInboxStore.getState().markRead(shownRef.current);
      shownRef.current = [];
    }
    setOpen(next);
  };

  const body = <ActivityBody items={visible} showProgress={gamificationEnabled} />;

  if (phone) {
    return (
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            data-testid="activity-overlay"
            className="fixed inset-x-0 top-0 z-modal bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
            style={{ bottom: "var(--amr-band-bottom, 0px)" }}
          />
          <DialogPrimitive.Content
            data-testid="activity-sheet"
            aria-describedby={undefined}
            className="fixed inset-x-0 z-modal flex max-h-[80dvh] flex-col rounded-t-xl border-t border-border bg-bg shadow-lg outline-none pl-safe pr-safe data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom motion-reduce:animate-none"
            style={{ bottom: "var(--amr-band-bottom, 0px)" }}
          >
            <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-border">
              <DialogPrimitive.Title className="text-base font-semibold text-text flex-1">
                Activity
              </DialogPrimitive.Title>
              <MarkAllRead />
              <DialogPrimitive.Close
                aria-label="Close Activity"
                className="min-touch-coarse inline-flex h-9 w-9 items-center justify-center rounded-md text-sub hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </DialogPrimitive.Close>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{body}</div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed right-4 top-[calc(var(--header-h,56px)+var(--amr-band-top,0px))] h-0 w-0"
        />
      </PopoverAnchor>
      <PopoverContent
        align="end"
        sideOffset={4}
        role="dialog"
        aria-label="Activity"
        data-testid="activity-popover"
        // Opened from the avatar menu, whose closing hands focus back to its
        // trigger: that must not count as leaving the panel. A click
        // outside or Escape still closes it.
        onFocusOutside={(e) => e.preventDefault()}
        className="w-[22rem] max-w-[min(22rem,calc(100vw-1rem))] p-0 max-h-[min(36rem,var(--radix-popover-content-available-height))] flex flex-col"
      >
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-border">
          <h2 className="text-sm font-semibold text-text flex-1">Activity</h2>
          <MarkAllRead />
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-3">{body}</div>
      </PopoverContent>
    </Popover>
  );
}

function MarkAllRead() {
  const hasUnread = useInboxStore((s) => s.items.some((i) => !i.read));
  const markAllRead = useInboxStore((s) => s.markAllRead);
  return (
    <button
      type="button"
      onClick={markAllRead}
      disabled={!hasUnread}
      className="min-touch-coarse inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-sub hover:text-text disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
      Mark all read
    </button>
  );
}

function ActivityBody({ items, showProgress }: { items: InboxItem[]; showProgress: boolean }) {
  const now = new Date();
  const groups = groupInbox(items, now);
  const openTrophies = useActivityUiStore((s) => s.openTrophies);
  return (
    <div className="flex flex-col gap-4 pt-3">
      {showProgress && <ProgressCard now={now} />}
      {showProgress && <TodayChallenges now={now} />}
      <section aria-label="Activity items" className="flex flex-col gap-3">
        {groups.length === 0 ? (
          <p className="text-sm text-sub">Nothing yet. Finished work shows up here.</p>
        ) : (
          groups.map((g) => (
            <div key={g.group}>
              <h3 className="text-xs uppercase tracking-wide text-sub mb-1">
                {GROUP_LABEL[g.group]}
              </h3>
              <ul className="flex flex-col">
                {g.items.map((item) => (
                  <ActivityRow key={item.id} item={item} now={now} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
      {showProgress && (
        <button
          type="button"
          onClick={openTrophies}
          className="min-touch-coarse flex h-11 items-center justify-center gap-2 rounded-md border border-border text-sm text-text hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Trophy className="h-4 w-4 text-accent" aria-hidden="true" />
          Trophies &amp; challenges
        </button>
      )}
    </div>
  );
}

function ActivityRow({ item, now }: { item: InboxItem; now: Date }) {
  const Icon = iconFor(item);
  const setOpen = useActivityUiStore((s) => s.setActivityOpen);
  const sub =
    item.children && item.children.length > 0
      ? item.children.map((c) => c.title).join(" · ")
      : item.body;
  const content = (
    <>
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={cn("truncate text-sm", item.read ? "text-text" : "font-medium text-text")}
          >
            {item.title}
          </span>
          {item.xp !== undefined && item.xp > 0 && (
            <span className="shrink-0 font-data text-xs text-accent">+{item.xp} XP</span>
          )}
        </span>
        {sub && <span className="block truncate text-xs text-sub">{sub}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-xs text-sub">{timeLabel(item.at, now)}</span>
        {!item.read && (
          <span className="h-2 w-2 rounded-full bg-accent" aria-label="Unread" role="img" />
        )}
      </span>
    </>
  );
  const rowClass =
    "flex min-h-11 items-start gap-3 rounded-md px-1 py-2 text-left hover:bg-surface";
  return (
    <li data-testid="activity-row" data-read={item.read ? "true" : "false"}>
      {item.href ? (
        <Link href={item.href} className={rowClass} onClick={() => setOpen(false)}>
          {content}
        </Link>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </li>
  );
}

function ProgressCard({ now }: { now: Date }) {
  const xp = useVDnaStore((s) => s.xp);
  const prestige = useVDnaStore((s) => s.prestige);
  const xpDay = useVDnaStore((s) => s.xpDay);
  const info = computeLevel(xp, prestige);
  const today = xpDay && xpDay.date === localDateOf(now) ? xpDay.total : 0;
  const toNext = Math.max(0, info.xpNeededForLevel - info.xpIntoLevel);
  const pct = Math.round(info.progress01 * 100);
  return (
    <section
      aria-label="Your progress"
      className="rounded-md border border-border bg-surface px-3 py-2"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-text">Level {info.level}</span>
        <span className="text-xs text-sub">{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg" aria-hidden="true">
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-sub">
        {progressLine(toNext, info.level + 1, today, GLOBAL_DAILY_XP_CAP, info.atMax)}
      </p>
    </section>
  );
}

function TodayChallenges({ now }: { now: Date }) {
  const daily = useVDnaStore((s) => s.dailyChallenges);
  const today = localDateOf(now);
  const list = daily.filter((c) => c.seedDate === today && findDaily(c.id)).slice(0, 3);
  if (list.length === 0) return null;
  return (
    <section aria-label="Today's challenges">
      <h3 className="text-xs uppercase tracking-wide text-sub mb-1">Today&apos;s challenges</h3>
      <ul className="flex flex-col gap-1">
        {list.map((c) => {
          const def = findDaily(c.id);
          return (
            <li key={c.id} className="flex min-h-9 items-center gap-2 text-sm">
              <Flag
                className={cn("h-3.5 w-3.5 shrink-0", c.completed ? "text-accent" : "text-sub")}
                aria-hidden="true"
              />
              <span className={cn("flex-1 truncate", c.completed ? "text-sub" : "text-text")}>
                {def?.title ?? c.id}
              </span>
              <span className="font-data text-xs text-sub">
                {c.completed ? "Done" : `${Math.min(c.progress, c.goal)}/${c.goal}`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
