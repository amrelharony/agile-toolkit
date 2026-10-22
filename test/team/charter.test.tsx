import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useRefinementStore } from "@/app/(tools)/refinement/store";
import { useEstimationGuideStore } from "@/app/(tools)/estimation-guide/store";
import { DOD_STORAGE_KEY } from "@/app/(tools)/dod-builder/summary";

/**
 * Team charter: each standing agreement as a card that reads the tool's
 * own data, the ceremony times editable in place, and the export.
 */

vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
const cadence = vi.hoisted(() => ({ patches: [] as unknown[] }));
vi.mock("@/lib/sprints/use-ceremony-cadence", async () => {
  const { DEFAULT_CADENCE } = await import("@/lib/sprints/cadence");
  return {
    useCeremonyCadence: () => [DEFAULT_CADENCE, (patch: unknown) => cadence.patches.push(patch)],
  };
});

import { TeamCharter } from "@/app/(meta)/team/charter";

beforeEach(() => {
  cadence.patches.length = 0;
  window.localStorage.clear();
  useWorkspaceStore.setState({
    teamMembers: [{ id: "m1", name: "Ann", role: "Dev" }],
    workingAgreements: [
      {
        id: "workingAgreement:current",
        rules: [
          { id: "r1", category: "communication", text: "Core hours 10–15", agreedBy: ["Ann"] },
        ],
        meta: { version: 1 },
      },
    ],
  });
  useRefinementStore.setState({
    criteria: [
      { id: "c1", label: "Acceptance criteria defined" },
      { id: "c2", label: "Estimated by team" },
      { id: "c3", label: "Fits in a sprint" },
    ],
    history: [],
  });
  useEstimationGuideStore.setState({
    selectedScale: "Fibonacci",
    descriptions: { "Fibonacci:1": "Our tiniest change" },
    examples: {},
  });
  window.localStorage.setItem(
    DOD_STORAGE_KEY,
    JSON.stringify({
      items: [{ id: "d1", label: "Code reviewed", category: "code", required: true }],
      history: [],
    })
  );
});

afterEach(() => {
  useWorkspaceStore.setState({ teamMembers: [], workingAgreements: [] });
});

describe("TeamCharter", () => {
  it("shows one card per agreement, read from each tool's data", async () => {
    render(<TeamCharter />);
    const list = screen.getByRole("list", { name: "Charter documents" });
    const card = (id: string) => list.querySelector(`[data-charter="${id}"]`) as HTMLElement;

    expect(card("agreement")).toHaveTextContent("1 rule · 1 agreed by name");
    expect(within(card("agreement")).getByRole("link", { name: /Open/ })).toHaveAttribute(
      "href",
      "/working-agreement"
    );
    expect(card("dor")).toHaveTextContent("3 checks");
    expect(card("estimation")).toHaveTextContent(/Fibonacci · 1 of \d+ values in the team's words/);
    // The DoD blob is read from storage after mount.
    expect(await within(card("dod")).findByText("1 criterion · 1 required")).toBeInTheDocument();
  });

  it("offers to write an agreement that doesn't exist yet", () => {
    useWorkspaceStore.setState({ workingAgreements: [] });
    render(<TeamCharter />);
    const card = screen
      .getByRole("list", { name: "Charter documents" })
      .querySelector('[data-charter="agreement"]') as HTMLElement;
    expect(card).toHaveTextContent("No rules agreed yet");
    expect(within(card).getByRole("link", { name: /Write it/ })).toBeInTheDocument();
  });

  it("edits the ceremony times in place", () => {
    render(<TeamCharter />);
    fireEvent.change(screen.getByLabelText("Sprint Review"), { target: { value: "15:00" } });
    expect(cadence.patches).toContainEqual({ reviewTime: "15:00" });
  });

  it("exports the charter with every section", async () => {
    render(<TeamCharter />);
    await screen.findByText("1 criterion · 1 required");
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("# Team charter");
    expect(md).toContain("- Ann (Dev)");
    expect(md).toContain("- Core hours 10–15 _(communication)_ — agreed by Ann");
    expect(md).toContain("- Fits in a sprint");
    expect(md).toContain("- Code reviewed");
    expect(md).toContain("| 1 | Our tiniest change |  |");
  });
});
