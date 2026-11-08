import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const owner = vi.hoisted(() => ({ isOwner: false }));
vi.mock("@/lib/auth/use-is-owner", () => ({
  useIsOwner: () => owner.isOwner,
  useOwnerState: () => ({
    isOwner: owner.isOwner,
    settled: true,
    unverified: false,
    visitor: !owner.isOwner,
  }),
}));
vi.mock("@/lib/sonification/emit", () => ({ emitUiEvent: () => {} }));

import { SavedChip } from "@/components/data/saved-chip";
import { useStorageHealth } from "@/lib/stores/storage-health";

beforeEach(() => {
  owner.isOwner = false;
  useStorageHealth.setState({ writeFailed: false, dismissed: false });
});

describe("SavedChip", () => {
  it("tells visitors their work is saved in this browser and opens the backup dialog", async () => {
    render(<SavedChip />);
    const chip = screen.getByRole("button", { name: /Saved in this browser/ });
    fireEvent.click(chip);
    // The dialog loads on first open. A cold import of it can take over the
    // default 1 s on a busy machine.
    expect(
      await screen.findByRole("dialog", { name: "Your data" }, { timeout: 10_000 })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download backup/ })).toBeInTheDocument();
  });

  it("is 32 px with a mouse and 44 px on touch, and grows instead of clipping", () => {
    render(<SavedChip />);
    const classes = screen
      .getByRole("button", { name: /Saved in this browser/ })
      .className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["min-h-8", "pointer-coarse:min-h-11"]));
    expect(classes).not.toContain("h-8");
  });

  it("warns when the browser has stopped saving", () => {
    useStorageHealth.setState({ writeFailed: true });
    render(<SavedChip />);
    expect(screen.getByRole("button", { name: /Not saving/ })).toBeInTheDocument();
  });

  it("is not shown to the owner, whose data syncs to their account", () => {
    owner.isOwner = true;
    const { container } = render(<SavedChip />);
    expect(container).toBeEmptyDOMElement();
  });
});
