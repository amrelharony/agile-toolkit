import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ModelMigration } from "@/lib/stores/workspace-types";
import { MODEL_MIGRATION_ACTIONS } from "@/lib/history/event-actions";

/**
 * Model Upgrade Migration Tracker: the starter checklist shows before
 * anything is saved, the first edit persists it with the singleton id,
 * steps toggle / add / remove, the overview fields commit on blur, and the
 * progress line never shows NaN.
 */

interface CsvData {
  headers: string[];
  rows: (string | number)[][];
}
const exported = vi.hoisted(() => ({ csv: undefined as CsvData | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: CsvData }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));

import { ModelMigrationClient } from "@/app/(tools)/model-migration/model-migration-client";

const MIGRATION_ID = "modelMigration:current";

const migration = (over: Partial<ModelMigration> = {}): ModelMigration => ({
  id: MIGRATION_ID,
  fromModel: "",
  toModel: "",
  evalDeltaPct: "",
  costDeltaPct: "",
  steps: [],
  ...over,
});

const stored = () =>
  (useWorkspaceStore.getState().modelMigrations ?? []).find((m) => m.id === MIGRATION_ID);

const stepButtons = () =>
  screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-pressed"));

const progress = () => screen.getByText(/steps complete/).textContent;

const input = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;

beforeEach(() => {
  exported.csv = undefined;
  history.log.mockClear();
  useWorkspaceStore.setState({ modelMigrations: [] });
});

describe("Model migration: starter checklist", () => {
  it("shows the ten default steps without persisting anything", () => {
    render(<ModelMigrationClient />);
    expect(stepButtons()).toHaveLength(10);
    expect(stepButtons()[0]).toHaveTextContent("Run baseline eval suite on current model");
    expect(stepButtons()[9]).toHaveTextContent("Deprecate old model in registry");
    expect(progress()).toBe("0/10 steps complete (0%)");
    expect(useWorkspaceStore.getState().modelMigrations).toEqual([]);
    expect(exported.csv?.rows[0]).toEqual(["Run baseline eval suite on current model", "no"]);
  });

  it("persists the whole starter checklist on the first toggle", () => {
    render(<ModelMigrationClient />);
    fireEvent.click(stepButtons()[0]);

    const m = stored()!;
    expect(m.steps).toHaveLength(10);
    expect(m.steps[0]).toEqual({
      id: "default-step-0",
      text: "Run baseline eval suite on current model",
      done: true,
    });
    expect(m.steps.slice(1).every((s) => !s.done)).toBe(true);
    expect(stepButtons()[0]).toHaveAttribute("aria-pressed", "true");
    expect(progress()).toBe("1/10 steps complete (10%)");
    expect(history.log).toHaveBeenCalledWith(MODEL_MIGRATION_ACTIONS.STEP_TOGGLED, {
      id: "default-step-0",
    });

    fireEvent.click(stepButtons()[0]);
    expect(stored()!.steps[0].done).toBe(false);
    expect(progress()).toBe("0/10 steps complete (0%)");
  });
});

