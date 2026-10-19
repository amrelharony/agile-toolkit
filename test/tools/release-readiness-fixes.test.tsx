import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { GateId, Release } from "@/lib/stores/workspace-types";

/**
 * Release Readiness: a release that shipped and was then rolled back used to
 * drop out of "% on time" silently. It still shipped, so it counts, and the
 * card says how many of the shipped releases were rolled back.
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

import { ReleaseReadinessClient } from "@/app/(tools)/release-readiness/release-readiness-client";
import { onTimeRate } from "@/app/(tools)/release-readiness/metrics";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

const gates = {} as Record<GateId, boolean>;
const release = (r: Partial<Release> & Pick<Release, "id" | "status">): Release => ({
  name: r.id,
  plannedDate: "2026-10-10",
  gates,
  ...r,
});

const RELEASES: Release[] = [
  // Shipped on time.
  release({ id: "a", status: "shipped", shippedDate: "2026-10-09" }),
  // Shipped late.
  release({ id: "b", status: "shipped", shippedDate: "2026-10-12" }),
  // Shipped on time, then rolled back.
  release({ id: "c", status: "rolled_back", shippedDate: "2026-10-08" }),
  // Shipped late, then rolled back.
  release({ id: "d", status: "rolled_back", shippedDate: "2026-10-15" }),
  // Marked rolled back without ever shipping: not counted.
  release({ id: "e", status: "rolled_back" }),
  // Still planning: not counted.
  release({ id: "f", status: "planning" }),
];

describe("Release Readiness % on time", () => {
  it("counts releases that shipped and were later rolled back", () => {
    expect(onTimeRate(RELEASES)).toEqual({ pct: 50, shipped: 4, onTime: 2, rolledBack: 2 });
    // Before: only status "shipped" counted, so this read 1 of 2.
  });

  it("is null when nothing has gone out", () => {
    expect(onTimeRate([release({ id: "x", status: "planning" })]).pct).toBeNull();
  });

  it("shows the rolled-back count on the card", () => {
    useWorkspaceStore.setState({
      releaseReadinesses: [{ id: "releaseReadiness:current", releases: RELEASES }],
    });
    render(<ReleaseReadinessClient />);
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("of 4 shipped, incl. 2 rolled back")).toBeInTheDocument();
  });
});
