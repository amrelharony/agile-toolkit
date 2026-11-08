import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const owner = vi.hoisted(() => ({ isOwner: false, settled: true, unverified: false }));
vi.mock("@/lib/auth/use-is-owner", () => ({
  useIsOwner: () => owner.isOwner,
  useOwnerState: () => ({
    isOwner: owner.isOwner,
    settled: owner.settled,
    unverified: owner.unverified,
    visitor: owner.settled && !owner.isOwner && !owner.unverified,
  }),
}));
vi.mock("@/lib/sonification/emit", () => ({ emitUiEvent: () => {} }));

import { SavedChip } from "@/components/data/saved-chip";
import { useStorageHealth } from "@/lib/stores/storage-health";

beforeEach(() => {
  owner.isOwner = false;
  owner.settled = true;
  owner.unverified = false;
  useStorageHealth.setState({ writeFailed: false, dismissed: false });
});

/** The classes that size the chip (not colours, hover or focus). */
const sizing = (el: Element) =>
  [...el.classList].filter((c) =>
    /^(inline-flex|h-|min-h-|min-w-|items-|gap-|rounded-|border$|px-|py-|text-xs)/.test(c)
  );

describe("SavedChip", () => {
  // The dialog loads on first open; a cold import of it takes seconds on a
  // busy machine, past Testing Library's one-second default.
  it(
    "tells visitors their work is saved in this browser and opens the backup dialog",
    {
      timeout: 20_000,
    },
    async () => {
      render(<SavedChip />);
      const chip = screen.getByRole("button", { name: /Saved in this browser/ });
      fireEvent.click(chip);
      expect(
        await screen.findByRole("dialog", { name: "Your data" }, { timeout: 15_000 })
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Download backup/ })).toBeInTheDocument();
    }
  );

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

describe("SavedChip before auth settles", () => {
  it("holds the chip's place with an invisible, aria-hidden copy that can't be focused", () => {
    owner.settled = false;
    const { container } = render(<SavedChip />);
    // Nothing to press or announce yet.
    expect(screen.queryByRole("button")).toBeNull();
    const placeholder = container.querySelector("[data-saved-chip-placeholder]");
    expect(placeholder).not.toBeNull();
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
    expect(placeholder).toHaveClass("invisible");
    expect(placeholder?.tagName).toBe("SPAN");
    expect(placeholder).not.toHaveAttribute("tabindex");
    expect(container.querySelector("button, a, input, [tabindex]")).toBeNull();
    // Same words as the chip, so it takes the same width.
    expect(placeholder).toHaveTextContent("Saved in this browser");
  });

  it("is the same size as the chip it stands in for", () => {
    owner.settled = false;
    const { container, rerender } = render(<SavedChip className="ml-1" />);
    const placeholder = container.querySelector("[data-saved-chip-placeholder]")!;
    const placeholderSizing = sizing(placeholder);
    expect(placeholderSizing).toContain("h-8");
    expect(placeholder).toHaveClass("ml-1");

    owner.settled = true;
    rerender(<SavedChip className="ml-1" />);
    const chip = screen.getByRole("button", { name: /Saved in this browser/ });
    expect(sizing(chip)).toEqual(placeholderSizing);
    expect(container.querySelector("[data-saved-chip-placeholder]")).toBeNull();
  });

  it("is in the server HTML, where auth is still loading", () => {
    owner.settled = false;
    const html = renderToString(<SavedChip />);
    expect(html).toContain("data-saved-chip-placeholder");
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("<button");
  });

  it("keeps holding the place while an owner check is retried", () => {
    owner.unverified = true;
    const { container } = render(<SavedChip />);
    expect(container.querySelector("[data-saved-chip-placeholder]")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("goes away once the reader is the confirmed owner", () => {
    owner.settled = false;
    const { container, rerender } = render(<SavedChip />);
    expect(container.querySelector("[data-saved-chip-placeholder]")).not.toBeNull();
    owner.settled = true;
    owner.isOwner = true;
    rerender(<SavedChip />);
    expect(container).toBeEmptyDOMElement();
  });
});
