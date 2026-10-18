import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/sonification/emit", () => ({ emitUiEvent: () => {} }));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(
    vi.fn(() => "t"),
    { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }
  ),
}));

import { SnapshotClient } from "@/app/s/snapshot-client";
import { buildSnapshotUrl } from "@/components/share/share-link-button";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

async function openLink(url: string) {
  window.location.hash = new URL(url).hash;
  await act(async () => {
    render(<SnapshotClient />);
  });
}

beforeEach(() => {
  push.mockReset();
  useWorkspaceStore.setState({ prioritizations: [] });
});
afterEach(() => {
  window.location.hash = "";
});

describe("snapshot links end to end", () => {
  it("shares a tool's Markdown and state, opens read-only, and copies into this browser", async () => {
    const { url, withState } = await buildSnapshotUrl(
      "https://agile.example",
      "wsjf",
      "Q4 features",
      {
        markdown:
          "# WSJF — 19 Oct 2026\n\n| # | Feature | WSJF |\n|---|---|---|\n| 1 | Apple Pay | 12.00 |\n",
        state: [{ id: "r1", framework: "wsjf", title: "Apple Pay", fields: { bv: 8 } }],
      }
    );
    expect(withState).toBe(true);
    expect(url).toMatch(/^https:\/\/agile\.example\/s#s1\./);

    await openLink(url);
    expect(await screen.findByText(/Read-only snapshot from WSJF/)).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("Apple Pay");

    fireEvent.click(screen.getByRole("button", { name: "Copy into my browser" }));
    expect(useWorkspaceStore.getState().prioritizations![0].title).toBe("Apple Pay");
    expect(push).toHaveBeenCalledWith("/wsjf");
  });

  it("explains a missing or damaged link instead of failing", async () => {
    await openLink("https://agile.example/s");
    expect(screen.getByRole("heading", { name: "No snapshot in this link" })).toBeInTheDocument();
  });

  it("offers no import for tools that only share their Markdown", async () => {
    const { url } = await buildSnapshotUrl("https://agile.example", "planning-poker", undefined, {
      markdown: "# Planning Poker\n\n**Total: 13 points**",
    });
    await openLink(url);
    expect(await screen.findByText(/Total: 13 points/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy into my browser" })).toBeNull();
  });
});
