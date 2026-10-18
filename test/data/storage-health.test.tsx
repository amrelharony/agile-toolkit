import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("file-saver", () => ({ saveAs: vi.fn() }));

import { saveAs } from "file-saver";
import { StorageHealthBanner } from "@/components/data/storage-health-banner";
import { reportStorageWriteFailure, useStorageHealth } from "@/lib/stores/storage-health";
import { safeJSONStorage } from "@/lib/stores/safe-storage";

beforeEach(() => {
  useStorageHealth.setState({ writeFailed: false, dismissed: false });
});

describe("storage health", () => {
  it("is silent while saving works", () => {
    const { container } = render(<StorageHealthBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("raises the banner when a store can't write", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    safeJSONStorage("test")?.setItem("k", { state: {}, version: 0 });
    setItem.mockRestore();
    expect(useStorageHealth.getState().writeFailed).toBe(true);
  });

  it("offers a backup download and can be dismissed", () => {
    reportStorageWriteFailure();
    render(<StorageHealthBanner />);
    expect(screen.getByRole("alert")).toHaveTextContent("stopped saving");
    fireEvent.click(screen.getByRole("button", { name: /Download backup/ }));
    expect(saveAs).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss storage warning" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
