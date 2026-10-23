import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Walking Skeleton, Phase 2 of the tool upgrade: the path in order with a
 * layer per step, reordered with buttons, edited in place, added with
 * Enter (and a layer that must be picked), deleted with Undo; a layer
 * coverage check and verdict; steps not done go to the backlog as one
 * undoable batch; an example and a Markdown export.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { WalkingSkeletonClient } from "@/app/(tools)/walking-skeleton/walking-skeleton-client";
import {
  normalizeSkeleton,
  useWalkingSkeletonStore,
  type SkeletonStep,
} from "@/app/(tools)/walking-skeleton/store";
import {
  layerCoverage,
  moveStep,
  skeletonVerdict,
  stepsToSend,
} from "@/app/(tools)/walking-skeleton/skeleton";
import { EMPTY_STEP, validateStep } from "@/app/(tools)/walking-skeleton/step-form";
import { EXAMPLE_GOAL, buildExample } from "@/app/(tools)/walking-skeleton/example";
import { toMarkdown } from "@/app/(tools)/walking-skeleton/markdown";

const NOW = new Date(2026, 9, 23);
const step = (
  id: string,
  text: string,
  layer: SkeletonStep["layer"],
  done = false
): SkeletonStep => ({ id, text, layer, done });

const state = () => useWalkingSkeletonStore.getState();
const texts = () => state().steps.map((s) => s.text);
const renderSkeleton = () =>
  render(
    <TooltipProvider>
      <WalkingSkeletonClient />
    </TooltipProvider>
  );
const path = () => screen.getByRole("list", { name: "Skeleton path, in order" });
const undoLast = () => act(() => toastSpy.mock.calls.at(-1)![1].action.onClick());

beforeEach(() => {
  toastSpy.mockReset();
  useWorkspaceStore.setState({ stories: [] });
  useWalkingSkeletonStore.setState({ goal: "", steps: [] });
});

describe("Walking Skeleton adding", () => {
  it("adds a step with Enter only once its text and layer are set", () => {
    renderSkeleton();
    const text = screen.getByRole("textbox", { name: /^Step/ });
    fireEvent.change(text, { target: { value: "Checkout page" } });
    fireEvent.submit(text.closest("form")!);
    // No silent "UI": the layer has to be picked.
    expect(state().steps).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent("Pick the layer this step touches.");
    expect(screen.getByRole("radio", { name: "UI" })).toHaveFocus();

    fireEvent.click(screen.getByRole("radio", { name: "UI" }));
    fireEvent.submit(text.closest("form")!);
    expect(state().steps).toEqual([
      { id: expect.any(String), text: "Checkout page", layer: "ui", done: false },
    ]);
    // The form starts over, layer unset again.
    expect(text).toHaveValue("");
    expect(screen.getByRole("radio", { name: "UI" })).toHaveAttribute("aria-checked", "false");
  });

  it("rejects blank or overlong text and an unknown layer", () => {
    expect(validateStep(EMPTY_STEP)).toEqual({
      ok: false,
      errors: { text: "Describe the step.", layer: "Pick the layer this step touches." },
    });
    expect(validateStep({ text: "x".repeat(201), layer: "api" })).toMatchObject({ ok: false });
    expect(
      validateStep({ text: "x", layer: "cloud" as unknown as SkeletonStep["layer"] })
    ).toMatchObject({ ok: false, errors: { layer: expect.any(String) } });
    expect(validateStep({ text: "  Save the order ", layer: "data" })).toEqual({
      ok: true,
      values: { text: "Save the order", layer: "data" },
    });
  });
});

