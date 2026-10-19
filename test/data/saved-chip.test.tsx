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
  it("tells visitors their work is saved in this browser and opens the backup dialog", () => {
    render(<SavedChip />);
    const chip = screen.getByRole("button", { name: /Saved in this browser/ });
    fireEvent.click(chip);
    expect(screen.getByRole("dialog", { name: "Your data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download backup/ })).toBeInTheDocument();
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
