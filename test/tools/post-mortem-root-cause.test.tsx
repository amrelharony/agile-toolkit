import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RootCauseAnalysis } from "@/lib/stores/workspace-types";

/**
 * Post-Mortem's side of the link with Root Cause: a contributing factor
 * opens an analysis ("Analyze in Root Cause", with Undo) that names the
 * post-mortem and links back to it; once it has, the factor links to its
 * analysis instead, and pressing again never opens a second one; analyses
 * linked to the post-mortem from Root Cause are listed under the factors.
 */

const undo = vi.hoisted(() => ({
  all: [] as { label: string; apply: () => void; revert: () => void }[],
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.all.push(a);
    a.apply();
  },
}));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { PostMortemClient } from "@/app/(tools)/post-mortem/post-mortem-client";
import { postMortemFactorRef } from "@/lib/root-cause/model";

const FACTORS = ["No alert on checkout errors", "The on-call engineer was new"];
const analyses = () => useWorkspaceStore.getState().rootCauseAnalyses ?? [];

beforeEach(() => {
  undo.all = [];
  useWorkspaceStore.setState({
    rootCauseAnalyses: [],
    postMortemLogs: [
      {
        id: "postMortem:current",
        postmortems: [
          {
            id: "pm1",
            title: "Checkout outage",
            incidentDate: "2026-11-03",
            status: "review",
            contributingFactors: FACTORS,
            timeline: [],
            actions: [],
          },
        ],
      },
    ] as never,
  });
});

afterEach(() => cleanup());

describe("Post-Mortem → Root Cause", () => {
  it("opens a factor in Root Cause, linked back to the post-mortem, with Undo", () => {
    render(<PostMortemClient />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze factor 1 in Root Cause" }));
    const [a] = analyses();
    expect(a).toMatchObject({
      title: "No alert on checkout errors",
      method: "five-whys",
      postMortemId: "pm1",
      sourceRef: postMortemFactorRef("pm1", FACTORS[0]),
    });
    expect(a.problem).toContain(
      "A contributing factor in the post-mortem “Checkout outage” (2026-11-03)."
    );
    expect(undo.all.at(-1)!.label).toBe("Opened in Root Cause");
    // The factor now links to its analysis, and the post-mortem lists it.
    expect(
      screen.getByRole("link", { name: "Open the analysis of factor 1 in Root Cause" })
    ).toHaveAttribute("href", `/root-cause?analysis=${encodeURIComponent(a.id)}`);
    expect(screen.getByText("Root-cause analyses")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "No alert on checkout errors" })).toBeInTheDocument();
    expect(screen.getByText("Looking for the cause")).toBeInTheDocument();
    // The other factor still offers its own analysis.
    expect(
      screen.getByRole("button", { name: "Analyze factor 2 in Root Cause" })
    ).toBeInTheDocument();

    act(() => undo.all.at(-1)!.revert());
    expect(analyses()).toEqual([]);
    expect(
      screen.getByRole("button", { name: "Analyze factor 1 in Root Cause" })
    ).toBeInTheDocument();
  });

  it("finds the same factor's analysis again, whatever its place or spacing", () => {
    const ref = postMortemFactorRef("pm1", "  no ALERT   on checkout errors ");
    expect(ref).toEqual(postMortemFactorRef("pm1", FACTORS[0]));
    expect(ref).not.toEqual(postMortemFactorRef("pm2", FACTORS[0]));
    useWorkspaceStore.setState({
      rootCauseAnalyses: [
        {
          id: "rca_1",
          title: "Old analysis",
          problem: "",
          method: "fishbone",
          whys: [],
          causes: [],
          sourceRef: postMortemFactorRef("pm1", FACTORS[0]),
          createdAt: "2026-11-04T09:00:00.000Z",
          updatedAt: "2026-11-04T09:00:00.000Z",
        } satisfies RootCauseAnalysis,
      ],
    });
    render(<PostMortemClient />);
    expect(
      screen.getByRole("link", { name: "Open the analysis of factor 1 in Root Cause" })
    ).toHaveAttribute("href", "/root-cause?analysis=rca_1");
    expect(analyses()).toHaveLength(1);
  });

  it("lists an analysis linked from Root Cause, with where it stands", () => {
    useWorkspaceStore.setState({
      rootCauseAnalyses: [
        {
          id: "rca_9",
          title: "Why checkout errors went unnoticed",
          problem: "",
          method: "fishbone",
          whys: [],
          causes: [],
          rootCause: "No alert",
          postMortemId: "pm1",
          createdAt: "2026-11-04T09:00:00.000Z",
          updatedAt: "2026-11-04T09:00:00.000Z",
        } satisfies RootCauseAnalysis,
      ],
    });
    render(<PostMortemClient />);
    expect(
      screen.getByRole("link", { name: "Why checkout errors went unnoticed" })
    ).toHaveAttribute("href", "/root-cause?analysis=rca_9");
    expect(screen.getByText("Root cause named")).toBeInTheDocument();
  });
});
