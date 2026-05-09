"use client";

import { dispatch } from "./engine";

const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

const PHRASES = [
  { word: "agile", event: "secret:typed-agile" },
  { word: "scrum", event: "secret:typed-scrum" },
  { word: "kanban", event: "secret:typed-kanban" },
  { word: "ship", event: "secret:typed-ship" },
];

export function installSecretDetector(): () => void {
  if (typeof window === "undefined") return () => undefined;

  let konamiIdx = 0;
  let buffer = "";
  let bufferTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastLogoHoverTs = 0;
  let logoHoverCount = 0;

  const onKeyDown = (e: KeyboardEvent) => {
    // Ignore modifier combos / function keys
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1 && !e.key.startsWith("Arrow") && e.key !== "a" && e.key !== "b") return;

    // Konami progress.
    const expected = KONAMI[konamiIdx];
    if (e.key === expected || e.key.toLowerCase() === expected) {
      konamiIdx++;
      if (konamiIdx === KONAMI.length) {
        konamiIdx = 0;
        dispatch({ name: "secret:konami" });
      }
    } else {
      konamiIdx = e.key === KONAMI[0] ? 1 : 0;
    }

    // Phrase buffer (only accumulate letters)
    if (e.key.length === 1 && /^[a-zA-Z]$/.test(e.key)) {
      buffer = (buffer + e.key.toLowerCase()).slice(-16);
      for (const p of PHRASES) {
        if (buffer.endsWith(p.word)) {
          dispatch({ name: p.event });
          buffer = "";
          break;
        }
      }
      if (bufferTimeout) clearTimeout(bufferTimeout);
      bufferTimeout = setTimeout(() => {
        buffer = "";
      }, 2000);
    }
  };

  // Triple-click on tool cards
  let clickCount = 0;
  let lastClickTs = 0;
  let lastClickTarget: EventTarget | null = null;
  const onClick = (e: MouseEvent) => {
    const now = Date.now();
    const target = (e.target as HTMLElement | null)?.closest("[data-sonify-hover='card']");
    if (target && target === lastClickTarget && now - lastClickTs < 500) {
      clickCount++;
      if (clickCount >= 3) {
        clickCount = 0;
        dispatch({ name: "secret:triple-tap" });
      }
    } else {
      clickCount = 1;
    }
    lastClickTs = now;
    lastClickTarget = target ?? null;
  };

  // Logo hover (AT.svg wrapper in sidebar)
  const onPointerOver = (e: PointerEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const logo = target.closest("[data-sidebar-logo='true']") ?? target.closest("img[alt='Agile Toolkit']");
    if (!logo) return;
    const now = Date.now();
    if (now - lastLogoHoverTs < 400) return; // debounce same-hover
    lastLogoHoverTs = now;
    logoHoverCount++;
    dispatch({ name: "logo-hover", meta: { count: logoHoverCount } });
    if (logoHoverCount >= 10) {
      logoHoverCount = 0;
      dispatch({ name: "logo-whispered" });
    }
  };

  // Footer year click
  const onFooterClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("[data-footer-year='true']")) {
      dispatch({ name: "secret:footer-click" });
    }
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("click", onClick, { passive: true });
  window.addEventListener("click", onFooterClick, { passive: true });
  window.addEventListener("pointerover", onPointerOver, { passive: true });

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("click", onClick);
    window.removeEventListener("click", onFooterClick);
    window.removeEventListener("pointerover", onPointerOver);
    if (bufferTimeout) clearTimeout(bufferTimeout);
  };
}
