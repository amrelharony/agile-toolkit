import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import NotFound from "@/app/not-found";

/**
 * The 404 page's tool list on a phone. Its one-line descriptions truncate,
 * and an implicit auto grid track grew to their full width: at 360px the
 * page was laid out 1094px wide, rendered at a third of its size, and the
 * mascot ended up off-screen.
 */
describe("404 page", () => {
  it("caps the phone column so the descriptions clip instead of widening the page", () => {
    render(<NotFound />);
    const list = screen.getByRole("list");
    // grid-cols-1 is repeat(1, minmax(0, 1fr)); sm:grid-cols-2 keeps two.
    expect(list).toHaveClass("grid", "grid-cols-1", "sm:grid-cols-2");

    const items = screen.getAllByRole("listitem");
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const link = item.querySelector("a") as HTMLElement;
      expect(link).toHaveAttribute("href");
      // The text column may shrink, so its truncated description clips.
      const description = link.querySelector(".truncate") as HTMLElement;
      expect(description).not.toBeNull();
      expect(description.parentElement).toHaveClass("min-w-0", "flex-1");
    }
  });
});
