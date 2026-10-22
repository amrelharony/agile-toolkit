import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ESTIMATION_GUIDE_ACTIONS } from "@/lib/history/event-actions";

/**
 * Estimation Guide gap-filling: the entry helpers' edge cases, share links
 * (copy, open, hostile payloads), Reset to Defaults and the exports. (Per-
 * scale keys and the legacy migration are covered by
 * estimation-guide-fixes.test.tsx.)
 */

const spies = vi.hoisted(() => ({
  log: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  exported: {} as {
    clipboardText?: string;
    jsonData?: {
      scale: string;
      values: { value: string | number; description: string; example: string }[];
    };
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (props: typeof spies.exported) => {
    spies.exported = props;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: spies.log }),
}));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), { success: spies.success, error: spies.error }),
}));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { EstimationGuideClient } from "@/app/(tools)/estimation-guide/estimation-guide-client";
import {
  defaultDescription,
  entriesForScale,
  entryKey,
  migrateDescriptions,
  migrateExamples,
  readEntry,
  sameEntries,
} from "@/app/(tools)/estimation-guide/entries";
import { initialState, useEstimationGuideStore } from "@/app/(tools)/estimation-guide/store";
import { defaultDescriptions, scales } from "@/lib/constants/scales";

const PATH = "/estimation-guide";
const st = () => useEstimationGuideStore.getState();

/** Encode a payload the way a share link does (UTF-8 → base64). */
function encode(payload: unknown): string {
  const utf8 = encodeURIComponent(JSON.stringify(payload)).replace(/%([0-9A-F]{2})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16))
  );
  return btoa(utf8);
}

function chooseScale(name: string) {
  const trigger = screen.getByRole("combobox", { name: "Estimation scale" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name }));
}

const descriptionBoxes = () => screen.getAllByLabelText("Description") as HTMLTextAreaElement[];
const exampleBoxes = () => screen.getAllByLabelText("Example") as HTMLTextAreaElement[];

beforeEach(() => {
  spies.log.mockClear();
  spies.success.mockClear();
  spies.error.mockClear();
  spies.exported = {};
  localStorage.clear();
  window.history.replaceState({}, "", PATH);
  useEstimationGuideStore.setState({ ...initialState });
});
afterEach(() => {
  window.history.replaceState({}, "", PATH);
});

describe("estimation guide entry helpers", () => {
  it("keys entries per scale and has no default for an unknown value", () => {
    expect(entryKey("T-Shirt", "XL")).toBe("T-Shirt:XL");
    expect(entryKey("Fibonacci", 13)).toBe("Fibonacci:13");
    expect(defaultDescription(13)).toBe(defaultDescriptions["13"]);
    expect(defaultDescription("?")).toBe("");
  });

  it("reads the per-scale entry, then a bare one, then the fallback", () => {
    expect(readEntry({ "Linear:3": "own", "3": "bare" }, "Linear", 3, "fb")).toBe("own");
    expect(readEntry({ "3": "bare" }, "Linear", 3, "fb")).toBe("bare");
    expect(readEntry({}, "Linear", 3, "fb")).toBe("fb");
    expect(readEntry({}, "Linear", 3)).toBe("");
  });

  it("treats anything but a plain object as no saved entries", () => {
    const defaults = migrateDescriptions({});
    for (const junk of [null, undefined, "8", 42, ["a"]]) {
      expect(migrateDescriptions(junk)).toEqual(defaults);
      expect(migrateExamples(junk)).toEqual({});
    }
  });

  it("drops non-string values and keeps keys that match no scale value", () => {
    expect(migrateExamples({ "8": 8, note: "kept", "Linear:2": "per scale", XS: null })).toEqual({
      note: "kept",
      "Linear:2": "per scale",
    });
  });

  it("compares entry maps by keys and values", () => {
    expect(sameEntries({ a: "1" }, { a: "1" })).toBe(true);
    expect(sameEntries({ a: "1" }, { a: "2" })).toBe(false);
    expect(sameEntries({ a: "1" }, { a: "1", b: "2" })).toBe(false);
    expect(sameEntries({}, {})).toBe(true);
  });

  it("lists a scale's entries by bare value, with or without defaults", () => {
    const tshirt = scales.find((s) => s.name === "T-Shirt")!;
    const map = { "T-Shirt:XS": "Typo", "Fibonacci:1": "other scale" };
    const plain = entriesForScale(map, tshirt, false);
    expect(Object.keys(plain)).toEqual(tshirt.values.map(String));
    expect(plain.XS).toBe("Typo");
    expect(plain.M).toBe("");
    expect(entriesForScale(map, tshirt, true).M).toBe(defaultDescriptions.M);
  });
});

