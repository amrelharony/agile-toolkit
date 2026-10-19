import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { StoryMap } from "@/lib/stores/workspace-types";

/**
 * Story Mapper: the default map is the example (its ids start with
 * `example-`), "Clear example" removes only example rows, "Load an example"
 * shows on a map with no stories, and the map exports as Markdown.
 */

vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
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

import { StoryMapperClient } from "@/app/(tools)/story-mapper/story-mapper-client";
import { buildExampleSlices, buildExampleSteps } from "@/app/(tools)/story-mapper/example";
import { toMarkdown } from "@/app/(tools)/story-mapper/markdown";

const SM_ID = "story-mapper:current";
const NOW = new Date(2026, 9, 18);
const card = (id: string, title: string) => ({ id, title, description: "", color: "#00f0ff" });

const map = () => useWorkspaceStore.getState().storyMaps?.find((m) => m.id === SM_ID);
const setMap = (m: Omit<StoryMap, "id">) =>
  useWorkspaceStore.setState({ storyMaps: [{ id: SM_ID, ...m }] });
// dnd-kit's live region is a role="status" too, so find the notice by its text.
const notice = () => screen.queryByText("Example data.");
const cardTitles = () =>
  (map()?.slices ?? []).flatMap((sl) =>
    Object.values(sl.cards)
      .flat()
      .map((c) => c.title)
  );

beforeEach(() => {
  useWorkspaceStore.setState({ storyMaps: [] });
});

describe("Story Mapper Markdown", () => {
  it("renders the map table and each slice's stories", () => {
    const steps = buildExampleSteps();
    const md = toMarkdown({ steps, slices: buildExampleSlices(steps) }, NOW);
    expect(md).toMatch(/^# User Story Map — 18 Oct 2026\n/);
    expect(md).toContain("**Journey:** Discover → Learn → Use");
    expect(md).toContain("3 steps · 2 slices · 7 stories");
    expect(md).toContain("| Slice | Discover | Learn | Use |");
    expect(md).toContain(
      "| **Walking Skeleton** | Browse product catalog | Read product details | Buy a single item |"
    );
    expect(md).toContain(
      "| **MVP** | Search by keyword | See ratings and reviews | Add to cart<br>Pay with a saved card |"
    );
    expect(md).toContain("## 2. MVP (4 stories)");
    expect(md).toContain("- **Use:** Add to cart — Users can add items to a shopping cart.");
  });

  it("escapes pipes and collapses newlines in table cells", () => {
    const md = toMarkdown(
      {
        steps: [{ id: "s1", name: "Sign up | Log in" }],
        slices: [{ id: "a", name: "Release\n1", cards: { s1: [card("c1", "Email | phone")] } }],
      },
      NOW
    );
    expect(md).toContain("| Slice | Sign up \\| Log in |");
    expect(md).toContain("| **Release 1** | Email \\| phone |");
  });

  it("says there is nothing yet on a map with no stories", () => {
    expect(
      toMarkdown(
        {
          steps: [{ id: "s1", name: "Use" }],
          slices: [{ id: "a", name: "MVP", cards: { s1: [] } }],
        },
        NOW
      )
    ).toBe("# User Story Map — 18 Oct 2026\n\nNo stories on the map yet.\n");
  });
});

describe("Story Mapper example", () => {
  it("opens on the example map, with the notice", () => {
    render(<StoryMapperClient />);
    expect(notice()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    expect(buildExampleSteps().every((s) => s.id.startsWith("example-"))).toBe(true);
  });

  it("loads the example next to the user's empty steps and clears only example rows", () => {
    setMap({
      steps: [{ id: "s1", name: "Checkout" }],
      slices: [{ id: "a", name: "Release 1", cards: { s1: [] } }],
    });
    render(<StoryMapperClient />);
    expect(notice()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(map()?.steps.map((s) => s.name)).toEqual(["Discover", "Learn", "Use", "Checkout"]);
    expect(map()?.slices.map((s) => s.name)).toEqual(["Walking Skeleton", "MVP", "Release 1"]);
    expect(screen.getByRole("button", { name: "Edit Browse product catalog" })).toBeInTheDocument();
    expect(notice()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();

    // The user adds a story of their own to an example step and slice.
    const cur = map()!;
    act(() =>
      setMap({
        steps: cur.steps,
        slices: cur.slices.map((sl) =>
          sl.name === "Walking Skeleton"
            ? {
                ...sl,
                cards: {
                  ...sl.cards,
                  "example-step-discover": [
                    ...sl.cards["example-step-discover"],
                    card("mine", "Landing page"),
                  ],
                },
              }
            : sl
        ),
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(cardTitles()).toEqual(["Landing page"]);
    // The step and slice holding the user's card stay; the rest of the example goes.
    expect(map()?.steps.map((s) => s.name)).toEqual(["Discover", "Checkout"]);
    expect(map()?.slices.map((s) => s.name)).toEqual(["Walking Skeleton", "Release 1"]);
    expect(notice()).toBeNull();
  });

  it("clears the default map to an empty one that offers the example again", () => {
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(map()?.steps).toEqual([]);
    expect(map()?.slices).toEqual([]);
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
  });

  it("doesn't offer the example once the map has the user's stories", () => {
    setMap({
      steps: [{ id: "s1", name: "Checkout" }],
      slices: [{ id: "a", name: "Release 1", cards: { s1: [card("c1", "Pay by card")] } }],
    });
    render(<StoryMapperClient />);
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    expect(notice()).toBeNull();
  });
});
