import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Walking Skeleton: goal (commit on blur), add a step to a layer, steps
 * grouped by layer, toggle done + progress, delete, persistence and the CSV
 * export.
 */

interface Exported {
  csvData?: { headers: string[]; rows: unknown[][] };
  jsonData?: unknown;
}
const h = vi.hoisted(() => ({ log: vi.fn(), exported: {} as Exported }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (props: Exported) => {
    h.exported.csvData = props.csvData;
    h.exported.jsonData = props.jsonData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: h.log }),
}));

import {
  WalkingSkeletonClient,
  useWalkingSkeletonStore,
} from "@/app/(tools)/walking-skeleton/walking-skeleton-client";

const KEY = "agile-toolkit:walking-skeleton";

type Step = ReturnType<typeof useWalkingSkeletonStore.getState>["steps"][number];
const step = (id: string, layer: Step["layer"], text: string, done = false): Step => ({
  id,
  layer,
  text,
  done,
});

const steps = () => useWalkingSkeletonStore.getState().steps;
const persisted = () =>
  (JSON.parse(localStorage.getItem(KEY) ?? "{}") as { state?: { goal: string; steps: Step[] } })
    .state;

const progress = () => screen.getByText(/steps complete/).textContent;

function addStep(text: string, layer?: Step["layer"]) {
  if (layer) {
    fireEvent.change(screen.getByLabelText("Architectural layer for this step"), {
      target: { value: layer },
    });
  }
  fireEvent.change(screen.getByLabelText("Step description"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /Add step/ }));
}

/** Layer headings of the steps grid, in display order. */
const layerHeadings = () =>
  Array.from(document.querySelectorAll("div.uppercase.font-bold")).map((d) => d.textContent);

beforeEach(() => {
  h.log.mockClear();
  h.exported.csvData = undefined;
  h.exported.jsonData = undefined;
  localStorage.clear();
  useWalkingSkeletonStore.setState({ goal: "", steps: [] });
});

describe("Walking Skeleton — empty state", () => {
  it("shows 0/0 progress and no steps section", () => {
    render(<WalkingSkeletonClient />);
    expect(progress()).toBe("0/0 steps complete (0%)");
    expect(screen.queryByText("Skeleton steps")).not.toBeInTheDocument();
  });

  it("ignores a blank step", () => {
    render(<WalkingSkeletonClient />);
    addStep("   ");
    expect(steps()).toEqual([]);
    expect(h.log).not.toHaveBeenCalled();
  });
});

describe("Walking Skeleton — goal", () => {
  it("commits the goal on blur and persists it", () => {
    render(<WalkingSkeletonClient />);
    const goal = screen.getByLabelText("Walking skeleton goal");
    fireEvent.change(goal, { target: { value: "Sign up → see dashboard" } });
    expect(useWalkingSkeletonStore.getState().goal).toBe("");
    fireEvent.blur(goal);
    expect(useWalkingSkeletonStore.getState().goal).toBe("Sign up → see dashboard");
    expect(persisted()?.goal).toBe("Sign up → see dashboard");
  });
});

