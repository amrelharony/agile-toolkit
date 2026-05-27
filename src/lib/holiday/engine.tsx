"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { X, Sparkles } from "lucide-react";
import { useHolidayStore } from "@/lib/stores/holiday-store";
import { getActiveHolidayIds, windowKey } from "./detect";
import { todayInCairo } from "./calendars/gregorian";
import { loadTheme, HOLIDAY_IDS } from "./themes";
import type { HolidayId, HolidayTheme, HolidayWindow } from "./types";
import type { ISourceOptions } from "@tsparticles/engine";
import { isSaveData } from "./save-data";
import { cn } from "@/lib/utils";
import { useMoodProfile } from "@/lib/emotion/use-mood";
import { useWeather } from "@/lib/weather/provider";
import { loadGsap } from "@/lib/emotion/gsap";

// tsparticles is dynamic-imported so its bundles stay out of the critical
// path.  We cache the init promise so concurrent calls dedupe, and only
// commit the success flag after the engine actually initialises — that way
// a transient network failure doesn't lock out future retries.
//
// IMPORTANT: loadSlim alone does NOT cover everything our themes declare.
// `move.trail`, `wobble`, `twinkle`, `emitters`, `move.path` and the
// `trail` interaction mode each ship as separate packages and silently
// no-op when not registered — that's how the previous "audit-clean"
// version had unrendered fireworks (eid-fitr emitters) and missing wobble
// across most themes. We load each one explicitly so what the theme
// declares is what the user actually sees.
let particlesInitPromise: Promise<boolean> | null = null;

