/**
 * Where the user's attention is, from passive listeners that only write
 * timestamps. Nothing here dispatches, re-renders or calls the gamification
 * engine: a keystroke costs one `performance.now()` and a property write.
 *
 * Readers query it when they need to decide something:
 * - haptics/gate.ts suppresses haptics mid-scroll and mid-typing
 * - the notification policy and moment scheduler (later PRs) wait for calm
 *
 * All times are on the `performance.now()` clock. Install is ref-counted, so
 * several owners (haptics, the notify provider) share one set of listeners.
 *
 * No "use client": server code may import this module; on the server nothing
 * installs and every reader reports "no input yet".
 */

/** A keystroke or input in an editable field within this window counts as typing. */
export const TYPING_WINDOW_MS = 2500;

let lastInputAt = Number.NEGATIVE_INFINITY;
let lastTypingAt = Number.NEGATIVE_INFINITY;
let lastEditAt = Number.NEGATIVE_INFINITY;
let lastScrollAt = Number.NEGATIVE_INFINITY;

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** True for targets where keys produce text: text inputs, textareas, contenteditable. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const el = target as HTMLElement;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    return !NON_TEXT_INPUT_TYPES.has(((el as HTMLInputElement).type || "text").toLowerCase());
  }
  if (el.isContentEditable) return true;
  // jsdom doesn't implement isContentEditable; the attribute walk covers it.
  return el.closest("[contenteditable]:not([contenteditable='false'])") !== null;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

const onPointerDown = () => {
  lastInputAt = now();
};
const onKeyDown = (e: KeyboardEvent) => {
  const t = now();
  lastInputAt = t;
  if (isEditableTarget(e.target)) lastTypingAt = t;
};
const onInput = (e: Event) => {
  const t = now();
  lastInputAt = t;
  // Any input event (a checkbox too) keeps haptics out of the way briefly.
  lastEditAt = t;
  if (isEditableTarget(e.target)) lastTypingAt = t;
};
const onScroll = () => {
  const t = now();
  lastInputAt = t;
  lastScrollAt = t;
};

const OPTS: AddEventListenerOptions = { passive: true, capture: true };
const LISTENERS: [string, EventListener][] = [
  ["pointerdown", onPointerDown as EventListener],
  ["keydown", onKeyDown as EventListener],
  ["input", onInput],
  ["scroll", onScroll],
];

let refs = 0;

/**
 * Start listening (ref-counted). Returns a release function; the listeners
 * come off when the last owner releases. Releasing twice is a no-op.
 */
export function installAttention(): () => void {
  if (typeof window === "undefined") return () => undefined;
  if (refs === 0) {
    for (const [type, fn] of LISTENERS) window.addEventListener(type, fn, OPTS);
  }
  refs++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    refs--;
    if (refs === 0) {
      for (const [type, fn] of LISTENERS) window.removeEventListener(type, fn, OPTS);
    }
  };
}

/** Whether attention listeners are installed (for tests and diagnostics). */
export function isAttentionInstalled(): boolean {
  return refs > 0;
}

/** True while the user is typing: an editable target got a key or input within 2.5 s. */
export function isTyping(at: number = now()): boolean {
  return at - lastTypingAt < TYPING_WINDOW_MS;
}

/** Milliseconds since the last pointer, key, input or scroll. Infinity before any. */
export function msSinceInput(at: number = now()): number {
  return at - lastInputAt;
}

/** Milliseconds since the last `input` event (any field). Infinity before any. */
export function msSinceEdit(at: number = now()): number {
  return at - lastEditAt;
}

/** Milliseconds since the last scroll. Infinity before any. */
export function msSinceScroll(at: number = now()): number {
  return at - lastScrollAt;
}

/** Test-only: forget every timestamp and drop the listeners. */
export function __resetAttentionForTests(): void {
  if (typeof window !== "undefined" && refs > 0) {
    for (const [type, fn] of LISTENERS) window.removeEventListener(type, fn, OPTS);
  }
  refs = 0;
  lastInputAt = Number.NEGATIVE_INFINITY;
  lastTypingAt = Number.NEGATIVE_INFINITY;
  lastEditAt = Number.NEGATIVE_INFINITY;
  lastScrollAt = Number.NEGATIVE_INFINITY;
}
