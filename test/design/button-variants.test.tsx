import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button, buttonVariants } from "@/components/ui/button";

// A solid `hover:bg-accent` turns the button into a cyan block with a
// ~1.4:1 (or, with `hover:text-accent`, invisible) label. Hover states must
// tint, never fill.
const SOLID_ACCENT_HOVER = /(^|\s)hover:bg-accent(\s|$)/;

describe("button variants", () => {
  it.each(["outline", "ghost"] as const)("%s tints on hover instead of filling", (variant) => {
    const classes = buttonVariants({ variant });
    expect(classes).not.toMatch(SOLID_ACCENT_HOVER);
    expect(classes).not.toContain("accent-foreground");
    expect(classes).toContain("hover:bg-accent/10");
  });

  it("keeps the label readable on hover for outline buttons", () => {
    render(<Button variant="outline">Export Board</Button>);
    const button = screen.getByRole("button", { name: "Export Board" });
    expect(button.className).toContain("hover:text-accent");
    expect(button.className).not.toMatch(SOLID_ACCENT_HOVER);
  });
});
