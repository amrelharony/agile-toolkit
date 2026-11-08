import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OPEN_DIALOG_SELECTORS, isDialogOpen } from "@/lib/notify/dialog-open";

/**
 * What counts as an open modal for the toast policy, and the CSS rule that
 * raises the toaster over it: both must see the same dialogs.
 */

function add(attrs: Record<string, string>, parent: HTMLElement = document.body): HTMLElement {
  const el = document.createElement("div");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isDialogOpen", () => {
  it("is false with nothing open", () => {
    expect(isDialogOpen()).toBe(false);
  });

  it("sees a Radix dialog or alert dialog", () => {
    add({ role: "dialog", "data-state": "open" });
    expect(isDialogOpen()).toBe(true);
    document.body.innerHTML = "";
    add({ role: "alertdialog", "data-state": "open" });
    expect(isDialogOpen()).toBe(true);
  });

  it("ignores a closed Radix dialog", () => {
    add({ role: "dialog", "data-state": "closed" });
    expect(isDialogOpen()).toBe(false);
  });

  it("sees a hand-built aria-modal dialog with no data-state (share, import, card detail)", () => {
    add({ role: "dialog", "aria-modal": "true" });
    expect(isDialogOpen()).toBe(true);
  });

  it("ignores a non-modal dialog (Amr's assistant panel)", () => {
    add({ role: "dialog", "aria-modal": "false" });
    expect(isDialogOpen()).toBe(false);
  });

  it("ignores an open popover inside the Radix popper wrapper", () => {
    const wrapper = add({ "data-radix-popper-content-wrapper": "" });
    add({ role: "dialog", "data-state": "open" }, wrapper);
    expect(isDialogOpen()).toBe(false);
    add({ role: "dialog", "data-state": "open" });
    expect(isDialogOpen()).toBe(true);
  });

  it("sees a native <dialog open>", () => {
    const d = document.createElement("dialog");
    d.setAttribute("open", "");
    document.body.appendChild(d);
    expect(isDialogOpen()).toBe(true);
  });
});

describe("globals.css lifts the toaster over the same dialogs", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

  it.each(OPEN_DIALOG_SELECTORS)("has a body:has(%s) rule", (selector) => {
    expect(css).toContain(`body:has(${selector}`);
  });

  it("lifts above the z-[9999] card-detail modal", () => {
    const rule = css.slice(css.indexOf("body:has(["));
    const z = Number(/z-index:\s*(\d+)/.exec(rule)?.[1]);
    expect(z).toBeGreaterThan(9999);
  });
});
