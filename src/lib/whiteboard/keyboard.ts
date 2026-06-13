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
 */

type Bindings = Record<string, (e: KeyboardEvent) => void>;

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

export function makeShortcutHandler(bindings: Bindings): (e: KeyboardEvent) => void {
  const normalized: Bindings = {};
  for (const [k, fn] of Object.entries(bindings)) normalized[normalize(k)] = fn;

  return (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || target.isContentEditable) return;
    }
    const mods: string[] = [];
    if (e.ctrlKey) mods.push("ctrl");
    if (e.shiftKey) mods.push("shift");
    if (e.altKey) mods.push("alt");
    if (e.metaKey) mods.push("meta");
    mods.sort();
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const combo = [...mods, key].join("+");
    const handler = normalized[combo];
    if (handler) {
      e.preventDefault();
      handler(e);
    }
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

export function defaultCanvasShortcuts(a: Partial<CanvasShortcutActions>): Bindings {
  const noop = () => undefined;
  const get = <K extends keyof CanvasShortcutActions>(k: K): CanvasShortcutActions[K] =>
    (a[k] ?? noop) as CanvasShortcutActions[K];
  return {
    v: () => get("setTool")("select"),
    n: () => get("setTool")("sticky"),
    k: () => get("setTool")("card"),
    r: () => get("setTool")("rect"),
    o: () => get("setTool")("ellipse"),
    l: () => get("setTool")("line"),
    a: () => get("setTool")("arrow"),
    t: () => get("setTool")("text"),
    p: () => get("setTool")("freehand"),
    c: () => get("setTool")("connector"),
    f: () => get("setTool")("frame"),
    Delete: () => get("deleteSelected")(),
    Backspace: () => get("deleteSelected")(),
    "Mod+a": () => get("selectAll")(),
    "Mod+c": () => get("copy")(),
    "Mod+x": () => get("cut")(),
    "Mod+v": () => get("paste")(),
    "Mod+d": () => get("duplicate")(),
    "Mod+z": () => get("undo")(),
    "Mod+Shift+z": () => get("redo")(),
    "Mod+g": () => get("groupSelection")(),
    "Mod+Shift+g": () => get("ungroupSelection")(),
    "Mod+]": () => get("bringForward")(),
    "Mod+[": () => get("sendBackward")(),
    "Mod+l": () => get("toggleLock")(),
    Escape: () => get("cancel")(),
    // Zoom-in chords vary by keyboard/layout: Ctrl/Cmd with "=" (no shift),
    // with the numpad "+" (→ "Mod++"), or with Shift+"=" which browsers report
    // as the "+" key (→ "Mod+Shift++"). Bind them all so zoom-in always works.
    "Mod+=": () => get("zoomIn")(),
    "Mod++": () => get("zoomIn")(),
    "Mod+Shift+=": () => get("zoomIn")(),
    "Mod+Shift++": () => get("zoomIn")(),
    "Mod+-": () => get("zoomOut")(),
    "Mod+0": () => get("resetZoom")(),
    "Mod+1": () => get("fitToContent")(),
  };
}
