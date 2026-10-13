import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Kudos } from "@/lib/stores/workspace-types";

const h = vi.hoisted(() => ({
  auth: null as { status: string; user: { id: string } | null } | null,
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));

import { KudosHeaderBeacon } from "@/lib/kudos/beacon/header-beacon";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

function kudosAt(id: string, sentAt: string): Kudos {
  return {
    id,
    theme: "thank-you",
    toName: `To ${id}`,
    fromName: `From ${id}`,
    message: `message ${id}`,
    sentAt,
  };
}

describe("KudosHeaderBeacon", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    h.auth = null;
    fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ kudos: [] }) }));
    vi.stubGlobal("fetch", fetchSpy);
    // Seven kudos, stored out of order: the popover shows the newest five.
    const rows = [3, 1, 7, 5, 2, 6, 4].map((d) => kudosAt(`k${d}`, `2026-01-0${d}T10:00:00.000Z`));
    useWorkspaceStore.setState({ kudos: rows });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ kudos: [] });
    vi.unstubAllGlobals();
  });

  it("shows a visitor the newest local kudos without calling the API", async () => {
    h.auth = { status: "anonymous", user: null };
    render(<KudosHeaderBeacon />);
    fireEvent.click(screen.getByRole("button", { name: "Kudos beacon" }));

    const list = await screen.findByRole("list");
    const names = within(list)
      .getAllByText(/→/)
      .map((el) => el.textContent);
    expect(names).toEqual([
      "From k7 → To k7",
      "From k6 → To k6",
      "From k5 → To k5",
      "From k4 → To k4",
      "From k3 → To k3",
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches the server wall for the owner", async () => {
    h.auth = { status: "authenticated", user: { id: "u1" } };
    render(<KudosHeaderBeacon />);
    fireEvent.click(screen.getByRole("button", { name: "Kudos beacon" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/kudos?limit=5"));
  });
});
