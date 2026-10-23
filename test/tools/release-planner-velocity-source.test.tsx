import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint } from "@/lib/stores/workspace-types";

/**
 * Release Planner: velocities can come from the completed shared sprints or
 * from the typed list, which stays as an override. Until the user picks,
 * typed numbers are used when there are some and the sprints otherwise (the
 * old starter list counts as nothing typed). A sprint that finished with 0
 * points counts. The start date, until set, is the day after the active
 * sprint ends.
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
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

import { ReleasePlannerClient } from "@/app/(tools)/release-planner/release-planner-client";
import {
  LEGACY_STARTER_VELOCITIES,
  effectiveStartDate,
  isStarterVelocityInput,
  resolveVelocitySource,
  sprintVelocities,
} from "@/app/(tools)/release-planner/velocity-source";

const done = (n: number, points: number | undefined, start: string): Sprint => ({
  id: `s${n}`,
  name: `Sprint ${n}`,
  startDate: start,
  endDate: start.replace(/-01$/, "-14"),
  pointsPlanned: 25,
  pointsCompleted: points,
  status: "completed",
});
const ACTIVE: Sprint = {
  id: "s9",
  name: "Sprint 9",
  startDate: "2026-10-12",
  endDate: "2026-10-25",
  pointsPlanned: 30,
  status: "active",
};

describe("velocity source rules", () => {
  it("uses the user's choice, else typed numbers, else the sprints", () => {
    expect(resolveVelocitySource({ velocityInput: LEGACY_STARTER_VELOCITIES })).toBe("sprints");
    expect(resolveVelocitySource({ velocityInput: "" })).toBe("sprints");
    // Typed numbers are an override.
    expect(resolveVelocitySource({ velocityInput: "10, 12, 9" })).toBe("manual");
    // An explicit choice wins either way.
    expect(resolveVelocitySource({ velocityInput: "10, 12", velocitySource: "sprints" })).toBe(
      "sprints"
    );
    expect(resolveVelocitySource({ velocityInput: "", velocitySource: "manual" })).toBe("manual");
    expect(isStarterVelocityInput(" 18,22, 19, 25, 21, 17, 23,20 ")).toBe(true);
  });

  it("reads completed points of finished sprints, keeping a 0 and skipping sprints without any", () => {
    expect(
      sprintVelocities([
        done(1, 20, "2026-01-01"),
        done(2, undefined, "2026-02-01"),
        done(3, 0, "2026-03-01"),
        done(4, 24, "2026-04-01"),
      ])
    ).toEqual([20, 0, 24]);
  });

  it("starts the day after the active sprint ends unless a date is set", () => {
    expect(effectiveStartDate("", ACTIVE, "2026-10-19")).toEqual({
      date: "2026-10-26",
      from: "sprint",
    });
    expect(effectiveStartDate("2027-01-04", ACTIVE, "2026-10-19")).toEqual({
      date: "2027-01-04",
      from: "user",
    });
    expect(effectiveStartDate("", undefined, "2026-10-19")).toEqual({
      date: "2026-10-19",
      from: "today",
    });
    // Placeholder dates can't place the next sprint.
    expect(
      effectiveStartDate("", { ...ACTIVE, startDate: "2020-01-03", endDate: "" }, "2026-10-19")
    ).toEqual({ date: "2026-10-19", from: "today" });
  });
});

describe("Release Planner with shared sprints", () => {
  afterAll(() => {
    useWorkspaceStore.setState({ sprints: [] });
  });

  it("reads completed sprints by default, and the typed list once chosen", () => {
    useWorkspaceStore.setState({
      sprints: [
        ACTIVE,
        done(3, 18, "2026-09-01"),
        done(1, 20, "2026-07-01"),
        done(2, 22, "2026-08-01"),
        done(4, 24, "2026-09-15"),
      ],
    });
    render(<ReleasePlannerClient />);

    const fromSprints = screen.getByRole("radio", { name: "From completed sprints" });
    expect(fromSprints).toHaveAttribute("aria-checked", "true");
    // Oldest first by end date: 20, 22, 18, 24; the headline is the shared
    // velocity over the last three (22, 18, 24).
    expect(screen.getByText("20, 22, 18, 24")).toBeInTheDocument();
    expect(
      screen.getByText("21.3 points per sprint, the average of the last 3 sprints.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Points completed per sprint/ })).toBeNull();

    // No start date set: the day after the active sprint ends.
    expect(screen.getByLabelText("Start")).toHaveValue("2026-10-26");
    expect(screen.getByText("The day after Sprint 9 ends.")).toBeInTheDocument();

    // A sprint finished elsewhere joins the sample.
    act(() => useWorkspaceStore.getState().upsertSprint(done(5, 30, "2026-10-01")));
    expect(
      screen.getByText("24 points per sprint, the average of the last 3 sprints.")
    ).toBeInTheDocument();

    // The typed list is still there as an override (empty: no starter
    // numbers), and the choice is saved.
    fireEvent.click(screen.getByRole("radio", { name: "Type them" }));
    expect(screen.getByRole("textbox", { name: /Points completed per sprint/ })).toHaveValue("");
    const saved = JSON.parse(localStorage.getItem("agile-toolkit:release-planner") ?? "{}");
    expect(saved.state.config.velocitySource).toBe("manual");

    // A date the user picks wins over the sprint's.
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2027-01-04" } });
    expect(screen.getByLabelText("Start")).toHaveValue("2027-01-04");
    expect(screen.queryByText("The day after Sprint 9 ends.")).toBeNull();
  });
});
