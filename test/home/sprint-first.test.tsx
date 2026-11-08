import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Home is sprint-first: once the workspace has loaded it shows the team's
 * sprint (the cockpit, or the start flow before a sprint exists) above the
 * job launcher, and the hero's second button points at the cockpit.
 */

vi.mock("@/lib/tools/tool-prefs", () => ({
  useToolPrefs: () => ({
    favorites: [],
    recent: [],
    showAllTools: false,
    isFavorite: () => false,
    toggleFavorite: () => {},
    recordUse: () => {},
    setShowAllTools: () => {},
  }),
}));
vi.mock("@/app/(tools)/sprint/cockpit", () => ({
  SprintCockpit: ({ compact }: { compact?: boolean }) => (
    <div data-testid="cockpit">{compact ? "compact" : "full"}</div>
  ),
}));
vi.mock("@/components/shared/insights-engine", () => ({ InsightsEngine: () => null }));
vi.mock("@/components/home/home-search", () => ({ HomeSearch: () => <div>search</div> }));
vi.mock("@/components/home/job-launcher", () => ({ JobLauncher: () => <div>jobs</div> }));
vi.mock("@/components/home/continue-section", () => ({ ContinueSection: () => null }));
vi.mock("@/components/home/tool-sections", () => ({ ToolSections: () => <div>sections</div> }));
const hydration = vi.hoisted(() => ({ hydrated: true }));
vi.mock("@/lib/team/use-team-roster", () => ({
  useWorkspaceHydrated: () => hydration.hydrated,
}));

import { HomePage as Home } from "@/components/home/home-page";

afterEach(() => {
  useWorkspaceStore.setState({ sprints: [] });
  hydration.hydrated = true;
});

describe("sprint-first home", () => {
  it("shows the start flow before any sprint exists", async () => {
    useWorkspaceStore.setState({ sprints: [] });
    render(<Home />);
    expect(screen.getByRole("heading", { name: "Start your sprint" })).toBeInTheDocument();
    // The cockpit's code loads once the page is up (off home's first download).
    expect(await screen.findByTestId("cockpit")).toHaveTextContent("compact");
    expect(screen.getByRole("link", { name: /Team dashboard/ })).toHaveAttribute(
      "href",
      "/health-dashboard"
    );
  });

  it("opens on the sprint once one exists", () => {
    useWorkspaceStore.setState({
      sprints: [
        {
          id: "s1",
          name: "Sprint 1",
          startDate: "2026-10-15",
          endDate: "2026-10-25",
          pointsPlanned: 20,
          status: "active",
        },
      ],
    });
    render(<Home />);
    expect(screen.getByRole("heading", { name: "Your sprint" })).not.toHaveClass("invisible");
    expect(screen.getByRole("link", { name: /Sprint Cockpit/ })).toHaveAttribute("href", "/sprint");
    expect(screen.queryByRole("link", { name: /Team dashboard/ })).toBeNull();
  });

  it("holds the sprint block's place above the jobs until the workspace has loaded", () => {
    hydration.hydrated = false;
    // Even with sprints saved: the server can't know, and the first client
    // render must match its HTML.
    useWorkspaceStore.setState({
      sprints: [
        {
          id: "s1",
          name: "Sprint 1",
          startDate: "2026-10-15",
          endDate: "2026-10-25",
          pointsPlanned: 20,
          status: "active",
        },
      ],
    });
    render(<Home />);
    // The cockpit shows its own placeholder until then (see
    // test/layout/workspace-loading.test.tsx); the block is there from the start,
    // so it can't push the job cards down when the workspace arrives.
    // The heading holds its line but stays hidden, under a neutral name: it
    // doesn't yet know whether to say "Your sprint" or "Start your sprint".
    const heading = screen.getByRole("heading", { name: "Sprint" });
    expect(heading).toHaveClass("invisible");
    expect(screen.queryByText("Start your sprint")).toBeNull();
    expect(screen.queryByText("Your sprint")).toBeNull();
    const cockpit = screen.getByTestId("cockpit");
    expect(cockpit).toHaveTextContent("compact");
    expect(heading.closest("section")).toContainElement(cockpit);
    const jobs = screen.getByText("jobs");
    expect(cockpit.compareDocumentPosition(jobs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("link", { name: /Team dashboard/ })).toBeInTheDocument();
  });

  it("is in the server HTML, above the jobs", () => {
    hydration.hydrated = false;
    const html = renderToString(<Home />);
    expect(html).toContain('id="your-sprint-heading"');
    expect(html).not.toContain("Start your sprint");
    expect(html).toContain('data-testid="cockpit"');
    expect(html.indexOf('data-testid="cockpit"')).toBeLessThan(html.indexOf(">jobs<"));
  });
});
