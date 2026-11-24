/**
 * copyToClipboard (lib/utils/clipboard): the async Clipboard API first, then
 * a hidden textarea with execCommand for old Safari over HTTP and webviews.
 * It never throws, cleans up after itself, puts focus back on the control
 * that asked, and lives apart from export.ts so a Copy button doesn't load
 * html-to-image or file-saver. export.ts still re-exports the same function.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "@/lib/utils/clipboard";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const realClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const realExec = Object.getOwnPropertyDescriptor(document, "execCommand");

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", { value, configurable: true });
}
function setExec(fn: (cmd: string) => boolean) {
  Object.defineProperty(document, "execCommand", { value: vi.fn(fn), configurable: true });
  return document.execCommand as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  if (realClipboard) Object.defineProperty(navigator, "clipboard", realClipboard);
  else delete (navigator as { clipboard?: unknown }).clipboard;
  if (realExec) Object.defineProperty(document, "execCommand", realExec);
  else delete (document as { execCommand?: unknown }).execCommand;
  document.body.innerHTML = "";
});

describe("copyToClipboard", () => {
  it("writes through the Clipboard API when it works, with no textarea", async () => {
    const writeText = vi.fn(async () => {});
    setClipboard({ writeText });
    const exec = setExec(() => true);
    await expect(copyToClipboard("Hello, team")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("Hello, team");
    expect(exec).not.toHaveBeenCalled();
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls back to a hidden textarea when the API refuses", async () => {
    setClipboard({ writeText: vi.fn(async () => Promise.reject(new Error("denied"))) });
    let seen: HTMLTextAreaElement | null = null;
    const exec = setExec((cmd) => {
      seen = document.querySelector("textarea");
      return cmd === "copy";
    });
    await expect(copyToClipboard("line one\nline two")).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    // The field held the exact text, out of sight and out of the tab order.
    expect(seen).not.toBeNull();
    const ta = seen as unknown as HTMLTextAreaElement;
    expect(ta.value).toBe("line one\nline two");
    expect(ta.readOnly).toBe(true);
    expect(ta.getAttribute("aria-hidden")).toBe("true");
    expect(ta.tabIndex).toBe(-1);
    expect(ta.style.position).toBe("fixed");
    // And it's gone afterwards.
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls back when there is no Clipboard API at all", async () => {
    setClipboard(undefined);
    setExec(() => true);
    await expect(copyToClipboard("x")).resolves.toBe(true);
  });

  it("says false when both ways fail, and when the fallback throws", async () => {
    setClipboard(undefined);
    setExec(() => false);
    await expect(copyToClipboard("x")).resolves.toBe(false);
    expect(document.querySelector("textarea")).toBeNull();

    setExec(() => {
      throw new Error("not allowed");
    });
    await expect(copyToClipboard("x")).resolves.toBe(false);
    // Cleaned up even after a throw.
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("puts focus back on the button that asked", async () => {
    setClipboard(undefined);
    setExec(() => true);
    const button = document.createElement("button");
    button.textContent = "Copy reply";
    document.body.appendChild(button);
    button.focus();
    expect(document.activeElement).toBe(button);
    await copyToClipboard("Amr's answer");
    expect(document.activeElement).toBe(button);
  });

  it("is the same function export.ts hands out, and imports nothing", async () => {
    const fromExport = await import("@/lib/utils/export");
    expect(fromExport.copyToClipboard).toBe(copyToClipboard);
    const src = read("src/lib/utils/clipboard.ts");
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\bfrom\s+["']/);
  });

  it("is what the Copy button imports, not the export module", () => {
    const src = read("src/components/ui/copy-button.tsx");
    expect(src).toMatch(/from "@\/lib\/utils\/clipboard"/);
    expect(src).not.toMatch(/from "@\/lib\/utils\/export"/);
  });
});
