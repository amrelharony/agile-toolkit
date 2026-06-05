"use client";

import { useEffect } from "react";
import { emit } from "./emit";

type HoverKind = "button" | "link" | "input" | "card" | "interactive";

const HOVER_SELECTOR =
  "button, a, [role='button'], [role='tab'], [role='menuitem'], [role='option'], [role='switch'], [role='checkbox'], [data-slot='trigger'], input, textarea, [contenteditable='true'], [data-sonify-hover]";

const CLICK_SELECTOR =
  "button, a, [role='button'], [role='tab'], [role='menuitem'], [role='option'], [role='switch'], [role='checkbox'], [data-slot='trigger']";

const HOVER_DEBOUNCE_MS = 80;
const HOVER_FLOOR_MS = 90; // global rate cap ~11/sec
const CLICK_DEDUP_MS = 20;
const STATE_COALESCE_MS = 50;

function classify(el: HTMLElement): HoverKind {
  const tag = el.tagName.toLowerCase();
  if (tag === "button" || el.getAttribute("role") === "button") return "button";
  if (tag === "a") return "link";
  if (tag === "input" || tag === "textarea" || el.isContentEditable) return "input";
  if (el.hasAttribute("data-sonify-hover") && el.getAttribute("data-sonify-hover") === "card") {
    return "card";
  }
  return "interactive";
}

/**
 * True if `el` (or any ancestor) opts out of sound via `data-no-sound="true"`.
 * Accepts any EventTarget and walks only real Elements — a keydown can target
 * `document`/`window`, which have no getAttribute/parentElement. (exported for tests)
 */
export function isSuppressed(el: EventTarget | null): boolean {
  let cur: Element | null = el instanceof Element ? el : null;
  while (cur) {
    if (cur.getAttribute("data-no-sound") === "true") return true;
    cur = cur.parentElement;
  }
  return false;
}

/**
 * Global delegated router — emits `ui:*` for every pointer-over / click / focus /
 * keyboard interaction and for every `data-state` mutation in the DOM.  Runs
 * only when `enabled=true` (detaches listeners otherwise to avoid perf cost).
 */
