"use client";

import { useEffect, useState } from "react";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { installEventBridge } from "./event-bridge";
import { installSecretDetector } from "./secrets";
import { installWindowBridge, subscribe } from "./engine";
import { appendXpEvent } from "./opfs";
import { cancelProfileSync, scheduleProfileSync } from "./supabase-sync";
import { achievements } from "./achievements";
import { toast } from "@/lib/utils/toast";
import { useIsOwner } from "@/lib/auth/use-is-owner";
import type { XpEvent } from "./types";

/**
 * Must sit under <AuthProvider>: the leaderboard upsert to Supabase is
 * owner-only, so visitors (and a tree without AuthProvider) keep their
 * XP, levels and achievements in this browser.
 */
export function GamificationProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const silentMode = useVDnaStore((s) => s.silentMode);
  const isOwner = useIsOwner();

  useEffect(() => {
    useVDnaStore.persist.rehydrate();
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
    const unsub = subscribe((effect) => {
      if (effect.kind === "xp") {
        const xpEvt = effect.payload as unknown as XpEvent;
        const visitor = useVDnaStore.getState().visitorId;
        appendXpEvent({ ...xpEvt, visitorId: visitor });
        if (isOwner) scheduleProfileSync();
      } else if (effect.kind === "level-up") {
        const { level } = effect.payload as { level: number };
        if (!silentMode) {
          toast.success(`Level ${level}!`, { description: "New milestone unlocked." });
        }
        if (isOwner) scheduleProfileSync();
      } else if (effect.kind === "achievement") {
        const { id, title, xp } = effect.payload as { id: string; title: string; xp: number };
        const ach = achievements.find((a) => a.id === id);
        if (!silentMode) {
          toast.success(`Achievement: ${title}`, {
            description: `+${xp} XP${ach?.description ? ` · ${ach.description}` : ""}`,
          });
        }
      } else if (effect.kind === "challenge-complete") {
        const { xp } = effect.payload as { xp: number };
        if (!silentMode) toast.info(`Challenge complete!`, { description: `+${xp} XP` });
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
