import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { LsFavorite } from "@/lib/stores/workspace-types";

/**
 * Liberating Structures Picker: the 12-structure catalog, group-size and
 * timing filters, expanding a card, favoriting (heart and Save), the
 * favorites strip / count, and the favorites CSV export.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: string[][] } | undefined,
}));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: { headers: string[]; rows: string[][] } }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { LiberatingStructuresClient } from "@/app/(tools)/liberating-structures/liberating-structures-client";

const LS_ID = "liberatingStructures:current";

const ALL = [
  "1-2-4-All",
  "Impromptu Networking",
  "9 Whys",
  "Wise Crowds",
  "25/10 Crowd Sourcing",
  "Troika Consulting",
  "What I Need From You (WINFY)",
  "Discovery & Action Dialogue (DAD)",
  "Ecocycle Planning",
  "Conversation Café",
  "TRIZ",
  "Open Space Technology",
];

const fav = (id: string, structureId: string): LsFavorite => ({
  id,
  structureId,
  ts: "2026-10-01T09:00:00.000Z",
});
const seed = (favorites: LsFavorite[]) =>
  useWorkspaceStore.setState({ liberatingStructures: [{ id: LS_ID, favorites }] });
const favorites = () =>
  (useWorkspaceStore.getState().liberatingStructures ?? []).find((d) => d.id === LS_ID)
    ?.favorites ?? [];

const card = (label: string) => screen.getByText(label).parentElement!.parentElement!.textContent;
/** Names of the cards currently shown (their expand buttons). */
const shown = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("button[aria-expanded]")).map((b) => b.textContent);
const chip = (name: string, which = 0) => screen.getAllByRole("button", { name })[which];
const strip = () => screen.queryByText("Your favorites")?.parentElement?.nextElementSibling;

beforeEach(() => {
  exported.csv = undefined;
  useWorkspaceStore.setState({ liberatingStructures: [] });
});

