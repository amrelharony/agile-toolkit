import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint } from "@/lib/stores/workspace-types";

/**
 * Release Planner: velocities can come from the completed shared sprints or
 * from the typed list, which stays as an override. Until the user picks, the
 * sprints are used once there are three with points and the list still holds
 * the starter numbers. The start date, until set, is the day after the
 * active sprint ends.
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
  DEFAULT_VELOCITY_INPUT,
  effectiveStartDate,
  isDefaultVelocityInput,
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
  it("uses the user's choice, else sprints once there are three and nothing typed", () => {
    const three = [20, 22, 18];
    expect(resolveVelocitySource({ velocityInput: DEFAULT_VELOCITY_INPUT }, three)).toBe("sprints");
    expect(resolveVelocitySource({ velocityInput: "" }, three)).toBe("sprints");
    // Typed numbers are an override.
    expect(resolveVelocitySource({ velocityInput: "10, 12, 9" }, three)).toBe("manual");
    // Too few sprints.
    expect(resolveVelocitySource({ velocityInput: DEFAULT_VELOCITY_INPUT }, [20, 22])).toBe(
      "manual"
    );
    // An explicit choice wins either way.
    expect(resolveVelocitySource({ velocityInput: "10, 12", velocitySource: "sprints" }, [])).toBe(
      "sprints"
    );
    expect(
      resolveVelocitySource(
        { velocityInput: DEFAULT_VELOCITY_INPUT, velocitySource: "manual" },
        three
      )
    ).toBe("manual");
    expect(isDefaultVelocityInput(" 18,22, 19, 25, 21, 17, 23,20 ")).toBe(true);
  });

  it("reads completed points of finished sprints, skipping sprints without any", () => {
    expect(
      sprintVelocities([
        done(1, 20, "2026-01-01"),
        done(2, undefined, "2026-02-01"),
        done(3, 0, "2026-03-01"),
        done(4, 24, "2026-04-01"),
      ])
    ).toEqual([20, 24]);
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

/** The stat card holding `label`: [label, value, subtitle]. */
function card(label: string) {
  const content = screen.getByText(label).parentElement!.parentElement!;
  const [, value, sub] = Array.from(content.children).map((el) => el.textContent ?? "");
  return { value, sub };
}

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
    // Oldest first: 20, 22, 18, 24 → 21 on average.
    expect(screen.getByText("20, 22, 18, 24")).toBeInTheDocument();
    expect(card("Avg Velocity")).toEqual({ value: "21 pts/sprint", sub: "4 data points" });
    expect(screen.queryByRole("textbox", { name: /Historical velocities/ })).toBeNull();

    // No start date set: the day after the active sprint ends.
    expect(screen.getByLabelText("Start Date")).toHaveValue("2026-10-26");
    expect(screen.getByText("The day after Sprint 9 ends.")).toBeInTheDocument();

    // A sprint finished elsewhere joins the sample.
    act(() => useWorkspaceStore.getState().upsertSprint(done(5, 30, "2026-10-01")));
    expect(card("Avg Velocity").value).toBe("22.8 pts/sprint");

    // The typed list is still there as an override, and the choice is saved.
    fireEvent.click(screen.getByRole("radio", { name: "Type them" }));
    expect(screen.getByRole("textbox", { name: /Historical velocities/ })).toHaveValue(
      DEFAULT_VELOCITY_INPUT
    );
    expect(card("Avg Velocity").value).toBe("20.6 pts/sprint");
    const saved = JSON.parse(localStorage.getItem("agile-toolkit:release-planner") ?? "{}");
    expect(saved.state.config.velocitySource).toBe("manual");

    // A date the user picks wins over the sprint's.
    fireEvent.change(screen.getByLabelText("Start Date"), { target: { value: "2027-01-04" } });
    expect(screen.getByLabelText("Start Date")).toHaveValue("2027-01-04");
    expect(screen.queryByText("The day after Sprint 9 ends.")).toBeNull();
  });
});