describe("Walking Skeleton — steps", () => {
  it("adds a trimmed step to the chosen layer and clears the input", () => {
    render(<WalkingSkeletonClient />);
    addStep("  Login form  ");
    addStep("POST /session", "api");
    expect(steps()).toMatchObject([
      { layer: "ui", text: "Login form", done: false },
      { layer: "api", text: "POST /session", done: false },
    ]);
    expect(screen.getByLabelText("Step description")).toHaveValue("");
    // The chosen layer sticks for the next step.
    expect(screen.getByLabelText("Architectural layer for this step")).toHaveValue("api");
    expect(h.log).toHaveBeenNthCalledWith(1, "step_added", { layer: "ui" });
    expect(h.log).toHaveBeenNthCalledWith(2, "step_added", { layer: "api" });
    expect(progress()).toBe("0/2 steps complete (0%)");
  });

  it("groups steps by layer in ui → api → data → infra order and hides empty layers", () => {
    useWalkingSkeletonStore.setState({
      steps: [
        step("s1", "data", "users table"),
        step("s2", "ui", "login form"),
        step("s3", "data", "sessions table"),
      ],
    });
    render(<WalkingSkeletonClient />);
    expect(layerHeadings()).toEqual(["ui", "data"]);
    const dataBlock = screen.getByText("users table").closest("ul")!;
    expect(dataBlock).toContainElement(screen.getByText("sessions table"));
    expect(dataBlock).not.toContainElement(screen.getByText("login form"));
  });

  it("toggles a step done and back, updating progress", () => {
    useWalkingSkeletonStore.setState({
      steps: [step("s1", "ui", "login form"), step("s2", "api", "auth"), step("s3", "data", "db")],
    });
    render(<WalkingSkeletonClient />);
    const toggle = screen.getByRole("button", { name: "login form" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    expect(steps()[0].done).toBe(true);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(progress()).toBe("1/3 steps complete (33%)");
    expect(h.log).toHaveBeenCalledWith("step_toggled", { id: "s1" });

    fireEvent.click(toggle);
    expect(steps()[0].done).toBe(false);
    expect(progress()).toBe("0/3 steps complete (0%)");
  });

  it("reaches 100% when every step is done", () => {
    useWalkingSkeletonStore.setState({
      steps: [step("s1", "ui", "a", true), step("s2", "infra", "b")],
    });
    render(<WalkingSkeletonClient />);
    fireEvent.click(screen.getByRole("button", { name: "b" }));
    expect(progress()).toBe("2/2 steps complete (100%)");
  });

  // Bug: removing a step was the only change that never reached the history log.
  it("removes exactly the clicked step and logs it", () => {
    useWalkingSkeletonStore.setState({
      steps: [step("s1", "ui", "login form"), step("s2", "ui", "signup form")],
    });
    render(<WalkingSkeletonClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove step login form" }));
    expect(steps().map((s) => s.id)).toEqual(["s2"]);
    expect(h.log).toHaveBeenCalledWith("step_removed", { id: "s1" });
  });

  it("hides the steps section once the last step is removed", () => {
    useWalkingSkeletonStore.setState({ steps: [step("s1", "ui", "login form")] });
    render(<WalkingSkeletonClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove step login form" }));
    expect(screen.queryByText("Skeleton steps")).not.toBeInTheDocument();
    expect(progress()).toBe("0/0 steps complete (0%)");
  });
});

describe("Walking Skeleton — persistence", () => {
  it("writes steps to localStorage", () => {
    render(<WalkingSkeletonClient />);
    addStep("Login form");
    expect(persisted()?.steps).toMatchObject([{ layer: "ui", text: "Login form", done: false }]);
  });

  it("restores goal and steps from localStorage", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        state: { goal: "Ship the happy path", steps: [step("s1", "infra", "CI pipeline", true)] },
        version: 0,
      })
    );
    await act(async () => {
      await useWalkingSkeletonStore.persist.rehydrate();
    });
    render(<WalkingSkeletonClient />);
    expect(screen.getByLabelText("Walking skeleton goal")).toHaveValue("Ship the happy path");
    expect(screen.getByRole("button", { name: "CI pipeline" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(progress()).toBe("1/1 steps complete (100%)");
  });
});

describe("Walking Skeleton — export", () => {
  it("exports one CSV row per step", () => {
    useWalkingSkeletonStore.setState({
      steps: [step("s1", "ui", "login form", true), step("s2", "data", "users table")],
    });
    render(<WalkingSkeletonClient />);
    expect(h.exported.csvData?.headers).toEqual(["Layer", "Step", "Done"]);
    expect(h.exported.csvData?.rows).toEqual([
      ["ui", "login form", "yes"],
      ["data", "users table", "no"],
    ]);
    expect(h.exported.jsonData).toEqual(steps());
  });
});