describe("Liberating Structures: catalog and filters", () => {
  it("shows all 12 structures with no favorites", () => {
    const { container } = render(<LiberatingStructuresClient />);
    expect(shown(container)).toEqual(ALL);
    expect(card("Catalog")).toBe("Catalog12structures");
    expect(card("Favorites")).toBe("Favorites0");
    expect(card("Showing")).toBe("Showing12match filters");
    expect(screen.queryByText("Your favorites")).toBeNull();
  });

  it("filters by group size", () => {
    const { container } = render(<LiberatingStructuresClient />);
    fireEvent.click(chip("small (2-7)"));
    expect(shown(container)).toEqual(["9 Whys", "Wise Crowds", "Troika Consulting"]);
    expect(card("Showing")).toBe("Showing3match filters");

    fireEvent.click(chip("large (30+)"));
    expect(shown(container)).toEqual([
      "25/10 Crowd Sourcing",
      "Conversation Café",
      "Open Space Technology",
    ]);
  });

  it("filters by timing bucket (30 minutes counts as 15-30)", () => {
    const { container } = render(<LiberatingStructuresClient />);
    fireEvent.click(chip("under 15 min"));
    expect(shown(container)).toEqual(["1-2-4-All"]);

    fireEvent.click(chip("15-30 min"));
    expect(shown(container)).toEqual([
      "Impromptu Networking",
      "9 Whys",
      "Wise Crowds",
      "25/10 Crowd Sourcing",
      "Troika Consulting",
    ]);

    fireEvent.click(chip("30+ min"));
    expect(shown(container)).toHaveLength(6);
    expect(shown(container)).toContain("TRIZ");
    expect(shown(container)).not.toContain("Troika Consulting");
  });

  it("combines filters, shows a message when nothing matches, and All resets", () => {
    const { container } = render(<LiberatingStructuresClient />);
    fireEvent.click(chip("large (30+)"));
    fireEvent.click(chip("under 15 min"));
    expect(shown(container)).toEqual([]);
    expect(screen.getByText("No structures match your current filters.")).toBeInTheDocument();
    expect(card("Showing")).toBe("Showing0match filters");

    fireEvent.click(chip("All", 0)); // group size
    expect(shown(container)).toEqual(["1-2-4-All"]);
    fireEvent.click(chip("All", 1)); // timing
    expect(shown(container)).toEqual(ALL);
  });

  // Bug: the active filter chip was marked by colour only.
  it("exposes which filter chip is active", () => {
    render(<LiberatingStructuresClient />);
    expect(chip("All", 0)).toHaveAttribute("aria-pressed", "true");
    expect(chip("small (2-7)")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip("small (2-7)"));
    expect(chip("All", 0)).toHaveAttribute("aria-pressed", "false");
    expect(chip("small (2-7)")).toHaveAttribute("aria-pressed", "true");
    expect(chip("All", 1)).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Liberating Structures: expanding and favoriting", () => {
  it("toggles a favorite with the heart button", () => {
    render(<LiberatingStructuresClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add TRIZ to favorites" }));
    expect(favorites().map((f) => f.structureId)).toEqual(["ls-triz"]);
    expect(Number.isNaN(Date.parse(favorites()[0].ts))).toBe(false);

    const heart = screen.getByRole("button", { name: "Remove TRIZ from favorites" });
    expect(heart).toHaveAttribute("aria-pressed", "true");
    expect(card("Favorites")).toBe("Favorites1");
    expect(strip()).toHaveTextContent("TRIZ");

    fireEvent.click(heart);
    expect(favorites()).toEqual([]);
    expect(screen.getByRole("button", { name: "Add TRIZ to favorites" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.queryByText("Your favorites")).toBeNull();
  });

  it("does not expand the card when the heart is clicked", () => {
    render(<LiberatingStructuresClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add TRIZ to favorites" }));
    expect(screen.getByRole("button", { name: "TRIZ" })).toHaveAttribute("aria-expanded", "false");
  });

  it("expands one card at a time and saves from the details", () => {
    render(<LiberatingStructuresClient />);
    const triz = screen.getByRole("button", { name: "TRIZ" });
    fireEvent.click(triz);
    expect(triz).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText(/make a list of how to achieve the worst possible result/)
    ).toBeTruthy();
    expect(screen.getByText("Source: liberatingstructures.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(favorites().map((f) => f.structureId)).toEqual(["ls-triz"]);
    expect(screen.getByRole("button", { name: "Saved" })).toBeInTheDocument();
    expect(triz).toHaveAttribute("aria-expanded", "true");

    // Opening another card closes the first.
    fireEvent.click(screen.getByRole("button", { name: "9 Whys" }));
    expect(triz).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/worst possible result/)).toBeNull();

    // Clicking the open card's title closes it.
    fireEvent.click(screen.getByRole("button", { name: "9 Whys" }));
    expect(screen.queryByText("Source: liberatingstructures.com")).toBeNull();
  });

  it("lists favorites in the order they were added", () => {
    seed([fav("f1", "ls-triz"), fav("f2", "ls-1-2-4-all")]);
    render(<LiberatingStructuresClient />);
    expect(Array.from(strip()!.children).map((b) => b.textContent)).toEqual(["TRIZ", "1-2-4-All"]);
    expect(card("Favorites")).toBe("Favorites2");
  });

  // Bug: the Favorites KPI counted raw entries, so an unknown structure id
  // (e.g. written by an agent), a malformed entry or a duplicate showed
  // "Favorites 2-3" next to a strip with a single favorite.
  it("counts only the favorites it can show, once each", () => {
    seed([
      fav("f1", "ls-triz"),
      fav("f2", "1-2-4"),
      { id: "f3" } as LsFavorite,
      fav("f4", "ls-triz"),
    ]);
    render(<LiberatingStructuresClient />);
    expect(Array.from(strip()!.children).map((b) => b.textContent)).toEqual(["TRIZ"]);
    expect(card("Favorites")).toBe("Favorites1");
    expect(exported.csv?.rows.map((r) => r[0])).toEqual(["TRIZ"]);
  });

  it("unfavoriting removes every entry for that structure", () => {
    seed([fav("f1", "ls-triz"), fav("f2", "ls-9-whys"), fav("f3", "ls-triz")]);
    render(<LiberatingStructuresClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove TRIZ from favorites" }));
    expect(favorites().map((f) => f.id)).toEqual(["f2"]);
  });
});

describe("Liberating Structures: export", () => {
  it("exports the favorited structures' details", () => {
    seed([fav("f1", "ls-9-whys")]);
    render(<LiberatingStructuresClient />);
    expect(exported.csv?.headers).toEqual([
      "Name",
      "Purpose",
      "Timing",
      "Group Size",
      "Source",
      "Description",
    ]);
    expect(exported.csv?.rows).toEqual([
      [
        "9 Whys",
        "Make the purpose of work together clear",
        "20 min",
        "small (2-7)",
        "liberatingstructures.com",
        expect.stringContaining("Why is that important to you?"),
      ],
    ]);
  });

  it("exports nothing when there are no favorites", () => {
    render(<LiberatingStructuresClient />);
    expect(exported.csv?.rows).toEqual([]);
  });
});