describe("Model migration: steps", () => {
  it("adds a trimmed step from the Add button and clears the field", () => {
    render(<ModelMigrationClient />);
    fireEvent.change(input("New step"), { target: { value: "  Shadow 5% traffic  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));

    const steps = stored()!.steps;
    expect(steps).toHaveLength(11);
    expect(steps[10]).toMatchObject({ text: "Shadow 5% traffic", done: false });
    expect(steps[10].id).not.toMatch(/^default-step-/);
    expect(input("New step").value).toBe("");
    expect(progress()).toBe("0/11 steps complete (0%)");
    expect(history.log).toHaveBeenCalledWith(MODEL_MIGRATION_ACTIONS.STEP_ADDED, {
      text: "Shadow 5% traffic",
    });
  });

  it("adds a step on Enter", () => {
    useWorkspaceStore.setState({ modelMigrations: [migration()] });
    render(<ModelMigrationClient />);
    fireEvent.change(input("New step"), { target: { value: "Pin model version" } });
    fireEvent.keyDown(input("New step"), { key: "Enter" });
    expect(stored()!.steps.map((s) => s.text)).toEqual(["Pin model version"]);
    expect(input("New step").value).toBe("");
  });

  it("ignores a blank or whitespace-only step", () => {
    render(<ModelMigrationClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    fireEvent.change(input("New step"), { target: { value: "   " } });
    fireEvent.keyDown(input("New step"), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    expect(useWorkspaceStore.getState().modelMigrations).toEqual([]);
    expect(history.log).not.toHaveBeenCalled();
  });

  it("removes only the chosen step", () => {
    useWorkspaceStore.setState({
      modelMigrations: [
        migration({
          steps: [
            { id: "a", text: "Alpha", done: true },
            { id: "b", text: "Beta", done: false },
            { id: "c", text: "Gamma", done: false },
          ],
        }),
      ],
    });
    render(<ModelMigrationClient />);
    expect(progress()).toBe("1/3 steps complete (33%)");
    fireEvent.click(screen.getByRole("button", { name: "Remove step Beta" }));
    expect(stored()!.steps.map((s) => s.id)).toEqual(["a", "c"]);
    expect(progress()).toBe("1/2 steps complete (50%)");
  });

  it("shows 0/0 (0%) rather than NaN once every step is removed", () => {
    useWorkspaceStore.setState({
      modelMigrations: [migration({ steps: [{ id: "a", text: "Alpha", done: true }] })],
    });
    render(<ModelMigrationClient />);
    expect(progress()).toBe("1/1 steps complete (100%)");
    fireEvent.click(screen.getByRole("button", { name: "Remove step Alpha" }));
    expect(stored()!.steps).toEqual([]);
    expect(progress()).toBe("0/0 steps complete (0%)");
    expect(stepButtons()).toHaveLength(0);
  });

  it("exports each step with a yes/no done column", () => {
    useWorkspaceStore.setState({
      modelMigrations: [
        migration({
          steps: [
            { id: "a", text: "Alpha", done: true },
            { id: "b", text: "Beta", done: false },
          ],
        }),
      ],
    });
    render(<ModelMigrationClient />);
    expect(exported.csv).toEqual({
      headers: ["Step", "Done"],
      rows: [
        ["Alpha", "yes"],
        ["Beta", "no"],
      ],
    });
  });
});

describe("Model migration: overview fields", () => {
  it("commits a field on blur, keeping the starter checklist", () => {
    render(<ModelMigrationClient />);
    fireEvent.change(input("From model"), { target: { value: "gpt-4o " } });
    // Draft only: nothing is written per keystroke.
    expect(useWorkspaceStore.getState().modelMigrations).toEqual([]);
    expect(input("From model").value).toBe("gpt-4o ");
    fireEvent.blur(input("From model"));

    const m = stored()!;
    expect(m.fromModel).toBe("gpt-4o ");
    expect(m.steps).toHaveLength(10);
  });

  it("commits on Enter and writes each field to its own key", () => {
    render(<ModelMigrationClient />);
    const set = (name: string, value: string) => {
      fireEvent.change(input(name), { target: { value } });
      fireEvent.blur(input(name));
    };
    set("To model", "claude-next");
    set("Eval delta %", "+2.1");
    set("Cost delta %", "-18");
    act(() => input("From model").focus());
    fireEvent.change(input("From model"), { target: { value: "gpt-4o" } });
    fireEvent.keyDown(input("From model"), { key: "Enter" });
    expect(input("From model")).not.toHaveFocus();
    expect(stored()).toMatchObject({
      fromModel: "gpt-4o",
      toModel: "claude-next",
      evalDeltaPct: "+2.1",
      costDeltaPct: "-18",
    });
  });

  it("lets a saved field be cleared", () => {
    useWorkspaceStore.setState({ modelMigrations: [migration({ toModel: "claude-next" })] });
    render(<ModelMigrationClient />);
    expect(input("To model").value).toBe("claude-next");
    fireEvent.change(input("To model"), { target: { value: "" } });
    fireEvent.blur(input("To model"));
    expect(stored()!.toModel).toBe("");
    expect(input("To model").value).toBe("");
  });

  it("re-syncs the fields when the migration changes elsewhere (agent write)", () => {
    render(<ModelMigrationClient />);
    act(() => {
      useWorkspaceStore.setState({
        modelMigrations: [migration({ fromModel: "gpt-4", evalDeltaPct: "+1.5" })],
      });
    });
    expect(input("From model").value).toBe("gpt-4");
    expect(input("Eval delta %").value).toBe("+1.5");
    expect(progress()).toBe("0/0 steps complete (0%)");
  });
});
