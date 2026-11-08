import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import { TagFilterRow } from "@/app/(tools)/canvas/components/tag-filter-row";

/**
 * The tag filter row under the board toolbar (mobile audit #19). On touch
 * the toolbar is 54 px tall (44 px controls), ending at 62 px below `sm`
 * and 66 px from `sm` up, so at top-14 (56 px) the row, later in the DOM
 * at the same z, covered the bottom of its controls. Below `sm` it also
 * starts right of the tool rail, which runs in the same band.
 */

const tagged = [{ id: "o1", tags: ["risk"] }] as unknown as WhiteboardObject[];
const row = () => screen.getByLabelText("Filter objects by tag");

describe("TagFilterRow position", () => {
  it("starts under the touch board toolbar, right of the rail, below sm", () => {
    render(<TagFilterRow objects={tagged} />);
    expect(row()).toHaveClass("top-[4.25rem]", "left-[4.25rem]", "max-w-[calc(100%-4.75rem)]");
    expect(row()).not.toHaveClass("top-14");
  });

  it("keeps top-14 for mouse from sm up and clears the 66 px touch toolbar", () => {
    render(<TagFilterRow objects={tagged} />);
    expect(row()).toHaveClass(
      "sm:top-14",
      "sm:pointer-coarse:top-[4.5rem]",
      "sm:left-1/2",
      "sm:-translate-x-1/2"
    );
  });
});
