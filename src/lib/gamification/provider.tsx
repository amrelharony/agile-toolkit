"use client";

import { useEffect, useState } from "react";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { installEventBridge } from "./event-bridge";
import { installSecretDetector } from "./secrets";
import { installWindowBridge, subscribe } from "./engine";
import { appendXpEvent } from "./opfs";
import { scheduleProfileSync } from "./supabase-sync";
import { achievements } from "./achievements";
import { toast } from "@/lib/utils/toast";
import type { XpEvent } from "./types";

export function GamificationProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const silentMode = useVDnaStore((s) => s.silentMode);

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

  useEffect(() => {
    if (!mounted) return;
    const unsub = subscribe((effect) => {
      if (effect.kind === "xp") {
        const xpEvt = effect.payload as unknown as XpEvent;
        const visitor = useVDnaStore.getState().visitorId;
        appendXpEvent({ ...xpEvt, visitorId: visitor });
        scheduleProfileSync();
      } else if (effect.kind === "level-up") {
        const { level } = effect.payload as { level: number };
        if (!silentMode) {
          toast.success(`Level ${level}!`, { description: "New milestone unlocked." });
        }
        scheduleProfileSync();
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
  }, [mounted, silentMode]);

  return <>{children}</>;
}
