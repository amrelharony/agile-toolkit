"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import {
  getNotificationPrefsSnapshot,
  useNotificationPrefsStore,
} from "@/lib/stores/notification-prefs-store";
import { installEventBridge, trackPathVisit } from "./event-bridge";
import { installSecretDetector } from "./secrets";
import { installWindowBridge, subscribe } from "./engine";
import { appendXpEvent } from "./opfs";
import { cancelProfileSync, scheduleProfileSync } from "./supabase-sync";
import { achievements } from "./achievements";
import { toast } from "@/lib/utils/toast";
import { useIsOwner } from "@/lib/auth/use-is-owner";
import type { XpEvent } from "./types";
import { defaultQuietDom } from "@/lib/notify/quiet-state";
import { useInboxStore } from "@/lib/notify/inbox-store";
import {
  installCelebrations,
  isLegacyCelebrations,
  legacyCelebrationAllowed,
  seedCarriedOver,
} from "./celebrations";
import { installMomentScheduler, setMomentPathname } from "@/lib/notify/moment-scheduler";

/**
 * Must sit under <AuthProvider>: the leaderboard upsert to Supabase is
 * owner-only, so visitors (and a tree without AuthProvider) keep their
 * XP, levels and achievements in this browser.
 */
export function GamificationProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const isOwner = useIsOwner();
  // Read through a ref so the subscription isn't torn down on every
  // navigation (only the legacy celebration toasts look at the route).
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    // Once the stores hold the user's data, map the legacy silent mode onto
    // the celebration level (once ever; see notification-prefs-store), and
    // give an existing profile its "Your progress carried over" row.
    void Promise.all([
      useVDnaStore.persist.rehydrate(),
      useNotificationPrefsStore.persist.rehydrate(),
      useInboxStore.persist.rehydrate(),
    ])
      .then(() => {
        if (!useVDnaStore.persist.hasHydrated()) return;
        if (useNotificationPrefsStore.persist.hasHydrated()) {
          useNotificationPrefsStore.getState().adoptSilentMode(useVDnaStore.getState().silentMode);
        }
        if (useInboxStore.persist.hasHydrated() && !isLegacyCelebrations()) seedCarriedOver();
      })
      .catch(() => {});
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (typeof window === "undefined") return;
    const detachBridge = installEventBridge();
    const detachSecrets = installSecretDetector();
    installWindowBridge();
    return () => {
      detachBridge();
      detachSecrets();
    };
  }, [mounted]);

  // Tool visits follow the router, not a patched history.pushState.
  useEffect(() => {
    if (!mounted) return;
    trackPathVisit(pathname);
  }, [mounted, pathname]);

  // Signing out drops a sync still waiting out its debounce.
  useEffect(() => {
    if (!isOwner) cancelProfileSync();
  }, [isOwner]);

  // XP goes to the local log (and the owner's leaderboard sync).
  useEffect(() => {
    if (!mounted) return;
    return subscribe((effect) => {
      if (effect.kind === "xp") {
        const xpEvt = effect.payload as unknown as XpEvent;
        const visitor = useVDnaStore.getState().visitorId;
        appendXpEvent({ ...xpEvt, visitorId: visitor });
        if (isOwner) scheduleProfileSync();
      } else if (effect.kind === "level-up") {
        if (isOwner) scheduleProfileSync();
      }
    });
  }, [mounted, isOwner]);

  // Celebrations land silently in the Activity inbox, never as toasts, and
  // are never dropped (lib/gamification/celebrations.ts).
  useEffect(() => {
    if (!mounted || isLegacyCelebrations()) return;
    return installCelebrations();
  }, [mounted]);

  // Rare items also get a short moment with Amr at a calm time
  // (lib/notify/moment-scheduler.ts). It hears the route to know when a
  // ceremony ends and to name what a held item waited through.
  useEffect(() => {
    if (!mounted || isLegacyCelebrations()) return;
    return installMomentScheduler();
  }, [mounted]);

  useEffect(() => {
    if (!mounted || isLegacyCelebrations()) return;
    setMomentPathname(pathname);
  }, [mounted, pathname]);

  // NEXT_PUBLIC_CELEBRATIONS=legacy: the old celebration toasts (kill switch,
  // removed in PR K). The Notifications page still governs them: Quiet
  // level, paused, Focus, quiet hours, ceremonies and presenting silence them.
  useEffect(() => {
    if (!mounted || !isLegacyCelebrations()) return;
    const celebrate = (show: () => void) => {
      const allowed = legacyCelebrationAllowed({
        silentMode: useVDnaStore.getState().silentMode,
        prefs: getNotificationPrefsSnapshot(),
        pathname: pathnameRef.current,
        dom: defaultQuietDom(),
        now: Date.now(),
      });
      if (allowed) show();
    };
    return subscribe((effect) => {
      if (effect.kind === "level-up") {
        const { level } = effect.payload as { level: number };
        celebrate(() =>
          toast.success(`Level ${level}!`, { description: "New milestone unlocked." })
        );
      } else if (effect.kind === "achievement") {
        const { id, title, xp } = effect.payload as { id: string; title: string; xp: number };
        const ach = achievements.find((a) => a.id === id);
        celebrate(() =>
          toast.success(`Achievement: ${title}`, {
            description: `+${xp} XP${ach?.description ? ` · ${ach.description}` : ""}`,
          })
        );
      } else if (effect.kind === "challenge-complete") {
        const { xp } = effect.payload as { xp: number };
        celebrate(() => toast.info("Challenge complete!", { description: `+${xp} XP` }));
      } else if (effect.kind === "prestige") {
        celebrate(() =>
          toast.success("Prestige!", { description: "You're ascended. Prestige badge awarded." })
        );
      }
    });
  }, [mounted]);

  return <>{children}</>;
}
