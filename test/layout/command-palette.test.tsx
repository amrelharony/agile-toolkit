import { describe, expect, it, vi, beforeAll } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/tools/tool-prefs", () => ({
  useToolPrefs: () => ({ favorites: [], recent: [] }),
}));

import { CommandPalette } from "@/components/layout/command-palette";

beforeAll(() => {
  // cmdk measures and scrolls items; jsdom implements neither.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

describe("CommandPalette", () => {
  it("has an accessible name", () => {
    render(<CommandPalette open onOpenChange={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Search tools" })).toBeInTheDocument();
  });

  it("does not list categories that have no visible tools", () => {
    render(<CommandPalette open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText("Experimentation & A/B")).toBeNull();
    expect(within(dialog).queryByText("Change Management")).toBeNull();
    expect(within(dialog).getByText("Ceremonies")).toBeInTheDocument();
  });

  it("ranks tools for task-style queries", () => {
    render(<CommandPalette open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "daily scrum" } });
    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options[0]).toMatch(/Standup/);
  });
});
