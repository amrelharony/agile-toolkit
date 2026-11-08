import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Passive attention timestamps. Listeners are capture + passive, ref-counted,
 * and only write times; readers ask "typing?" and "how long since input?".
 * `performance.now` is stubbed so time is explicit.
 */

import {
  TYPING_WINDOW_MS,
  __resetAttentionForTests,
  installAttention,
  isAttentionInstalled,
  isEditableTarget,
  isTyping,
  msSinceEdit,
  msSinceInput,
  msSinceScroll,
} from "@/lib/notify/attention";

let clock = 10_000;

beforeEach(() => {
  __resetAttentionForTests();
  clock = 10_000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterEach(() => {
  __resetAttentionForTests();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  document.body.appendChild(node);
  return node;
}

describe("isEditableTarget", () => {
  it.each([
    ["text input", () => el("input"), true],
    ["search input", () => el("input", { type: "search" }), true],
    ["textarea", () => el("textarea"), true],
    ["contenteditable", () => el("div", { contenteditable: "true" }), true],
    [
      "inside contenteditable",
      () => el("div", { contenteditable: "" }).appendChild(el("span")),
      true,
    ],
    ["checkbox", () => el("input", { type: "checkbox" }), false],
    ["button", () => el("button"), false],
    ["contenteditable=false", () => el("div", { contenteditable: "false" }), false],
  ] as const)("%s → %s", (_n, make, expected) => {
    expect(isEditableTarget(make())).toBe(expected);
  });

  it("tolerates window, document and null", () => {
    expect(isEditableTarget(window)).toBe(false);
    expect(isEditableTarget(document)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("before any input", () => {
  it("reports no typing and infinite gaps", () => {
    expect(isTyping()).toBe(false);
    expect(msSinceInput()).toBe(Infinity);
    expect(msSinceEdit()).toBe(Infinity);
    expect(msSinceScroll()).toBe(Infinity);
  });
});

describe("listeners", () => {
  it("are capture + passive", () => {
    const add = vi.spyOn(window, "addEventListener");
    const release = installAttention();
    const types = add.mock.calls.map((c) => c[0]);
    expect(types).toEqual(expect.arrayContaining(["pointerdown", "keydown", "input", "scroll"]));
    for (const call of add.mock.calls) {
      expect(call[2]).toMatchObject({ passive: true, capture: true });
    }
    release();
  });

  it("typing in a field counts for 2.5 s", () => {
    installAttention();
    const input = el("input");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(isTyping()).toBe(true);
    expect(msSinceInput()).toBe(0);
    clock += TYPING_WINDOW_MS - 1;
    expect(isTyping()).toBe(true);
    clock += 1;
    expect(isTyping()).toBe(false);
    expect(msSinceInput()).toBe(TYPING_WINDOW_MS);
  });

  it("a key outside a field is input but not typing", () => {
    installAttention();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(isTyping()).toBe(false);
    expect(msSinceInput()).toBe(0);
  });

  it("input events mark edit and typing; checkbox input marks edit only", () => {
    installAttention();
    el("input", { type: "checkbox" }).dispatchEvent(new Event("input", { bubbles: true }));
    expect(msSinceEdit()).toBe(0);
    expect(isTyping()).toBe(false);
    clock += 100;
    el("textarea").dispatchEvent(new Event("input", { bubbles: true }));
    expect(isTyping()).toBe(true);
  });

  it("pointer and scroll count as input; scroll has its own timestamp", () => {
    installAttention();
    window.dispatchEvent(new Event("pointerdown"));
    clock += 500;
    expect(msSinceInput()).toBe(500);
    expect(msSinceScroll()).toBe(Infinity);
    document.dispatchEvent(new Event("scroll"));
    expect(msSinceScroll()).toBe(0);
    expect(msSinceInput()).toBe(0);
  });

  it("are ref-counted: they stay until the last owner releases", () => {
    const a = installAttention();
    const b = installAttention();
    a();
    a(); // releasing twice is a no-op
    expect(isAttentionInstalled()).toBe(true);
    window.dispatchEvent(new Event("pointerdown"));
    expect(msSinceInput()).toBe(0);
    b();
    expect(isAttentionInstalled()).toBe(false);
    clock += 1000;
    window.dispatchEvent(new Event("pointerdown"));
    expect(msSinceInput()).toBe(1000);
  });
});
