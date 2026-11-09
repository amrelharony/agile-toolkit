import { describe, expect, it } from "vitest";
import { render, within } from "@testing-library/react";
import { TOUCH_ROW, TOUCH_ROW_LINK } from "@/components/ui/touch-target";
import { JobLauncher } from "@/components/home/job-launcher";

/**
 * Home "What do you need to do?" cards: each card is one stretched link, so
 * the 16px "Other options" toggle lost near-miss taps to the card. On touch
 * it is 44px tall, and each alternative is a 44px row; with a mouse nothing
 * moves (every added class is behind `pointer-coarse:`).
 */

const classes = (s: string) => s.split(/\s+/).filter(Boolean);

describe("home job cards", () => {
  it("give 'Other options' a 44px touch area without moving it with a mouse", () => {
    const { container } = render(<JobLauncher />);
    const summaries = Array.from(container.querySelectorAll("summary"));
    expect(summaries.length).toBeGreaterThan(0);
    for (const summary of summaries) {
      // 16px of text + 2 x 14px padding = 44px; the margin takes 16px back.
      expect(summary).toHaveClass("pointer-coarse:py-3.5", "pointer-coarse:-my-2");
      expect(summary).toHaveClass("cursor-pointer", "select-none", "hover:text-text");
      // No padding or margin for a mouse.
      for (const c of classes(summary.className)) {
        if (/(^|:)-?(p|m)[xytblr]?-/.test(c)) expect(c).toMatch(/^pointer-coarse:/);
      }
      // The details stays above the card's stretched link.
      expect(summary.parentElement).toHaveClass("relative", "z-10");
    }
  });

  it("make each alternative a 44px row on touch that opens its tool", () => {
    const { container } = render(<JobLauncher />);
    const details = container.querySelector("details")!;
    const links = within(details).getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveClass(...classes(TOUCH_ROW_LINK), "font-medium", "text-text");
      const row = link.closest("li")!;
      expect(row).toHaveClass(...classes(TOUCH_ROW));
      // The sentence still reads "Tool — when …".
      expect(row.textContent).toMatch(/^.+ — when .+/);
    }
  });
});
