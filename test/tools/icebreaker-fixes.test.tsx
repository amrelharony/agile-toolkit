import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Icebreaker: the Time filter means "up to N minutes". Picking 10 min used
 * to hide every 2- and 5-minute activity.
 */

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { IceBreakerClient } from "@/app/(tools)/icebreaker/icebreaker-client";
import { icebreakers } from "@/lib/constants/icebreakers";

describe("Icebreaker time filter", () => {
  it("keeps shorter activities when a longer time is picked", () => {
    render(<IceBreakerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Up to 10 min" }));

    const fits = icebreakers.filter((ib) => ib.timeMinutes <= 10);
    expect(fits.length).toBeLessThan(icebreakers.length);
    expect(document.body.textContent).toContain(`${fits.length} icebreakers match your filters`);

    const fiveMinute = icebreakers.find((ib) => ib.timeMinutes === 5)!;
    expect(screen.getByRole("button", { name: fiveMinute.name })).toBeInTheDocument();
    const tooLong = icebreakers.find((ib) => ib.timeMinutes > 10)!;
    expect(screen.queryByRole("button", { name: tooLong.name })).toBeNull();
  });
});