describe("Estimation Guide share links", () => {
  // Bug: links went out as `?state=<base64>` unescaped, and URLSearchParams
  // reads every "+" in the base64 as a space, so opening a shared link
  // silently loaded nothing for almost any real guide.
  it("opens a link made with Share, with every edit and the scale intact", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    useEstimationGuideStore.setState({
      selectedScale: "Linear",
      descriptions: {
        ...initialState.descriptions,
        "Linear:3": "Ünïcödé — a day's work 🚀, more than a 3 >>> ~~~",
      },
      examples: { "Linear:3": "Checkout rewrite" },
    });
    const first = render(<EstimationGuideClient />);
    await waitFor(() =>
      expect(descriptionBoxes()[2]).toHaveValue("Ünïcödé — a day's work 🚀, more than a 3 >>> ~~~")
    );
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() =>
      expect(spies.success).toHaveBeenCalledWith("Share link copied to clipboard")
    );
    const link = new URL(writeText.mock.calls[0][0]);
    expect(link.pathname).toBe(PATH);
    // The case that broke: base64 with a "+" in it (">>>" guarantees one).
    expect(link.search).toContain("+");
    first.unmount();

    // Someone else opens the link.
    localStorage.clear();
    useEstimationGuideStore.setState({ ...initialState });
    window.history.replaceState({}, "", `${link.pathname}${link.search}`);
    render(<EstimationGuideClient />);
    await waitFor(() =>
      expect(spies.success).toHaveBeenCalledWith("Loaded shared estimation guide")
    );
    expect(st().selectedScale).toBe("Linear");
    expect(st().descriptions["Linear:3"]).toBe("Ünïcödé — a day's work 🚀, more than a 3 >>> ~~~");
    expect(st().examples["Linear:3"]).toBe("Checkout rewrite");
    expect(window.location.search).toBe("");
    expect(descriptionBoxes()[2]).toHaveValue("Ünïcödé — a day's work 🚀, more than a 3 >>> ~~~");
    expect(exampleBoxes()[2]).toHaveValue("Checkout rewrite");
  });

  it("migrates bare-value entries in an old link", async () => {
    window.history.replaceState(
      {},
      "",
      `${PATH}?state=${encodeURIComponent(
        encode({
          selectedScale: "Powers of 2",
          descriptions: { "8": "Old 8" },
          examples: { "8": "Ex" },
        })
      )}`
    );
    render(<EstimationGuideClient />);
    await waitFor(() =>
      expect(spies.success).toHaveBeenCalledWith("Loaded shared estimation guide")
    );
    expect(st().descriptions["Powers of 2:8"]).toBe("Old 8");
    expect(st().descriptions["Fibonacci:8"]).toBe("Old 8");
    expect(st().examples["Linear:8"]).toBe("Ex");
    expect(st().descriptions["8"]).toBeUndefined();
  });

  it("ignores a link that isn't base64 or is oversized, and leaves the guide alone", async () => {
    useEstimationGuideStore.setState({ examples: { "Fibonacci:1": "Mine" } });
    for (const bad of ["@@not-base64@@", "A".repeat(100_001)]) {
      window.history.replaceState({}, "", `${PATH}?state=${bad}`);
      const view = render(<EstimationGuideClient />);
      await waitFor(() => expect(exampleBoxes()[0]).toHaveValue("Mine"));
      await act(async () => {});
      view.unmount();
    }
    expect(spies.success).not.toHaveBeenCalled();
    expect(st().selectedScale).toBe("Fibonacci");
  });

  it("can't pollute Object.prototype through a crafted link", async () => {
    const json =
      '{"selectedScale":"Linear","descriptions":{"__proto__":{"polluted":"yes"},"Linear:3":"ok"},"constructor":{"prototype":{"polluted":"yes"}}}';
    const utf8 = encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
    window.history.replaceState({}, "", `${PATH}?state=${encodeURIComponent(btoa(utf8))}`);
    render(<EstimationGuideClient />);
    await waitFor(() =>
      expect(spies.success).toHaveBeenCalledWith("Loaded shared estimation guide")
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(st().descriptions, "__proto__")).toBe(false);
    expect(st().descriptions["Linear:3"]).toBe("ok");
    expect(st().selectedScale).toBe("Linear");
  });
});

describe("Estimation Guide reset and exports", () => {
  it("resets entries to the defaults but keeps the chosen scale", async () => {
    render(<EstimationGuideClient />);
    chooseScale("T-Shirt");
    expect(spies.log).toHaveBeenCalledWith(ESTIMATION_GUIDE_ACTIONS.SCALE_CHANGED, {
      scale: "T-Shirt",
    });
    await waitFor(() => expect(descriptionBoxes()).toHaveLength(6));
    fireEvent.change(descriptionBoxes()[0], { target: { value: "" } });
    fireEvent.change(exampleBoxes()[0], { target: { value: "Fix a typo" } });
    // A cleared description stays empty rather than snapping back to the default.
    expect(descriptionBoxes()[0]).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Reset to Defaults" }));
    expect(st().selectedScale).toBe("T-Shirt");
    expect(st().examples).toEqual({});
    expect(descriptionBoxes()[0]).toHaveValue(defaultDescriptions.XS);
    expect(exampleBoxes()[0]).toHaveValue("");
    expect(spies.success).toHaveBeenCalledWith("Reset to defaults");
    expect(spies.log).toHaveBeenCalledWith(ESTIMATION_GUIDE_ACTIONS.GUIDE_RESET, {});
  });

  it("exports the active scale as text and JSON, examples only where set", async () => {
    useEstimationGuideStore.setState({ examples: { "Fibonacci:8": "Checkout rewrite" } });
    render(<EstimationGuideClient />);
    await waitFor(() => expect(spies.exported.jsonData?.values).toHaveLength(7));
    const text = spies.exported.clipboardText!;
    expect(text.split("\n")[0]).toBe("Estimation Reference Guide - Fibonacci Scale");
    expect(text).toContain(
      `[8]\nDescription: ${defaultDescriptions["8"]}\nExample: Checkout rewrite\n`
    );
    expect(text).toContain(`[13]\nDescription: ${defaultDescriptions["13"]}\n\n`);
    expect(text.match(/Example:/g)).toHaveLength(1);
    expect(spies.exported.jsonData?.scale).toBe("Fibonacci");
    expect(spies.exported.jsonData?.values[4]).toEqual({
      value: 8,
      description: defaultDescriptions["8"],
      example: "Checkout rewrite",
    });
  });
});
