/** The portal's Entries view names VIP activations beside posters and direct visits. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { summariseEntries } from "@/lib/comics/entries-summary";

vi.mock("@/app/settings/comics/portal-api", () => ({
  errorMessage: () => "error",
  portalApi: {
    entries: async () => ({
      days: 30,
      summary: summariseEntries([
        { day: "2026-11-02", entry: "vip", ep: 0, building: 0, count: 3 },
        { day: "2026-11-02", entry: "direct", ep: 0, building: 0, count: 7 },
        { day: "2026-11-02", entry: "poster", ep: 12, building: 3, count: 2 },
      ]),
    }),
  },
}));

import { EntriesView } from "@/app/settings/comics/entries-view";

afterEach(cleanup);

describe("Entries view", () => {
  it("counts VIP activations in the sentence at the top", async () => {
    render(<EntriesView enabled />);
    expect(
      await screen.findByText(
        "12 entries: 2 from posters, 7 from the printed address or direct, 3 VIP activations from the link in the book."
      )
    ).toBeInTheDocument();
  });
});
