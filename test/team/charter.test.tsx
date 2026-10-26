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
    referenceStoryIds: {},
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
  useWorkspaceStore.setState({ teamMembers: [], workingAgreements: [], stories: [], sprints: [] });
});

describe("TeamCharter", () => {
  it("shows one card per agreement, read from each tool's data", async () => {
    render(<TeamCharter />);
    const list = screen.getByRole("list", { name: "Charter documents" });
    const card = (id: string) => list.querySelector(`[data-charter="${id}"]`) as HTMLElement;

    expect(card("agreement")).toHaveTextContent("1 rule · 1 with everyone's consent");
    // The stored "version 1" was never published (no date, no snapshot).
    expect(card("agreement")).toHaveTextContent("Not published yet");
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

  it("reads refinement checks on the stories and lists the guide's pinned stories", async () => {
    useWorkspaceStore.setState({
      stories: [
        {
          id: "s1",
          title: "Refund an order",
          status: "done",
          points: 8,
          readiness: {
            checked: ["c1", "c2", "c3"],
            ready: true,
            updatedAt: new Date(2026, 9, 20, 12).toISOString(),
          },
        },
        {
          id: "s2",
          title: "Split a bill",
          status: "backlog",
          readiness: {
            checked: [],
            ready: false,
            updatedAt: new Date(2026, 9, 21, 12).toISOString(),
          },
        },
      ],
    });
    // The example's pin on 8 is the guide's sample, not the team's.
    useEstimationGuideStore.setState({
      referenceStoryIds: { "Fibonacci:8": ["s1", "example-guide-ref-8"] },
    });
    render(<TeamCharter />);
    const list = screen.getByRole("list", { name: "Charter documents" });
    const card = (id: string) => list.querySelector(`[data-charter="${id}"]`) as HTMLElement;

    expect(card("dor")).toHaveTextContent("50% pass rate over the last 2 stories");
    expect(card("estimation")).toHaveTextContent("1 reference story on 1 card");
    const refs = within(card("estimation")).getByRole("list", {
      name: "Reference stories by card",
    });
    expect(within(refs).getAllByRole("listitem")).toHaveLength(1);
    expect(refs).toHaveTextContent("Card 8Refund an order");
    expect(within(refs).getByRole("link", { name: "Refund an order" })).toHaveAttribute(
      "href",
      "/estimation-guide"
    );

    await screen.findByText("1 criterion · 1 required");
    expect(screen.getByTestId("export-markdown").textContent).toContain(" |  | Refund an order |");
  });

  it("reports the DoD on the latest completed sprint's done stories", async () => {
    useWorkspaceStore.setState({
      sprints: [
        {
          id: "sp7",
          name: "Sprint 7",
          startDate: "2026-10-01",
          endDate: "2026-10-14",
          pointsPlanned: 10,
          status: "completed",
        },
      ],
      stories: [
        {
          id: "s1",
          title: "Refund an order",
          status: "done",
          sprintId: "sp7",
          dodChecks: { checked: ["d1"], updatedAt: "2026-10-10T12:00:00.000Z" },
        },
        { id: "s2", title: "Split a bill", status: "done", sprintId: "sp7" },
      ],
    });
    render(<TeamCharter />);
    const card = screen
      .getByRole("list", { name: "Charter documents" })
      .querySelector('[data-charter="dod"]') as HTMLElement;
    expect(
      await within(card).findByText("Sprint 7: 1 of 2 done stories meet it")
    ).toBeInTheDocument();
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
