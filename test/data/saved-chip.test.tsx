import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
vi.mock("@/lib/gamification/signal", () => ({ signalGamification: vi.fn() }));

import { SavedChip } from "@/components/data/saved-chip";
import { LAST_BACKUP_KEY, recordBackup } from "@/lib/data/backup-meta";
import { useStorageHealth } from "@/lib/stores/storage-health";

beforeEach(() => {
  owner.isOwner = false;
  owner.settled = true;
  owner.unverified = false;
  useStorageHealth.setState({ writeFailed: false, dismissed: false });
  localStorage.clear();
});

/** The classes that size the chip (not colours, hover or focus). */
const sizing = (el: Element) =>
  Array.from(el.classList).filter((c) =>
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

describe("SavedChip: when the last backup was", () => {
  const NOW = new Date("2026-11-10T09:00:00");
  /** The backup line as written, wide form and phone form together (CSS shows one). */
  const backupLine = () => document.querySelector("[data-saved-chip-backup]")!;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("says there is no backup yet", () => {
    render(<SavedChip />);
    expect(backupLine()).toHaveTextContent("No backup yet");
    expect(
      screen.getByRole("button", {
        name: "Saved in this browser. No backup yet. Back up or restore your data",
      })
    ).toBeInTheDocument();
  });

  it("says how many days ago, in full for the button's name", () => {
    localStorage.setItem(LAST_BACKUP_KEY, "2026-11-07T15:00:00");
    render(<SavedChip />);
    expect(
      screen.getByRole("button", {
        name: "Saved in this browser. Last backup: 3 days ago. Back up or restore your data",
      })
    ).toBeInTheDocument();
    expect(backupLine()).toHaveTextContent("3 days ago");
  });

  it("writes the long form for wide screens and a short one that fits a phone", () => {
    localStorage.setItem(LAST_BACKUP_KEY, "2026-11-09T15:00:00");
    render(<SavedChip />);
    const [wide, narrow] = Array.from(backupLine().querySelectorAll("span"));
    expect(wide).toHaveTextContent("Last backup:");
    expect(wide).toHaveClass("max-lg:hidden");
    expect(narrow).toHaveTextContent("Backup:");
    expect(narrow).toHaveClass("lg:hidden");
    expect(backupLine()).toHaveTextContent(/yesterday$/);
  });

  it("updates the moment a backup is downloaded, without reopening anything", () => {
    render(<SavedChip />);
    expect(backupLine()).toHaveTextContent("No backup yet");
    act(() => recordBackup(NOW));
    expect(backupLine()).toHaveTextContent(/today$/);
    expect(screen.getByRole("button", { name: /Last backup: today/ })).toBeInTheDocument();
  });

  it("keeps saying it while the browser has stopped saving", () => {
    localStorage.setItem(LAST_BACKUP_KEY, "2026-10-21T15:00:00");
    useStorageHealth.setState({ writeFailed: true });
    render(<SavedChip />);
    expect(
      screen.getByRole("button", {
        name: "Not saving. Last backup: 20 days ago. Back up or restore your data",
      })
    ).toBeInTheDocument();
  });

  it("holds one width whatever it says, the same one its placeholder holds", () => {
    const holders = (root: ParentNode) =>
      Array.from(root.querySelectorAll('span[aria-hidden="true"].invisible')).map(
        (el) => el.textContent
      );
    owner.settled = false;
    const { container, rerender } = render(<SavedChip />);
    const placeholder = container.querySelector("[data-saved-chip-placeholder]")!;
    // Before anything can be read it reserves the widest label and age.
    expect(placeholder.querySelector("[data-saved-chip-backup]")).toHaveTextContent("000 days ago");
    const reserved = holders(placeholder);
    expect(reserved).toEqual(["Saved in this browser", "Last backup: Backup: 000 days ago"]);

    owner.settled = true;
    rerender(<SavedChip />);
    expect(holders(screen.getByRole("button"))).toEqual(reserved);
    // Whatever the chip then says, the holders are what size it.
    act(() => recordBackup(NOW));
    expect(holders(screen.getByRole("button"))).toEqual(reserved);
    useStorageHealth.setState({ writeFailed: true });
    rerender(<SavedChip />);
    expect(holders(screen.getByRole("button", { name: /Not saving/ }))).toEqual(reserved);
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
    expect(placeholderSizing).toContain("min-h-8");
    expect(placeholder).toHaveClass("pointer-coarse:min-h-11");
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

  it("lets go of the place while an owner check is retried", () => {
    // A session whose owner check went unanswered (offline, 5xx) is almost
    // always the owner's, who gets no chip, and the retries can run for as
    // long as the reader is offline: no blank gap in the toolbar meanwhile.
    owner.settled = false;
    const { container, rerender } = render(<SavedChip />);
    expect(container.querySelector("[data-saved-chip-placeholder]")).not.toBeNull();
    owner.settled = true;
    owner.unverified = true;
    rerender(<SavedChip />);
    expect(container).toBeEmptyDOMElement();
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
