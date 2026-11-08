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

// Touch targets follow the input, not the width: a landscape phone (812 px)
// and a tablet (768 px) are md+ but touch, so the md+ density shrink is for a
// mouse only, and `sm` gets 44 px on touch too (mobile audit #28, #30).
describe("button sizes on touch screens", () => {
  const classesOf = (size: "default" | "sm" | "lg" | "icon") =>
    buttonVariants({ size }).split(/\s+/);

  it.each(["default", "sm", "lg", "icon"] as const)(
    "%s never shrinks at a plain width breakpoint",
    (size) => {
      const widthShrinks = classesOf(size).filter((c) =>
        /^(?:xs|sm|md|lg|xl|2xl):(?:min-)?(?:h|w)-/.test(c)
      );
      expect(widthShrinks).toEqual([]);
    }
  );

  it("shrinks default and icon to 36 px only for a mouse on md+", () => {
    expect(classesOf("default")).toEqual(
      expect.arrayContaining(["min-h-[44px]", "md-fine:min-h-9", "md-fine:h-9"])
    );
    expect(classesOf("icon")).toEqual(
      expect.arrayContaining([
        "min-h-[44px]",
        "min-w-[44px]",
        "md-fine:h-9",
        "md-fine:w-9",
        "md-fine:min-h-0",
        "md-fine:min-w-0",
      ])
    );
  });

  it("gives sm a 44 px minimum on touch and keeps 36 px for a mouse", () => {
    expect(classesOf("sm")).toEqual(
      expect.arrayContaining(["min-h-[36px]", "pointer-coarse:min-h-11"])
    );
  });

  it("keeps the touch minimum when a call site resets min-height for a dense row", () => {
    render(
      <Button size="sm" className="h-8 min-h-0 px-2">
        Undo
      </Button>
    );
    const classes = screen.getByRole("button", { name: "Undo" }).className.split(/\s+/);
    expect(classes).toContain("pointer-coarse:min-h-11");
    expect(classes).not.toContain("min-h-[36px]");
  });

  it("lets a call site's own md: size still win over the mouse shrink", () => {
    // `md-fine:` sorts before `md:` in the CSS (custom variants come before
    // screens), so both classes are kept and the call site's applies.
    render(
      <Button size="icon" className="md:h-7 md:w-7" aria-label="Remove">
        x
      </Button>
    );
    const classes = screen.getByRole("button", { name: "Remove" }).className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["md:h-7", "md:w-7", "min-h-[44px]"]));
  });
});