export function SonificationEventRouter({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    // --- pointerover (hover) -------------------------------------------------
    const hoverTimestamps = new WeakMap<Element, number>();
    let lastHoverTs = 0;

    const onPointerOver = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || isSuppressed(target)) return;
      const el = target.closest<HTMLElement>(HOVER_SELECTOR);
      if (!el) return;
      const now = performance.now();
      // global floor
      if (now - lastHoverTs < HOVER_FLOOR_MS) return;
      // per-element debounce
      const last = hoverTimestamps.get(el) ?? 0;
      if (now - last < HOVER_DEBOUNCE_MS) return;
      hoverTimestamps.set(el, now);
      lastHoverTs = now;
      emit("ui", `hover-${classify(el)}`);
    };

    // --- click (covers mouse + keyboard) -------------------------------------
    let lastClickTs = 0;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || isSuppressed(target)) return;
      const el = target.closest<HTMLElement>(CLICK_SELECTOR);
      if (!el) return;
      const now = performance.now();
      if (now - lastClickTs < CLICK_DEDUP_MS) return;
      lastClickTs = now;

      // `data-variant` is set by shadcn Button (even through Slot/asChild) so
      // anchor-as-button cases still get the right variant sound.  The element
      // is forwarded to haptics for per-element cooldown + iOS visual pulse.
      // The haptics palette resolves `ui:click-<variant>` to the right pattern,
      // so no separate `data-haptic` dispatch is needed here — avoiding a
      // double-fire that the 40ms cooldown would only partially suppress.
      const variant = el.getAttribute("data-variant");
      if (variant) {
        emit("ui", `click-${variant}`, el);
      } else if (el.tagName.toLowerCase() === "a") {
        emit("ui", "click-link", el);
      } else {
        emit("ui", "click-generic", el);
      }
    };

    // --- focusin (inputs / textareas) ----------------------------------------
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || isSuppressed(target)) return;
      const tag = target.tagName.toLowerCase();
      const editable = target.isContentEditable;
      if (tag === "input" || tag === "textarea" || editable) {
        emit("ui", "focus-input");
      }
    };

    // --- keydown (Enter / Escape / typing keystrokes) ------------------------
    // Per-element keystroke rate cap so a key being held doesn't shred the
    // voice engine. 25ms ≈ 40 keystrokes/sec — well above human top speed
    // (Guinness record is ~17/sec sustained), so a comfortable cap.
    const lastKeystrokeAt = new WeakMap<Element, number>();
    const KEYSTROKE_FLOOR_MS = 25;

    const onKeyDown = (e: KeyboardEvent) => {
      // A keydown can target document/window (nothing focused, or synthetic
      // dispatch); bail unless it's a real element so .tagName/.closest are safe.
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (!target || isSuppressed(target)) return;
      const tag = target.tagName.toLowerCase();
      const insideInput = tag === "input" || tag === "textarea" || target.isContentEditable;

      if (e.key === "Escape") {
        emit("ui", "key-dismiss");
        return;
      }
      if (e.key === "Enter" && !insideInput) {
        // For any clickable, the browser will synthesize a `click` and our
        // click handler above will emit — avoid double-firing here.
        const clickable = target.closest(CLICK_SELECTOR);
        if (!clickable) emit("ui", "key-confirm");
        return;
      }

      // ── Typing sounds: only inside text-entry surfaces, and skip:
      //   • password inputs (avoid surfacing length/cadence of secrets)
      //   • keys that don't produce a character (Tab/Arrow/Home/End/Fn/etc.)
      //   • combos with Ctrl/Meta/Alt (shortcuts shouldn't sound like typing)
      //   • keys that are auto-repeating beyond the rate cap
      if (!insideInput) return;
      if (tag === "input") {
        const type = (target as HTMLInputElement).type;
        if (type === "password") return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const now = performance.now();
      const last = lastKeystrokeAt.get(target) ?? 0;
      if (now - last < KEYSTROKE_FLOOR_MS) return;

      let event: string | null = null;
      if (e.key === "Backspace" || e.key === "Delete") {
        event = "keystroke-backspace";
      } else if (e.key === " " || e.key === "Spacebar") {
        event = "keystroke-space";
      } else if (e.key.length === 1) {
        // Single-codepoint keys: letters, digits, punctuation, "Enter" stays
        // 1-char but we want a distinct sound for that — fall through to
        // key-confirm below.
        event = "keystroke";
      } else if (e.key === "Enter") {
        // Newline inside a textarea — distinct from confirm-as-submit.
        event = "keystroke-space";
      }

      if (event) {
        lastKeystrokeAt.set(target, now);
        emit("ui", event);
      }
    };

    // --- MutationObserver on [data-state] ------------------------------------
    const stateHistory = new WeakMap<Element, string>();
    const lastStateEmitAt = new WeakMap<Element, number>();

    const observer = new MutationObserver((mutations) => {
      const now = performance.now();
      for (const m of mutations) {
        if (m.type !== "attributes") continue;
        if (m.attributeName !== "data-state") continue;
        const el = m.target as HTMLElement;
        if (isSuppressed(el)) continue;
        const next = el.getAttribute("data-state");
        if (!next) continue;
        const prev = stateHistory.get(el);
        stateHistory.set(el, next);
        if (prev === next) continue;
        const lastEmit = lastStateEmitAt.get(el) ?? 0;
        if (now - lastEmit < STATE_COALESCE_MS) continue;
        lastStateEmitAt.set(el, now);

        if (next === "open" && prev !== "open") emit("ui", "state-open");
        else if (next === "closed" && prev === "open") emit("ui", "state-close");
        else if (next === "checked" && prev === "unchecked") emit("ui", "toggle-on");
        else if (next === "unchecked" && prev === "checked") emit("ui", "toggle-off");
        else if (next === "active" && prev !== "active") emit("ui", "tab-change");
      }
    });

    // Prime initial states so we don't falsely detect a transition on first
    // paint (e.g. tabs default value = "active").
    document.querySelectorAll<HTMLElement>("[data-state]").forEach((el) => {
      const s = el.getAttribute("data-state");
      if (s) stateHistory.set(el, s);
    });
    observer.observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-state"],
    });

    window.addEventListener("pointerover", onPointerOver, { passive: true });
    window.addEventListener("click", onClick, { passive: true });
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("pointerover", onPointerOver);
      window.removeEventListener("click", onClick);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("keydown", onKeyDown);
      observer.disconnect();
    };
  }, [enabled]);

  return null;
}
