import { toPng } from "html-to-image";
import { saveAs } from "file-saver";

/**
 * Strip path separators, control characters, and leading dots so a download
 * name supplied by callers can't escape its directory or smuggle in shell
 * sequences. Browsers usually sanitise download names, but custom UAs and
 * automation tooling do not — defend in depth.
 */
function sanitizeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\/\\:*?"<>|\x00-\x1f\x7f]/g, "_");
  return cleaned.replace(/^\.+/, "").slice(0, 200) || "export";
}

// Cells starting with these characters are interpreted by Excel/Sheets as
// formulas — including =CMD, =HYPERLINK, =WEBSERVICE, and the leading-tab /
// leading-CR escapes that some imports flag-check. Prefix with `'` to defang.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

// Forward completed exports into the gamification engine. The engine's
// counter allowlist, xpForEvent, the `export-master` achievement, and the
// d-export daily challenge all key on these names, but no call site ever
// dispatched them — exports were invisible to gamification. Lazy import
// mirrors sonification/emit.ts's forwardToGamification: this module is
// imported by nearly every tool page, and a static import would drag the
// whole engine (plus its zustand store) into each of those chunks — and
// keeps the module graph acyclic.
let gamifyDispatch: ((name: string) => void) | null = null;
function trackExport(format: "png" | "csv" | "json") {
  if (typeof window === "undefined") return;
  void (async () => {
    try {
      if (!gamifyDispatch) {
        const mod = await import("@/lib/gamification/engine");
        gamifyDispatch = (name) => mod.dispatch({ name });
      }
      gamifyDispatch(`export-${format}`);
    } catch {
      /* engine not loadable — exports still work without gamification */
    }
  })();
}

export function exportToCSV(headers: string[], rows: (string | number)[][], filename: string) {
  // Excel opens UTF-8 files incorrectly without a BOM; emoji, accents, and
  // Arabic characters come out as mojibake.  The ﻿ BOM makes it render
  // correctly while staying valid CSV for every other consumer.
  const escapeCell = (cell: unknown): string => {
    // Treat null/undefined as empty — stringifying them writes the literal
    // "null" / "undefined" into the exported file, which then contaminates
    // downstream analysis tools.
    if (cell === null || cell === undefined) return "";
    let str = String(cell);
    // CSV formula-injection defence: any cell starting with a formula-trigger
    // character gets a leading single-quote so Excel/Sheets renders it as
    // literal text. Without this, a user-supplied story title like
    // `=cmd|'/C calc'!A0` becomes RCE when the CSV opens.
    if (FORMULA_PREFIX.test(str)) str = `'${str}`;
    return str.includes(",") ||
      str.includes('"') ||
      str.includes("\n") ||
      str.includes("\r") ||
      str.includes("\t")
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  };

  const csvContent =
    "﻿" +
    [headers.map(escapeCell).join(","), ...rows.map((row) => row.map(escapeCell).join(","))].join(
      "\r\n"
    );

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  saveAs(blob, `${sanitizeFilename(filename)}.csv`);
  trackExport("csv");
}

export function exportToJSON(data: unknown, filename: string) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  saveAs(blob, `${sanitizeFilename(filename)}.json`);
  trackExport("json");
}

function detectIsLightTheme(): boolean {
  // Prefer the explicit class set by the theme toggle / inline boot script.
  // Fall back to the OS preference when neither class is present, otherwise
  // dark-mode users on a fresh visit get a light-coloured PNG (or vice versa).
  if (typeof document === "undefined") return false;
  const root = document.documentElement;
  if (root.classList.contains("light")) return true;
  if (root.classList.contains("dark")) return false;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: light)").matches;
  }
  return false;
}

export async function exportToPNG(
  element: HTMLElement,
  filename: string,
  options: { pixelRatio?: number; timeoutMs?: number } = {}
): Promise<void> {
  const { pixelRatio = 2, timeoutMs = 15_000 } = options;
  // Defer one frame so any in-flight framer-motion animation on the chart
  // wrapper can settle before the snapshot — avoids capturing a half-faded
  // chart on the first export after navigation. If the tab is backgrounded
  // rAF never fires, so race against a fallback timer.
  await new Promise<void>((resolve) => {
    let done = false;
    const fallback = setTimeout(() => {
      if (!done) {
        done = true;
        resolve();
      }
    }, 250);
    requestAnimationFrame(() => {
      if (!done) {
        done = true;
        clearTimeout(fallback);
        resolve();
      }
    });
  });

  // Bound the whole capture in case toPng hangs (rare in webkit on huge
  // SVG trees); without this the caller's UI sits in "Exporting…" forever.
  const dataUrl = await Promise.race([
    toPng(element, {
      backgroundColor: detectIsLightTheme() ? "#f4f6fb" : "#0a0e1a",
      pixelRatio,
    }),
    new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error("PNG export timed out")), timeoutMs)
    ),
  ]);
  saveAs(dataUrl, `${sanitizeFilename(filename)}.png`);
  trackExport("png");
}

export async function copyToClipboard(text: string): Promise<boolean> {
  // Primary path: async Clipboard API. Requires secure context + activation;
  // legacy browsers + HTTP contexts fail here.
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the textarea trick
    }
  }
  // Fallback path: hidden textarea + execCommand. Deprecated but still the
  // only thing that works on Safari iOS over HTTP and in some embedded webviews.
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
