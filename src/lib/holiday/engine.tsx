"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { X, Sparkles } from "lucide-react";
import { useHolidayStore } from "@/lib/stores/holiday-store";
import { getActiveHolidayIds, windowKey } from "./detect";
import { loadTheme, HOLIDAY_IDS } from "./themes";
import type { HolidayId, HolidayTheme, HolidayWindow } from "./types";
import type { ISourceOptions } from "@tsparticles/engine";
import { isSaveData } from "./save-data";
import { cn } from "@/lib/utils";
import { useMoodProfile } from "@/lib/emotion/use-mood";
import { useWeather } from "@/lib/weather/provider";

// tsparticles is dynamic-imported so its ~50KB stays out of the critical
// path.  We cache the init promise so concurrent calls dedupe, and only
// commit the success flag after the engine actually initialises — that way
// a transient network failure doesn't lock out future retries.
let particlesInitPromise: Promise<boolean> | null = null;

async function initParticles(): Promise<boolean> {
  if (particlesInitPromise) return particlesInitPromise;
  particlesInitPromise = (async () => {
    try {
      const { initParticlesEngine } = await import("@tsparticles/react");
      const { loadSlim } = await import("@tsparticles/slim");
      await initParticlesEngine(async (engine) => {
        await loadSlim(engine);
      });
      return true;
    } catch {
      // Reset so a future theme activation can retry
      particlesInitPromise = null;
      return false;
    }
  })();
  return particlesInitPromise;
}

const Particles = dynamic(() => import("@tsparticles/react").then((m) => m.default), {
  ssr: false,
  loading: () => null,
});

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function injectThemeStyle(id: string, cssTokens: Record<string, string>) {
  if (typeof document === "undefined") return;
  const styleId = "holiday-theme-tokens";
  let el = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = styleId;
    document.head.appendChild(el);
  }
  const body = Object.entries(cssTokens)
    .map(([k, v]) => `${k}: ${v};`)
    .join("\n");
  el.textContent = `:root{\n${body}\n}\n[data-holiday-theme="${id}"]{\n${body}\n}`;
  document.documentElement.setAttribute("data-holiday-theme", id);
}

function removeThemeStyle() {
  if (typeof document === "undefined") return;
  const el = document.getElementById("holiday-theme-tokens");
  if (el) el.remove();
  document.documentElement.removeAttribute("data-holiday-theme");
}

interface ResolvedTheme extends HolidayTheme {
  window: HolidayWindow;
}

