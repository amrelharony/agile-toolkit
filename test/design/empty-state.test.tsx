import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "@/components/shared/empty-state";
import { POSES, SHEET } from "@/components/agent/mascot/engine/sprite-poses";
import { MASCOT_SPRITE_URL } from "@/components/agent/mascot/mascot-asset";

describe("EmptyState", () => {
  it("puts the call site's own words in a balloon, announced as status", () => {
    render(<EmptyState>No retro yet. Pick a format below.</EmptyState>);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("No retro yet. Pick a format below.");
    expect(status.closest(".balloon")).not.toBeNull();
  });

  it("shows Amr as a named, lazy, still crop of the existing sheet", () => {
    render(<EmptyState>Nothing here.</EmptyState>);
    const amr = screen.getByRole<HTMLImageElement>("img", { name: "Amr, waiting" });
    expect(amr.getAttribute("src")).toBe(MASCOT_SPRITE_URL);
    expect(amr).toHaveAttribute("loading", "lazy");
    const cellH = parseFloat(amr.style.height) / SHEET.rows;
    expect(parseFloat(amr.style.top)).toBeCloseTo(-POSES.waiting.row * cellH, 1);
    // A crop: the sheet is wider than the window it shows through.
    expect(parseFloat(amr.style.width)).toBeGreaterThan(amr.parentElement!.offsetWidth);
  });

  it("keeps the action inside the balloon", () => {
    render(<EmptyState action={<button>Load an example</button>}>Nothing here.</EmptyState>);
    expect(
      screen.getByRole("button", { name: "Load an example" }).closest(".balloon")
    ).not.toBeNull();
  });
});