async function initParticles(): Promise<boolean> {
  if (particlesInitPromise) return particlesInitPromise;
  particlesInitPromise = (async () => {
    try {
      const { initParticlesEngine } = await import("@tsparticles/react");
      const { loadSlim } = await import("@tsparticles/slim");
      const { loadEmittersPlugin } = await import("@tsparticles/plugin-emitters");
      const { loadWobbleUpdater } = await import("@tsparticles/updater-wobble");
      const { loadTwinkleUpdater } = await import("@tsparticles/updater-twinkle");
      const { loadTrailEffect } = await import("@tsparticles/effect-trail");
      const { loadExternalTrailInteraction } =
        await import("@tsparticles/interaction-external-trail");
      const { loadPolygonPath } = await import("@tsparticles/path-polygon");
      await initParticlesEngine(async (engine) => {
        await loadSlim(engine);
        await loadEmittersPlugin(engine);
        await loadWobbleUpdater(engine);
        await loadTwinkleUpdater(engine);
        await loadTrailEffect(engine);
        await loadExternalTrailInteraction(engine);
        await loadPolygonPath(engine);
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
  // Theme modules are bundled code so values are trusted, but a stray "}" or
  // angle-bracket in a token value would break out of the :root rule and
  // potentially the <style> element. Strip selector-breaking chars defensively.
  const sanitize = (v: string) => String(v).replace(/[}<>]/g, "");
  const body = Object.entries(cssTokens)
    .map(([k, v]) => `${k}: ${sanitize(v)};`)
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
    // R10: catch the rehydrate failure path. Corrupt persisted state
    // previously left `hydrated` false forever — the holiday detection
    // effect bailed and no theme ever loaded. Better to boot with
    // defaults than block forever.
    void Promise.resolve(useHolidayStore.persist.rehydrate())
      .then(() => {
        if (!cancelled) setHydrated(true);
      })
      .catch((err) => {
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn("[holiday] rehydrate failed:", err);
        }
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
        // Cancellation guard protects both setTheme and the synchronous
        // injectThemeStyle below — do not remove without restructuring.
        if (cancelled) return;
        // Use a synthetic window so dismissal is distinct from real windows.
        // Anchor the synthetic date to Cairo so preview dismissal keys line up
        // with real-window dismissal keys (which are Cairo-anchored).
        const now = todayInCairo(new Date()).iso;
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
      // Cancellation guard protects both setTheme and the synchronous
      // injectThemeStyle below — do not remove without restructuring.
      if (cancelled) return;
      setTheme({ ...mod, window: detection.active.window });
      injectThemeStyle(detection.active.id, mod.cssTokens);
    };

    void loadActive();

    return () => {
      cancelled = true;
      // R9: full unmount (SPA navigation away from where HolidayEngine
      // mounts) previously left the `<style id="holiday-theme-tokens">`
      // element on `:root`, persistently overriding the global theme.
      // Strip it on every cleanup — if the next effect run picks a
      // theme, it re-injects via `injectThemeStyle`, so this is safe.
      removeThemeStyle();
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
    // Defensive: a stub weather provider or a partial API response could send
    // NaN/undefined and silently zero out particle drift. Fall back to 1 in
    // those cases so the holiday theme still animates.
    const ws =
      typeof weather.windSpeed === "number" && Number.isFinite(weather.windSpeed)
        ? weather.windSpeed
        : 3;
    // 3 m/s ≈ normal, 6 m/s → 2x, cap at 3x so gusts don't launch particles off-screen
    return Math.min(3, Math.max(0.5, ws / 3));
  }, [weather]);

  const particleOptions = useMemo<ISourceOptions | null>(() => {
    if (!theme?.particleConfig) return null;
    const base = theme.particleConfig;
    const baseMove = base.particles?.move;
    const baseSpeed =
      typeof baseMove === "object" &&
      baseMove &&
      "speed" in baseMove &&
      typeof baseMove.speed === "number"
        ? baseMove.speed
        : 1;
    const scaledSpeed = baseSpeed * moodProfile.particleSpeed * windMultiplier;
    // Force window-level event detection so the underlying UI keeps its
    // pointer-events while interactive themes (click bursts, hover-attract)
    // still receive mouse signals. Themes can set their own interactivity.modes
    // without worrying about this plumbing.
    return {
      ...base,
      detectRetina: base.detectRetina ?? true,
      interactivity: {
        ...(base.interactivity ?? {}),
        detectsOn: "window",
        events: {
          ...(base.interactivity?.events ?? {}),
          resize: { enable: true, delay: 0.5 },
        },
      },
      particles: {
        ...base.particles,
        move: {
          ...(typeof baseMove === "object" ? baseMove : {}),
          speed: scaledSpeed,
        },
      },
    } as ISourceOptions;
  }, [theme, moodProfile.particleSpeed, windMultiplier]);

  // ------------------------------------------------------------------------
  // SVG overlay + GSAP animation
  // ------------------------------------------------------------------------
  // After the overlay SVG mounts, lazy-load GSAP and run the theme's `animate`
  // hook. The hook returns a cleanup (to kill its timeline) which we invoke on
  // theme unmount. Reduced-motion users skip the animate hook entirely; the
  // static SVG still renders so the theme isn't visually empty.
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const overlayCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!theme?.overlay) return;
    if (prefersReducedMotion()) return;
    if (isSaveData()) return;

    const container = overlayRef.current;
    if (!container) return;
    const svg = container.querySelector("svg") as SVGSVGElement | null;
    if (!svg) return;

    let cancelled = false;
    void loadGsap()
      .then((mod) => {
        if (cancelled) return;
        try {
          const cleanup = theme.overlay?.animate?.(svg, {
            gsap: mod.default,
            reducedMotion: false,
            windMultiplier,
          });
          if (typeof cleanup === "function") {
            overlayCleanupRef.current = cleanup;
          }
        } catch (err) {
          if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.warn("[holiday] overlay animate failed:", err);
          }
        }
      })
      .catch(() => {
        // GSAP failed to load — overlay still renders statically. Skip silently.
      });

    return () => {
      cancelled = true;
      const cleanup = overlayCleanupRef.current;
      overlayCleanupRef.current = null;
      if (cleanup) {
        try {
          cleanup();
        } catch {
          /* ignore — cleanup best-effort */
        }
      }
    };
  }, [theme, windMultiplier]);

  if (!theme) return null;

  const showParticles =
    particleOptions && particlesReady && !prefersReducedMotion() && !isSaveData();

  const dismissKey = windowKey(theme.id, theme.window);
  const isPreview = !!previewParam || !!previewThemeId;

  const overlayPositionClass = (() => {
    switch (theme.overlay?.position) {
      case "top-left":
        return "top-16 left-3 md:top-20 md:left-6";
      case "bottom-left":
        return "bottom-24 left-3 md:bottom-20 md:left-6";
      case "bottom-right":
        return "bottom-32 right-3 md:bottom-28 md:right-6";
      case "center":
        return "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2";
      case "top-center":
        return "top-16 left-1/2 -translate-x-1/2 md:top-20";
      case "top-right":
      default:
        return "top-16 right-3 md:top-20 md:right-6";
    }
  })();

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

      {theme.overlay ? (
        <div
          ref={overlayRef}
          className={cn(
            "pointer-events-none fixed z-[6]",
            overlayPositionClass,
            theme.overlay.className
          )}
          aria-hidden="true"
          data-holiday-overlay={theme.id}
          // Theme overlays are bundled, trusted code — same trust boundary as
          // particleConfig. innerHTML is fine here; CSP allows it for our origin.
          dangerouslySetInnerHTML={{ __html: theme.overlay.svg }}
        />
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
          "active-press"
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
