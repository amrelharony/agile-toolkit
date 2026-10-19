/**
 * Keyboard shortcut matcher for the canvas tool.
 *
 * Usage:
 *   const handler = makeShortcutHandler({
 *     "v": () => setTool("select"),
 *     "n": () => setTool("sticky"),
 *     "Delete": () => deleteSelected(),
 *     "Mod+z": () => undo(),
 *     "Mod+Shift+z": () => redo(),
 *     ...
 *   });
 *   window.addEventListener("keydown", handler);
 *
 * `Mod` matches Cmd on macOS and Ctrl elsewhere.
 *
 * The handler ignores keystrokes that originate inside an editable
 * element (input / textarea / contenteditable) so the user can still
 * type into a sticky's text editor without triggering canvas actions.
 *
 * Pass `{ scope }` to confine character-key shortcuts (no Ctrl / Cmd /
 * Alt — tool letters, Delete) to focus inside that element (WCAG 2.1.4).
 * Escape and modifier chords stay window-wide, except the chords listed
 * in `scopedChords` (the board's zoom keys), which also need focus on the
 * board so they don't take over the browser's own page zoom elsewhere.
 */

type Bindings = Record<string, (e: KeyboardEvent) => void>;

export interface ShortcutHandlerOptions {
  /** Element that must contain the event target for an unmodified key to
   *  fire — the board viewport. Read at keydown time so a ref works. */
  scope?: () => Element | null;
  /** Modifier chords (binding syntax, e.g. "Mod+=") that are scoped like
   *  single keys. Outside the scope they're left to the browser. */
  scopedChords?: readonly string[];
}

/** True for text-entry targets (input / textarea / contenteditable) —
 *  every canvas shortcut stands down while the user is typing. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

/** True when `target` sits inside `scope` (e.g. the board viewport). */
export function isInsideScope(
  target: EventTarget | null,
  scope: Element | null | undefined
): boolean {
  return !!scope && target instanceof Node && scope.contains(target);
}

// Controls that act on Space / Enter themselves, and controls that use
// the arrow keys. A canvas shortcut that reuses one of those keys must
// stand down when focus is on such a control, or the control can't be
// operated from the keyboard (WCAG 2.1.1) — e.g. a window-level
// Space-to-pan that calls preventDefault() stops buttons activating.
const ACTIVATION_CONTROLS = [
  "button",
  "a[href]",
  "summary",
  "select",
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="treeitem"]',
].join(",");
const ARROW_CONTROLS = [
  "select",
  '[role="slider"]',
  '[role="radio"]',
  '[role="radiogroup"]',
  '[role="tab"]',
  '[role="tablist"]',
  '[role="option"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="combobox"]',
  '[role="spinbutton"]',
  '[role="scrollbar"]',
  '[role="tree"]',
  '[role="treeitem"]',
  '[role="grid"]',
].join(",");

/**
 * True when the focused control handles `key` natively — Space / Enter
 * on buttons, links and other activatable widgets; arrow keys on
 * selects, sliders, radio groups, tabs, menus and listboxes; anything
 * in a text field.
 */
export function controlOwnsKey(target: EventTarget | null, key: string): boolean {
  if (isTextEntryTarget(target)) return true;
  if (!(target instanceof Element)) return false;
  if (key === " " || key === "Enter") return target.closest(ACTIVATION_CONTROLS) !== null;
  if (key.startsWith("Arrow")) return target.closest(ARROW_CONTROLS) !== null;
  return false;
}

/** Marks the board viewport so toolbar buttons can hand focus back to it. */
export const CANVAS_BOARD_ATTR = "data-canvas-board";

/**
 * `onMouseDown` for plain board-toolbar buttons (tool palette, view
 * toggles, zoom). A mouse click would otherwise move focus onto the
 * button, and because the single-key shortcuts only fire with focus on
 * the board (WCAG 2.1.4), N / Delete / zoom would go dead until the next
 * click on the board. Focus stays on the board instead (or moves there,
 * blurring an open inline editor so it commits as a click-away would).
 * Keyboard users still Tab to the button and press it as usual. Not for
 * buttons that open menus, popovers or dialogs — those need focus.
 */
export function keepBoardFocus(e: { preventDefault(): void }): void {
  e.preventDefault();
  const board = document.querySelector<HTMLElement>(`[${CANVAS_BOARD_ATTR}]`);
  const active = document.activeElement;
  if (board && (!board.contains(active) || isTextEntryTarget(active))) {
    board.focus({ preventScroll: true });
  }
}

// Detect macOS / iOS for the Mod-key mapping. Prefer the modern
// userAgentData.platform when present; fall back to navigator.platform
// (deprecated but still implemented in every shipping browser).
const isMac = (() => {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /^(macOS|Mac|iPod|iPhone|iPad)/i.test(platform);
})();

