import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { IceBreakerClient } from "@/app/(tools)/icebreaker/icebreaker-client";
import { icebreakers } from "@/lib/constants/icebreakers";

describe("card grids are keyboard-operable (WCAG 2.1.1)", () => {
  it("exposes each icebreaker as a button, separate from its favourite toggle", () => {
    render(<IceBreakerClient />);
    const first = icebreakers[0];
    const open = screen.getByRole("button", { name: first.name });
    expect(open.tagName).toBe("BUTTON");
    const fav = screen.getByRole("button", { name: `Add ${first.name} to favorites` });
    expect(fav).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(fav);
    expect(
      screen.getByRole("button", { name: `Remove ${first.name} from favorites` })
    ).toHaveAttribute("aria-pressed", "true");
  });
});
