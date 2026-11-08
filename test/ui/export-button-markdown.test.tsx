import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const exportMock = vi.hoisted(() => ({
  copyToClipboard: vi.fn(async () => true),
  exportToMarkdown: vi.fn(),
}));
vi.mock("@/lib/utils/export", () => ({
  exportToCSV: vi.fn(),
  exportToJSON: vi.fn(),
  exportToPNG: vi.fn(),
  copyToClipboard: exportMock.copyToClipboard,
  exportToMarkdown: exportMock.exportToMarkdown,
}));
vi.mock("@/lib/sonification/emit", () => ({ emitUiEvent: () => {} }));

import { ExportButton } from "@/components/shared/export-button";

function openMenu() {
  // After a copy or download the trigger confirms in place ("Copied").
  const trigger = screen.getByRole("button", { name: /Export|Copied/ });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
}

describe("ExportButton Markdown", () => {
  const md = "# Retro — 18 Oct\n\n## Start\n- Pair on CI\n";

  it("copies and downloads the tool's Markdown", async () => {
    render(<ExportButton filename="retro" markdown={md} />);
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy as Markdown" }));
    await waitFor(() => expect(exportMock.copyToClipboard).toHaveBeenCalledWith(md));
    // Confirmed inline on the trigger, not with a toast.
    await screen.findByRole("button", { name: "Copied" });

    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Download Markdown (.md)" }));
    expect(exportMock.exportToMarkdown).toHaveBeenCalledWith(md, "retro");
    await screen.findByRole("button", { name: "Exported" });
  });

  it("offers no Markdown items when the tool has none", async () => {
    render(<ExportButton filename="x" jsonData={{ a: 1 }} />);
    openMenu();
    await screen.findByRole("menuitem", { name: "Export JSON" });
    expect(screen.queryByRole("menuitem", { name: /Markdown/ })).toBeNull();
  });
});