function normalize(combo: string): string {
  // A literal "+" key collides with the "+" separator (e.g. the zoom-in chord
  // "Mod++"). Strip a trailing "+" key before splitting and restore it after,
  // otherwise `split("+")` swallows it and the binding can never match.
  let work = combo;
  let literalPlus = false;
  if (work.endsWith("+")) {
    literalPlus = true;
    work = work.slice(0, -1);
  }
  const parts = work.split("+").map((s) => s.trim());
  const mods: string[] = [];
  let key = "";
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "mod") mods.push(isMac ? "meta" : "ctrl");
    else if (lower === "ctrl" || lower === "control") mods.push("ctrl");
    else if (lower === "shift") mods.push("shift");
    else if (lower === "alt" || lower === "option") mods.push("alt");
    else if (lower === "meta" || lower === "cmd") mods.push("meta");
    else if (part) key = part.length === 1 ? part.toLowerCase() : part;
  }
  if (literalPlus) key = "+";
  mods.sort();
  return [...mods, key].join("+");
}

export function makeShortcutHandler(
  bindings: Bindings,
  options: ShortcutHandlerOptions = {}
): (e: KeyboardEvent) => void {
  const normalized: Bindings = {};
  for (const [k, fn] of Object.entries(bindings)) normalized[normalize(k)] = fn;
  const scopedChords = new Set((options.scopedChords ?? []).map(normalize));

  return (e: KeyboardEvent) => {
    if (isTextEntryTarget(e.target)) return;
    const mods: string[] = [];
    if (e.ctrlKey) mods.push("ctrl");
    if (e.shiftKey) mods.push("shift");
    if (e.altKey) mods.push("alt");
    if (e.metaKey) mods.push("meta");
    mods.sort();
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const combo = [...mods, key].join("+");
    const handler = normalized[combo];
    if (!handler) return;
    // WCAG 2.1.4: an unmodified key (tool letter, Delete) only acts while
    // focus is on the board, so typing or dictating elsewhere on the page
    // can't switch tools or delete the selection. Escape stays global so
    // an in-flight gesture can always be cancelled.
    const unmodified = !e.ctrlKey && !e.metaKey && !e.altKey;
    const needsScope = (unmodified && e.key !== "Escape") || scopedChords.has(combo);
    if (options.scope && needsScope && !isInsideScope(e.target, options.scope())) return;
    e.preventDefault();
    handler(e);
  };
}

/** Default canvas keymap — convenient for callers, but each tool can extend. */
export interface CanvasShortcutActions {
  setTool: (tool: string) => void;
  deleteSelected: () => void;
  selectAll: () => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  duplicate: () => void;
  undo: () => void;
  redo: () => void;
  groupSelection: () => void;
  ungroupSelection: () => void;
  bringForward: () => void;
  sendBackward: () => void;
  toggleLock: () => void;
  cancel: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  fitToContent: () => void;
}

/**
 * The board's zoom chords. Pass them as `scopedChords` so they zoom the
 * board only while it has focus and stay the browser's page zoom (which
 * low-vision users rely on, WCAG 1.4.4) everywhere else.
 */
export const CANVAS_ZOOM_CHORDS: readonly string[] = [
  "Mod+=",
  "Mod++",
  "Mod+Shift+=",
  "Mod+Shift++",
  "Mod+-",
  "Mod+0",
  "Mod+1",
];

export function defaultCanvasShortcuts(a: Partial<CanvasShortcutActions>): Bindings {
  const { setTool } = a;
  const tool = (t: string) => (setTool ? () => setTool(t) : undefined);
  const run = (k: Exclude<keyof CanvasShortcutActions, "setTool">) => a[k];
  const all: Record<string, (() => void) | undefined> = {
    v: tool("select"),
    h: tool("hand"),
    n: tool("sticky"),
    k: tool("card"),
    r: tool("rect"),
    o: tool("ellipse"),
    l: tool("line"),
    a: tool("arrow"),
    t: tool("text"),
    p: tool("freehand"),
    c: tool("connector"),
    f: tool("frame"),
    Delete: run("deleteSelected"),
    Backspace: run("deleteSelected"),
    "Mod+a": run("selectAll"),
    "Mod+c": run("copy"),
    "Mod+x": run("cut"),
    "Mod+v": run("paste"),
    "Mod+d": run("duplicate"),
    "Mod+z": run("undo"),
    "Mod+Shift+z": run("redo"),
    "Mod+g": run("groupSelection"),
    "Mod+Shift+g": run("ungroupSelection"),
    "Mod+]": run("bringForward"),
    "Mod+[": run("sendBackward"),
    "Mod+l": run("toggleLock"),
    Escape: run("cancel"),
    // Zoom-in chords vary by keyboard/layout: Ctrl/Cmd with "=" (no shift),
    // with the numpad "+" (→ "Mod++"), or with Shift+"=" which browsers report
    // as the "+" key (→ "Mod+Shift++"). Bind them all so zoom-in always works.
    "Mod+=": run("zoomIn"),
    "Mod++": run("zoomIn"),
    "Mod+Shift+=": run("zoomIn"),
    "Mod+Shift++": run("zoomIn"),
    "Mod+-": run("zoomOut"),
    "Mod+0": run("resetZoom"),
    "Mod+1": run("fitToContent"),
  };
  // An action the caller didn't supply stays unbound rather than bound to
  // a no-op: the handler preventDefault()s every bound key, so a no-op
  // silently swallowed the browser's own shortcut (page zoom on Ctrl/Cmd
  // + = / - / 0, tab switch on Ctrl/Cmd+1).
  const bindings: Bindings = {};
  for (const [combo, fn] of Object.entries(all)) {
    if (fn) bindings[combo] = () => fn();
  }
  return bindings;
}
