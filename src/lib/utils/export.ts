import { toPng } from "html-to-image";
import { saveAs } from "file-saver";

export function exportToCSV(
  headers: string[],
  rows: (string | number)[][],
  filename: string
) {
  // Excel opens UTF-8 files incorrectly without a BOM; emoji, accents, and
  // Arabic characters come out as mojibake.  The \uFEFF BOM makes it render
  // correctly while staying valid CSV for every other consumer.
  const escapeCell = (cell: unknown): string => {
    // Treat null/undefined as empty — stringifying them writes the literal
    // "null" / "undefined" into the exported file, which then contaminates
    // downstream analysis tools.
    if (cell === null || cell === undefined) return "";
    const str = String(cell);
    return str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  };

  const csvContent =
    "\uFEFF" +
    [
      headers.map(escapeCell).join(","),
      ...rows.map((row) => row.map(escapeCell).join(",")),
    ].join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  saveAs(blob, `${filename}.csv`);
}

export function exportToJSON(data: unknown, filename: string) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  saveAs(blob, `${filename}.json`);
}

function detectIsLightTheme(): boolean {
  // Prefer the explicit class set by the theme toggle / inline boot script.
  // Fall back to the OS preference when neither class is present, otherwise
  // dark-mode users on a fresh visit get a light-coloured PNG (or vice versa).
  if (typeof document === "undefined") return false;
  const root = document.documentElement;
  // HC mode is treated as dark (pure black) — without this it would slip
  // through to prefers-color-scheme and produce an incorrectly-lit PNG.
  if (root.classList.contains("hc")) return false;
  if (root.classList.contains("light")) return true;
  if (root.classList.contains("dark")) return false;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: light)").matches;
  }
  return false;
}

function detectPngBg(): string {
  // HC uses pure black so the exported PNG matches the on-screen contrast.
  if (typeof document !== "undefined" && document.documentElement.classList.contains("hc")) {
    return "#000000";
  }
  return detectIsLightTheme() ? "#f4f6fb" : "#0a0e1a";
}

export async function exportToPNG(
  element: HTMLElement,
  filename: string
): Promise<void> {
  // Defer one frame so any in-flight framer-motion animation on the chart
  // wrapper can settle before the snapshot — avoids capturing a half-faded
  // chart on the first export after navigation.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const dataUrl = await toPng(element, {
    backgroundColor: detectPngBg(),
    pixelRatio: 2,
  });
  saveAs(dataUrl, `${filename}.png`);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