describe("Walking Skeleton path", () => {
  beforeEach(() => {
    useWalkingSkeletonStore.setState({
      goal: "Buy one item",
      steps: [
        step("a", "Checkout page", "ui", true),
        step("b", "POST /orders", "api", true),
        step("c", "Payment sandbox", "api"),
      ],
    });
  });

  it("lists steps in order, with each one's layer, not grouped by layer", () => {
    renderSkeleton();
    const items = within(path()).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringMatching(/^1.*Checkout page.*UI/),
      expect.stringMatching(/^2.*POST \/orders.*API/),
      expect.stringMatching(/^3.*Payment sandbox.*API/),
    ]);
    expect(
      screen.getByText("2 of 3 steps done; no step yet in the data or infra layers.")
    ).toBeTruthy();
    const coverage = screen.getByRole("list", { name: "Layer coverage" });
    expect(coverage).toHaveTextContent("UI: 1 step");
    expect(coverage).toHaveTextContent("API: 2 steps");
    expect(coverage).toHaveTextContent("Data: not touched yet");
    expect(coverage).toHaveTextContent("Infra: not touched yet");
  });

  it("reorders with the arrow buttons and keeps focus on the moved step", async () => {
    renderSkeleton();
    expect(screen.getByRole("button", { name: "Move Checkout page up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Payment sandbox down" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Move Payment sandbox up" }));
    expect(texts()).toEqual(["Checkout page", "Payment sandbox", "POST /orders"]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Move Payment sandbox up" })).toHaveFocus()
    );
    // At the top the up arrow is disabled, so focus moves to its down arrow.
    fireEvent.click(screen.getByRole("button", { name: "Move Payment sandbox up" }));
    expect(texts()).toEqual(["Payment sandbox", "Checkout page", "POST /orders"]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Move Payment sandbox down" })).toHaveFocus()
    );
  });

  it("edits a step in place; Escape cancels", () => {
    renderSkeleton();
    fireEvent.click(screen.getByRole("button", { name: "Edit Payment sandbox" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form")!;
    const text = within(editor).getByRole("textbox", { name: /^Step/ });
    expect(text).toHaveFocus();
    fireEvent.change(text, { target: { value: "Charge the card" } });
    fireEvent.keyDown(text, { key: "Escape" });
    expect(texts()[2]).toBe("Payment sandbox");

    fireEvent.click(screen.getByRole("button", { name: "Edit Payment sandbox" }));
    const again = screen.getByRole("button", { name: "Save" }).closest("form")!;
    fireEvent.change(within(again).getByRole("textbox", { name: /^Step/ }), {
      target: { value: "Charge the card" },
    });
    fireEvent.click(within(again).getByRole("radio", { name: "Infra" }));
    fireEvent.submit(again);
    expect(state().steps[2]).toMatchObject({ id: "c", text: "Charge the card", layer: "infra" });
    // Still third: editing never reorders the path.
    expect(within(path()).getAllByRole("listitem")[2]).toHaveTextContent("Charge the card");
  });

  it("toggles done and deletes with Undo back in place", () => {
    renderSkeleton();
    fireEvent.click(screen.getByRole("button", { name: "Done: Payment sandbox" }));
    expect(state().steps[2].done).toBe(true);
    expect(screen.getByText(/All 3 steps done/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete POST /orders" }));
    expect(texts()).toEqual(["Checkout page", "Payment sandbox"]);
    expect(toastSpy.mock.calls[0][0]).toBe("Deleted “POST /orders”");
    undoLast();
    expect(texts()).toEqual(["Checkout page", "POST /orders", "Payment sandbox"]);
  });

  it("clears everything behind a confirm, with Undo", () => {
    renderSkeleton();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Its goal and 3 steps are removed.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear skeleton" }));
    expect(state()).toMatchObject({ goal: "", steps: [] });
    undoLast();
    expect(state().goal).toBe("Buy one item");
    expect(texts()).toHaveLength(3);
  });
});

describe("Walking Skeleton: send steps to the backlog", () => {
  beforeEach(() => {
    useWalkingSkeletonStore.setState({
      goal: "",
      steps: [
        step("a", "Checkout page", "ui", true),
        step("b", "POST /orders", "api"),
        step("c", "orders table", "data"),
      ],
    });
  });

  it("sends the steps not done as one batch, and one Undo takes it back", () => {
    renderSkeleton();
    fireEvent.click(screen.getByRole("button", { name: "Send 2 steps to backlog" }));
    const stories = useWorkspaceStore.getState().stories;
    expect(stories.map((s) => [s.title, s.status, s.sourceRef])).toEqual([
      ["POST /orders", "backlog", { tool: "walking-skeleton", id: "b" }],
      ["orders table", "backlog", { tool: "walking-skeleton", id: "c" }],
    ]);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0][0]).toBe("Added 2 stories to the backlog");
    expect(state().steps[1].sentTo).toEqual([
      { route: "backlog-story", targetId: stories[0].id, at: expect.any(String) },
    ]);
    expect(screen.queryByRole("button", { name: /to backlog/ })).toBeNull();
    expect(screen.getAllByRole("link", { name: "In backlog" })).toHaveLength(2);

    undoLast();
    expect(useWorkspaceStore.getState().stories).toEqual([]);
    expect(state().steps.map((s) => s.sentTo ?? [])).toEqual([[], [], []]);
    expect(screen.getByRole("button", { name: "Send 2 steps to backlog" })).toBeTruthy();
  });

  it("offers a step again once its story is deleted from the backlog", () => {
    renderSkeleton();
    fireEvent.click(screen.getByRole("button", { name: "Send 2 steps to backlog" }));
    const first = useWorkspaceStore.getState().stories[0];
    act(() => useWorkspaceStore.getState().removeStory(first.id));
    expect(screen.getByRole("button", { name: "Send 1 step to backlog" })).toBeTruthy();
  });

  it("never sends done, blank or example steps", () => {
    expect(
      stepsToSend([
        step("a", "Done one", "ui", true),
        step("b", "  ", "api"),
        step("example-ws-9", "Example", "data"),
        step("d", "Mine", "infra"),
      ]).map((s) => s.id)
    ).toEqual(["d"]);
  });
});

describe("Walking Skeleton first run", () => {
  it("loads the example from the empty state and clears only example steps", () => {
    useWalkingSkeletonStore.setState({ goal: "", steps: [step("mine", "My step", "infra")] });
    const { unmount } = renderSkeleton();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    unmount();

    useWalkingSkeletonStore.setState({ goal: "", steps: [] });
    renderSkeleton();
    expect(screen.getByText(/No steps yet\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(state().goal).toBe(EXAMPLE_GOAL);
    expect(texts()).toHaveLength(5);
    expect(screen.getByText("Example data.")).toBeInTheDocument();
    expect(screen.getByText("3 of 5 steps done; no infra-layer step yet.")).toBeInTheDocument();
    // Example steps are never offered to the backlog.
    expect(screen.queryByRole("button", { name: /to backlog/ })).toBeNull();

    act(() => state().add("Deploy to staging", "infra"));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(texts()).toEqual(["Deploy to staging"]);
    expect(state().goal).toBe("");
  });

  it("keeps a goal the user typed when loading and clearing the example", () => {
    useWalkingSkeletonStore.setState({ goal: "My goal", steps: [] });
    renderSkeleton();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(state().goal).toBe("My goal");
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(state()).toMatchObject({ goal: "My goal", steps: [] });
  });

  it("draws layers with theme tokens, not hex", () => {
    useWalkingSkeletonStore.setState(buildExample());
    const { container } = renderSkeleton();
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{6}/i);
    expect(within(path()).getAllByText("UI")[0].className).toMatch(/text-accent/);
  });
});

describe("Walking Skeleton logic", () => {
  it("names the missing layers and the progress", () => {
    expect(skeletonVerdict([])).toBe("No steps yet.");
    expect(skeletonVerdict([step("a", "x", "ui", true)])).toBe(
      "The one step is done; no step yet in the API, data or infra layers."
    );
    const full = [
      step("a", "x", "ui", true),
      step("b", "x", "api", true),
      step("c", "x", "data"),
      step("d", "x", "infra"),
    ];
    expect(skeletonVerdict(full)).toBe("2 of 4 steps done; every layer has a step.");
    expect(skeletonVerdict(full.map((s) => ({ ...s, done: true })))).toBe(
      "All 4 steps done, through every layer: the skeleton walks end to end."
    );
    expect(skeletonVerdict(full.filter((s) => s.layer !== "data"))).toBe(
      "2 of 3 steps done; no data-layer step yet."
    );
  });

  it("counts layers and ignores unknown ones", () => {
    const c = layerCoverage([
      step("a", "x", "ui"),
      step("b", "x", "ui"),
      { ...step("c", "x", "ui"), layer: "cloud" as SkeletonStep["layer"] },
    ]);
    expect(c.counts).toEqual({ ui: 2, api: 0, data: 0, infra: 0 });
    expect(c.missing).toEqual(["api", "data", "infra"]);
  });

  it("moves a step one place, and not past either end", () => {
    const s = [step("a", "a", "ui"), step("b", "b", "api"), step("c", "c", "data")];
    expect(moveStep(s, "b", -1).map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(moveStep(s, "b", 1).map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(moveStep(s, "a", -1).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(moveStep(s, "c", 1).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(moveStep(s, "zzz", 1).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("loads older and hand-edited saves", () => {
    // The shape saved before this upgrade loads unchanged.
    expect(
      normalizeSkeleton({ goal: "g", steps: [{ id: "a", layer: "api", text: "t", done: true }] })
    ).toEqual({ goal: "g", steps: [{ id: "a", layer: "api", text: "t", done: true }] });
    expect(normalizeSkeleton(undefined)).toEqual({ goal: "", steps: [] });
    expect(normalizeSkeleton({ goal: 3, steps: "nope" })).toEqual({ goal: "", steps: [] });
    expect(normalizeSkeleton({ steps: [null, { layer: "cloud" }] })).toEqual({
      goal: "",
      steps: [{ id: "step-1", layer: "cloud", text: "", done: false }],
    });
  });

  it("exports the path in order with layers and what's missing", () => {
    const md = toMarkdown(buildExample(), NOW);
    expect(md).toContain("# Walking Skeleton — 23 Oct 2026");
    expect(md).toContain(`**Goal:** ${EXAMPLE_GOAL}`);
    expect(md).toContain("**3 of 5 steps done; no infra-layer step yet.**");
    expect(md).toContain("| 1 | Checkout page with one product and a Pay button | UI | ✓ |");
    expect(md).toContain(
      "| 4 | Charge the card through the payment provider's sandbox | API | — |"
    );
    expect(md).toContain("**Not touched yet:** Infra.");
    expect(toMarkdown({ goal: "", steps: [] }, NOW)).toBe(
      "# Walking Skeleton — 23 Oct 2026\n\n**Goal:** _not set_\n\nNo steps yet.\n"
    );
    expect(toMarkdown({ goal: "a | b", steps: [step("a", "x | y\nz", "ui")] }, NOW)).toContain(
      "| 1 | x \\| y z | UI | — |"
    );
  });
});
