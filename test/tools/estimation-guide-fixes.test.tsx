import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Estimation Guide:
 *   - Descriptions and examples are keyed per scale ("Fibonacci:8"), so
 *     editing 8 under Fibonacci no longer changes 8 under Powers of 2 and
 *     Linear. Saved data keyed by bare value ("8") is copied onto every scale
 *     with that value, so nothing is lost.
 *   - Every value on every scale has a default description (4, 16 and 32 on
 *     Powers of 2, and 4, 6, 7, 9 and 10 on Linear had none).
 */

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { EstimationGuideClient } from "@/app/(tools)/estimation-guide/estimation-guide-client";
import {
  defaultScaleDescriptions,
  migrateDescriptions,
  migrateExamples,
  readEntry,
} from "@/app/(tools)/estimation-guide/entries";
import { scales, defaultDescriptions } from "@/lib/constants/scales";

const KEY = "agile-toolkit:estimation-guide";
const OUR_8 = "Our 8: a whole checkout flow";

/** What a user saved before per-scale keys: bare values, shared by every scale. */
function seedLegacy() {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      state: {
        selectedScale: "Fibonacci",
        descriptions: { ...defaultDescriptions, "8": OUR_8 },
        examples: { "8": "Checkout rewrite", XS: "Fix a typo" },
      },
      version: 0,
    })
  );
}
const saved = () =>
  JSON.parse(localStorage.getItem(KEY) ?? "{}").state as {
    descriptions: Record<string, string>;
    examples: Record<string, string>;
  };
const descriptionBoxes = () => screen.getAllByLabelText("Description") as HTMLTextAreaElement[];
const exampleBoxes = () => screen.getAllByLabelText("Example") as HTMLTextAreaElement[];

function chooseScale(name: string) {
  const trigger = screen.getByRole("combobox", { name: "Estimation scale" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name }));
}

describe("Estimation Guide entry keys", () => {
  it("copies bare-value entries onto every scale with that value", () => {
    const descriptions = migrateDescriptions({ "8": OUR_8, "Linear:8": "Linear's own 8" });
    expect(descriptions["Fibonacci:8"]).toBe(OUR_8);
    expect(descriptions["Powers of 2:8"]).toBe(OUR_8);
    // An entry that was already per scale wins.
    expect(descriptions["Linear:8"]).toBe("Linear's own 8");
    expect(descriptions["8"]).toBeUndefined();
    // Values with no saved entry get the default.
    expect(descriptions["Fibonacci:13"]).toBe(defaultDescriptions["13"]);

    expect(migrateExamples({ XS: "Fix a typo" })).toEqual({ "T-Shirt:XS": "Fix a typo" });
  });

  it("reads a bare entry that arrives later, and keeps a cleared entry empty", () => {
    expect(readEntry({ "8": "late" }, "Linear", 8)).toBe("late");
    expect(readEntry({ "Linear:8": "", "8": "late" }, "Linear", 8)).toBe("");
  });

  it("has a default description for every value on every scale", () => {
    const defaults = defaultScaleDescriptions();
    for (const scale of scales) {
      for (const v of scale.values) {
        expect(defaults[`${scale.name}:${v}`], `${scale.name} ${v}`).toBeTruthy();
      }
    }
  });
});

describe("Estimation Guide per-scale editing", () => {
  beforeEach(seedLegacy);

  it("keeps saved entries, and an edit on one scale leaves the others alone", async () => {
    render(<EstimationGuideClient />);
    // Fibonacci: 1 2 3 5 8 …, so 8 is the fifth card.
    await waitFor(() => expect(descriptionBoxes()[4]).toHaveValue(OUR_8));
    expect(exampleBoxes()[4]).toHaveValue("Checkout rewrite");
    // Migrated in storage: every scale with an 8 has the saved text.
    expect(saved().descriptions["Powers of 2:8"]).toBe(OUR_8);
    expect(saved().descriptions["Linear:8"]).toBe(OUR_8);
    expect(saved().examples["T-Shirt:XS"]).toBe("Fix a typo");
    expect(saved().descriptions["8"]).toBeUndefined();

    fireEvent.change(descriptionBoxes()[4], { target: { value: "Fibonacci's 8" } });
    fireEvent.change(exampleBoxes()[4], { target: { value: "Fibonacci example" } });
    expect(saved().descriptions["Fibonacci:8"]).toBe("Fibonacci's 8");
    expect(saved().descriptions["Powers of 2:8"]).toBe(OUR_8);

    // Powers of 2: 1 2 4 8 16 32.
    chooseScale("Powers of 2");
    await waitFor(() => expect(descriptionBoxes()).toHaveLength(6));
    expect(descriptionBoxes()[3]).toHaveValue(OUR_8);
    expect(exampleBoxes()[3]).toHaveValue("Checkout rewrite");
    // 4, 16 and 32 have defaults now.
    expect(descriptionBoxes()[2]).toHaveValue(defaultDescriptions["4"]);
    expect(descriptionBoxes()[4]).toHaveValue(defaultDescriptions["16"]);
    expect(descriptionBoxes()[5]).toHaveValue(defaultDescriptions["32"]);
    for (const box of descriptionBoxes()) expect(box.value).not.toBe("");
  });
});
