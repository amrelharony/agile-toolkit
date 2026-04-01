import { toPng } from "html-to-image";
import { saveAs } from "file-saver";

export function exportToCSV(
  headers: string[],
  rows: (string | number)[][],
  filename: string
) {
  const csvContent = [
    headers.join(","),
    ...rows.map((row) =>
      row
        .map((cell) => {
          const str = String(cell);
          return str.includes(",") || str.includes('"') || str.includes("\n")
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        })
        .join(",")
    ),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  saveAs(blob, `${filename}.csv`);
}

export function exportToJSON(data: unknown, filename: string) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  saveAs(blob, `${filename}.json`);
}

export async function exportToPNG(
  element: HTMLElement,
  filename: string
): Promise<void> {
  // Detect current theme to use correct background
  const isLight = document.documentElement.classList.contains("light");
  const dataUrl = await toPng(element, {
    backgroundColor: isLight ? "#f4f6fb" : "#0a0e1a",
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
