"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";
import { installEventBridge } from "./event-bridge";
import { installSecretDetector } from "./secrets";
import { installWindowBridge, subscribe } from "./engine";
import { appendXpEvent } from "./opfs";
import { cancelProfileSync, scheduleProfileSync } from "./supabase-sync";
import { achievements } from "./achievements";
import { toast } from "@/lib/utils/toast";
import { useIsOwner } from "@/lib/auth/use-is-owner";
import type { XpEvent } from "./types";
import { mayCelebrate } from "./quiet";

/**
 * Must sit under <AuthProvider>: the leaderboard upsert to Supabase is
 * owner-only, so visitors (and a tree without AuthProvider) keep their
 * XP, levels and achievements in this browser.
 */
export function GamificationProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const silentMode = useVDnaStore((s) => s.silentMode);
  const isOwner = useIsOwner();
  // Celebration toasts stay out of live ceremonies and are throttled
  // elsewhere (lib/gamification/quiet.ts). Read through refs so the
  // subscription isn't torn down on every navigation.
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const lastCelebrationRef = useRef(0);

  useEffect(() => {
    // Once both stores hold the user's data, map the legacy silent mode onto
    // the celebration level (once ever; see notification-prefs-store).
    void Promise.all([
      useVDnaStore.persist.rehydrate(),
      useNotificationPrefsStore.persist.rehydrate(),
    ])
      .then(() => {
        if (!useVDnaStore.persist.hasHydrated()) return;
        if (!useNotificationPrefsStore.persist.hasHydrated()) return;
        useNotificationPrefsStore.getState().adoptSilentMode(useVDnaStore.getState().silentMode);
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

  // Signing out drops a sync still waiting out its debounce.
  useEffect(() => {
    if (!isOwner) cancelProfileSync();
  }, [isOwner]);

  useEffect(() => {
    if (!mounted) return;
    const celebrate = (show: () => void) => {
      if (silentMode) return;
      // A shared screen in presentation mode stays quiet, like a ceremony.
      if (document.documentElement.dataset.presenting === "true") return;
      const now = Date.now();
      if (!mayCelebrate(pathnameRef.current, now, lastCelebrationRef.current)) return;
      lastCelebrationRef.current = now;
      show();
    };
    const unsub = subscribe((effect) => {
      if (effect.kind === "xp") {
        const xpEvt = effect.payload as unknown as XpEvent;
        const visitor = useVDnaStore.getState().visitorId;
        appendXpEvent({ ...xpEvt, visitorId: visitor });
        if (isOwner) scheduleProfileSync();
      } else if (effect.kind === "level-up") {
        const { level } = effect.payload as { level: number };
        celebrate(() =>
          toast.success(`Level ${level}!`, { description: "New milestone unlocked." })
        );
        if (isOwner) scheduleProfileSync();
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
        celebrate(() => toast.info(`Challenge complete!`, { description: `+${xp} XP` }));
      } else if (effect.kind === "prestige") {
        if (!silentMode)
          toast.success("Prestige!", {
            description: "You're ascended. Prestige badge awarded.",
          });
      }
    });
    return unsub;
  }, [mounted, silentMode, isOwner]);

  return <>{children}</>;
}
