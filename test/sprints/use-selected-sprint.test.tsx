import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint } from "@/lib/stores/workspace-types";
import {
  SELECTED_SPRINT_KEY,
  pickDefaultSprint,
  resetSelectedSprint,
  sprintHref,
  useSelectedSprint,
} from "@/lib/sprints/use-selected-sprint";
import { NewSprintDialog } from "@/components/sprints/new-sprint-dialog";
import { nextSprintName, sprintLabel } from "@/components/sprints/sprint-picker";

const sprint = (id: string, startDate: string, status: Sprint["status"]): Sprint => ({
  id,
  name: `Sprint ${id}`,
  startDate,
  endDate: startDate.replace(/-(\d{2})$/, (_m, d) => `-${String(Number(d) + 10).padStart(2, "0")}`),
  pointsPlanned: 30,
  status,
});
const S1 = sprint("1", "2026-09-07", "completed");
const S2 = sprint("2", "2026-09-21", "active");
const S3 = sprint("3", "2026-10-05", "planned");

beforeEach(() => {
  resetSelectedSprint();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/burndown");
  useWorkspaceStore.setState({ sprints: [S1, S2, S3], sprintSeries: [] });
});
afterEach(() => {
  useWorkspaceStore.setState({ sprints: [], sprintSeries: [] });
});

describe("picking the default sprint", () => {
  it("prefers the choice, then the active sprint, then the newest", () => {
    expect(pickDefaultSprint([S1, S2, S3], "1")?.id).toBe("1");
    expect(pickDefaultSprint([S1, S2, S3], "gone")?.id).toBe("2");
    expect(pickDefaultSprint([S1, S3], null)?.id).toBe("3");
    expect(pickDefaultSprint([], null)).toBeUndefined();
  });

  it("builds links that open a sprint", () => {
    expect(sprintHref("/burndown", "sprint_a b")).toBe("/burndown?sprint=sprint_a%20b");
    expect(sprintHref("/burndown", undefined)).toBe("/burndown");
  });
});

describe("useSelectedSprint", () => {
  it("opens on a ?sprint= link and remembers it", () => {
    window.history.replaceState(null, "", "/burndown?sprint=1");
    const { result } = renderHook(() => useSelectedSprint());
    expect(result.current.selected?.id).toBe("1");
    expect(window.localStorage.getItem(SELECTED_SPRINT_KEY)).toBe("1");
    expect(result.current.sprints.map((s) => s.id)).toEqual(["3", "2", "1"]);
  });

  it("shares a choice between tools and keeps the link in step", () => {
    window.history.replaceState(null, "", "/burndown?sprint=1");
    const a = renderHook(() => useSelectedSprint());
    const b = renderHook(() => useSelectedSprint());
    act(() => a.result.current.select("3"));
    expect(b.result.current.selected?.id).toBe("3");
    expect(window.location.search).toBe("?sprint=3");
  });

  it("falls back to the remembered choice, then the active sprint", () => {
    const first = renderHook(() => useSelectedSprint());
    expect(first.result.current.selected?.id).toBe("2");
    first.unmount();

    window.localStorage.setItem(SELECTED_SPRINT_KEY, "1");
    resetSelectedSprint();
    const second = renderHook(() => useSelectedSprint());
    expect(second.result.current.selected?.id).toBe("1");
  });
});

describe("sprint picker pieces", () => {
  it("labels sprints and suggests the next name", () => {
    expect(sprintLabel(S2)).toMatch(/^Sprint 2 · .+ – .+ · Active$/);
    expect(sprintLabel({ ...S2, startDate: "2020-01-02", endDate: "" })).toBe("Sprint 2 · Active");
    expect(nextSprintName([S1, S2, { ...S3, name: "Hardening" }])).toBe("Sprint 3");
  });

  it("creates a sprint from the dialog, with errors for missing fields", () => {
    let created: Sprint | null = null;
    render(
      <NewSprintDialog
        open
        onOpenChange={() => {}}
        onCreated={(s) => (created = s)}
        defaultName=""
        defaultStart="2026-10-19"
        defaultLengthDays={14}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Create sprint" }));
    expect(screen.getByText("Give the sprint a name.")).toBeInTheDocument();
    expect(created).toBeNull();

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Sprint 4" } });
    fireEvent.change(screen.getByLabelText(/Planned points/), { target: { value: "32" } });
    expect(screen.getByLabelText(/Last day/)).toHaveValue("2026-11-02");
    fireEvent.click(screen.getByRole("button", { name: "Create sprint" }));
    expect(created).toMatchObject({
      name: "Sprint 4",
      startDate: "2026-10-19",
      endDate: "2026-11-02",
      pointsPlanned: 32,
    });
    expect(useWorkspaceStore.getState().sprints.some((s) => s.name === "Sprint 4")).toBe(true);
  });
});
