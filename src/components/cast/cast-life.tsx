"use client";

/**
 * Wakes a host's cast figures. Renders nothing.
 *
 * - Marks each figure `data-near` once it is within a screen of the viewport,
 *   so a deferred figure's art loads (that is not motion, so nothing gates it).
 * - Loads lib/cast/life (breathe, blink, look, taps, reactions) once a figure
 *   is near, the tab is visible and the browser is idle, and only without
 *   reduced motion, Save-Data or 2G. Never inside an intro overlay.
 *
 * `host` names the element to wake: `data-cast-host="<host>"`. Without it,
 * the whole page. `cast` names the figures it wakes, such as
 * `rigs.map((r) => r.id).join(" ")`: it finds them once, so a host whose
 * figures change without remounting it (another episode, a strip shown after
 * the guess) changes `cast`, and a change starts it afresh.
 */

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { isSaveData } from "@/lib/holiday/save-data";

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

export function CastLife({ host, cast }: { host?: string; cast?: string }) {
  const pathname = usePathname();
  const path = useRef(pathname);
  path.current = pathname;

  useEffect(() => {
    const root = host
      ? document.querySelector<HTMLElement>(`[data-cast-host="${host}"]`)
      : document.body;
    if (!root || root.closest("[data-intro-overlay]")) return;
    const figures = Array.from(root.querySelectorAll("[data-cast]")).filter(
      (el) => !el.closest("[data-intro-overlay]")
    );
    if (figures.length === 0) return;
    const w = window as IdleWindow;
    const lively = !matchMedia("(prefers-reduced-motion: reduce)").matches && !isSaveData();
    let near = false;
    let asked = false;
    let gone = false;
    let idle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dispose: (() => void) | undefined;

    const load = () => {
      if (gone) return;
      void import("@/lib/cast/life").then((life) => {
        if (!gone)
          dispose = life.startLife(
            root,
            life.lifeEnv(() => path.current)
          );
      });
    };
    const ask = () => {
      if (asked || !lively || !near || document.visibilityState === "hidden") return;
      asked = true;
      document.removeEventListener("visibilitychange", ask);
      if (w.requestIdleCallback) idle = w.requestIdleCallback(load, { timeout: 2000 });
      else timer = setTimeout(load, 200);
    };

    const seen = (el: Element) => {
      el.setAttribute("data-near", "");
      near = true;
      ask();
    };
    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                io?.unobserve(entry.target);
                seen(entry.target);
              }
            },
            { rootMargin: "100% 0px" }
          );
    document.addEventListener("visibilitychange", ask);
    for (const el of figures) {
      if (io) io.observe(el);
      else seen(el);
    }

    return () => {
      gone = true;
      io?.disconnect();
      document.removeEventListener("visibilitychange", ask);
      if (idle !== undefined) w.cancelIdleCallback?.(idle);
      clearTimeout(timer);
      dispose?.();
    };
  }, [host, cast]);

  return null;
}