export function HolidayEngine() {
  const searchParams = useSearchParams();
  const previewParam = searchParams?.get("previewHoliday") as HolidayId | null;

  const [hydrated, setHydrated] = useState(false);
  const [theme, setTheme] = useState<ResolvedTheme | null>(null);
  const [particlesReady, setParticlesReady] = useState(false);

  const enabled = useHolidayStore((s) => s.enabled);
  const dismissedWindows = useHolidayStore((s) => s.dismissedWindows);
  const previewThemeId = useHolidayStore((s) => s.previewThemeId);
  const dismiss = useHolidayStore((s) => s.dismiss);

  // Rehydrate the store, then mark hydrated. rehydrate() can return a Promise
  // on async storages — set hydrated only after it resolves so the first
  // render doesn't read default `enabled`/`dismissedWindows` and briefly flash
  // a holiday theme that the user already dismissed.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(useHolidayStore.persist.rehydrate()).then(() => {
      if (!cancelled) setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Detect active holiday + load its module
  useEffect(() => {
    if (!hydrated) return;
    if (!enabled && !previewParam && !previewThemeId) {
      setTheme(null);
      removeThemeStyle();
      return;
    }

    let cancelled = false;

    const loadActive = async () => {
      // Preview overrides — dev param, then store-level preview
      const forcedId = previewParam ?? previewThemeId;
      if (forcedId && HOLIDAY_IDS.includes(forcedId)) {
        const mod = await loadTheme(forcedId);
        if (cancelled) return;
        // Use a synthetic window so dismissal is distinct from real windows
        const now = new Date().toISOString().slice(0, 10);
        setTheme({ ...mod, window: { startISO: now, endISO: now } });
        injectThemeStyle(forcedId, mod.cssTokens);
        return;
      }

      if (!enabled) return;
      const detection = getActiveHolidayIds();
      if (!detection.active) {
        setTheme(null);
        removeThemeStyle();
        return;
      }
      const key = windowKey(detection.active.id, detection.active.window);
      if (dismissedWindows[key]) {
        setTheme(null);
        removeThemeStyle();
        return;
      }
      const mod = await loadTheme(detection.active.id);
      if (cancelled) return;
      setTheme({ ...mod, window: detection.active.window });
      injectThemeStyle(detection.active.id, mod.cssTokens);
    };

    void loadActive();

    return () => {
      cancelled = true;
    };
  }, [hydrated, enabled, dismissedWindows, previewThemeId, previewParam]);

  // Init tsparticles once when a theme is active — only marks ready when
  // initialisation actually succeeded.
  useEffect(() => {
    if (!theme) return;
    if (prefersReducedMotion()) return;
    if (isSaveData()) return;
    let alive = true;
    void initParticles().then((ok) => {
      if (alive && ok) setParticlesReady(true);
    });
    return () => {
      alive = false;
    };
  }, [theme]);

  // Cross-integration: the emotion engine's mood profile and the Cairo weather
  // wind speed both modulate the particle drift velocity. Playful moods speed
  // particles up, Melancholy slows them; a breezy day in Cairo pushes drift
  // outward.  This is the "wind speed → particle drift" integration the spec
  // asks for, combined with the emotion-driven tempo.
  const moodProfile = useMoodProfile();
  const { weather } = useWeather();
  // Depend on the full weather object; windSpeed is the only property we read
  // but the object identity is the stable signal from the provider.
  const windMultiplier = useMemo(() => {
    if (!weather) return 1;
    // 3 m/s ≈ normal, 6 m/s → 2x, cap at 3x so gusts don't launch particles off-screen
    return Math.min(3, Math.max(0.5, weather.windSpeed / 3));
  }, [weather]);

  const particleOptions = useMemo<ISourceOptions | null>(() => {
    if (!theme?.particleConfig) return null;
    const base = theme.particleConfig;
    const baseMove = base.particles?.move;
    const baseSpeed =
      typeof baseMove === "object" && baseMove && "speed" in baseMove && typeof baseMove.speed === "number"
        ? baseMove.speed
        : 1;
    const scaledSpeed = baseSpeed * moodProfile.particleSpeed * windMultiplier;
    return {
      ...base,
      particles: {
        ...base.particles,
        move: {
          ...(typeof baseMove === "object" ? baseMove : {}),
          speed: scaledSpeed,
        },
      },
    } as ISourceOptions;
  }, [theme, moodProfile.particleSpeed, windMultiplier]);

  if (!theme) return null;

  const showParticles =
    particleOptions &&
    particlesReady &&
    !prefersReducedMotion() &&
    !isSaveData();

  const dismissKey = windowKey(theme.id, theme.window);
  const isPreview = !!previewParam || !!previewThemeId;

  return (
    <>
      {showParticles ? (
        <div
          className="pointer-events-none fixed inset-0 z-[5]"
          aria-hidden="true"
          data-holiday-canvas={theme.id}
        >
          <Particles
            id={`holiday-particles-${theme.id}`}
            options={particleOptions}
            className="h-full w-full"
          />
        </div>
      ) : null}

      {/* Dismiss chip — bottom-right, stays above particles, below XP bar */}
      <button
        type="button"
        onClick={() => {
          if (isPreview) {
            useHolidayStore.getState().setPreview(null);
            return;
          }
          dismiss(dismissKey);
        }}
        className={cn(
          "fixed z-[60] rounded-full border border-border bg-card/80 backdrop-blur-sm",
          "px-3 py-1.5 text-[11px] text-sub hover:text-text hover:border-accent/40 transition",
          "flex items-center gap-1.5 shadow-lg",
          "bottom-20 right-3 md:bottom-16 md:right-4",
          "active-press",
        )}
        aria-label={`Dismiss ${theme.name} theme`}
        data-no-sound="true"
      >
        <Sparkles className="w-3 h-3 holiday-accent-text" aria-hidden="true" />
        <span>{theme.name}</span>
        <X className="w-3 h-3 opacity-60" aria-hidden="true" />
      </button>
    </>
  );
}
