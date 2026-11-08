"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { clearLegacySilentMode, hadLegacySilentMode, useVDnaStore } from "@/lib/stores/vdna-store";
import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";
import { installEventBridge, trackPathVisit } from "./event-bridge";
import { installSecretDetector } from "./secrets";
import { installWindowBridge, subscribe } from "./engine";
import { appendXpEvent } from "./opfs";
import { cancelProfileSync, scheduleProfileSync } from "./supabase-sync";
import { useIsOwner } from "@/lib/auth/use-is-owner";
import type { XpEvent } from "./types";
import { useInboxStore } from "@/lib/notify/inbox-store";
import { installCelebrations, seedCarriedOver } from "./celebrations";
import { installMomentScheduler, setMomentPathname } from "@/lib/notify/moment-scheduler";

/**
 * Must sit under <AuthProvider>: the leaderboard upsert to Supabase is
 * owner-only, so visitors (and a tree without AuthProvider) keep their
 * XP, levels and achievements in this browser.
 */
export function GamificationProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const isOwner = useIsOwner();
  const pathname = usePathname();

  useEffect(() => {
    // Once the stores hold the user's data, map the old silent mode onto the
    // celebration level (once ever; see notification-prefs-store). vdna v2
    // drops the field, so the store notes it while migrating the payload
    // (kept in storage until adopted here, so a failed load retries).
    // Then give an existing profile its "Your progress carried over" row.
    void Promise.all([
      useVDnaStore.persist.rehydrate(),
      useNotificationPrefsStore.persist.rehydrate(),
      useInboxStore.persist.rehydrate(),
    ])
      .then(() => {
        if (!useVDnaStore.persist.hasHydrated()) return;
        if (useNotificationPrefsStore.persist.hasHydrated()) {
          useNotificationPrefsStore.getState().adoptSilentMode(hadLegacySilentMode());
          clearLegacySilentMode();
        }
        if (useInboxStore.persist.hasHydrated()) seedCarriedOver();
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
    if (!mounted) return;
    return installCelebrations();
  }, [mounted]);

  // Rare items also get a short moment with Amr at a calm time
  // (lib/notify/moment-scheduler.ts). It hears the route to know when a
  // ceremony ends and to name what a held item waited through.
  useEffect(() => {
    if (!mounted) return;
    return installMomentScheduler();
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    setMomentPathname(pathname);
  }, [mounted, pathname]);

  return <>{children}</>;
}
