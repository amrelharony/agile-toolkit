import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Amr's own button opens and closes his panel (audit toggle-button-state,
 * one-amr-voice). Its name is "Ask Amr" whatever the state, so it never
 * doubles the panel's own "Close assistant"; the state is aria-expanded, and
 * aria-controls names the panel only while the panel is in the page. It
 * also says how it was pressed (a key clicks with detail 0), as Ctrl/Cmd+J
 * does, so the panel's focus owner can treat a keyboard open apart.
 */

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => ({ status: "anonymous", user: null }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/retro" }));
vi.mock("@/lib/agent/client", () => ({ abortInFlight: vi.fn() }));
vi.mock("@/lib/actions/register-all", () => ({}));
vi.mock("@/components/agent/mascot/mascot-sprite", () => ({
  default: () => <div data-testid="mascot-sprite" />,
}));

import { MascotAssistant } from "@/components/agent/mascot/mascot-assistant";
import { VISITOR_BODY_LOADING } from "@/components/agent/mascot/lazy-visitor-body";
import { AMR_PANEL_ID } from "@/components/agent/mascot/panel-ids";
import { useAgentStore } from "@/lib/agent/store";

const amr = () => screen.getByRole("button", { name: "Ask Amr" });

/** The panel is open and its body has loaded (no state lands after the test). */
async function panelOpen() {
  const panel = await screen.findByRole("dialog", { name: "Amr" });
  await waitFor(() => expect(screen.queryByText(VISITOR_BODY_LOADING)).toBeNull());
  return panel;
}

beforeEach(() => {
  useAgentStore.getState().closeSheet();
});

afterEach(() => {
  cleanup();
  useAgentStore.getState().closeSheet();
  vi.useRealTimers();
});

describe("Amr's button", () => {
  it("keeps one name, and says whether the panel is open and which one", async () => {
    render(<MascotAssistant />);
    const button = amr();
    expect(button).toHaveAttribute("aria-expanded", "false");
    // Closed, the panel isn't in the page: nothing to point at.
    expect(button).not.toHaveAttribute("aria-controls");
    expect(document.getElementById(AMR_PANEL_ID)).toBeNull();

    act(() => useAgentStore.getState().openSheet());
    const panel = await panelOpen();
    // The same button, by the same name: the panel's X is the only Close.
    expect(amr()).toBe(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", AMR_PANEL_ID);
    expect(panel).toHaveAttribute("id", AMR_PANEL_ID);
    expect(button).toHaveAccessibleName("Ask Amr");

    act(() => useAgentStore.getState().closeSheet());
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).not.toHaveAttribute("aria-controls");
  });

  it("names Ctrl/Cmd+J as its shortcut", () => {
    render(<MascotAssistant />);
    expect(amr()).toHaveAttribute("aria-keyshortcuts", "Control+J Meta+J");
  });

  it.each([
    ["Enter or Space (a click with detail 0)", 0, "keyboard"],
    ["a mouse or finger", 1, "pointer"],
  ] as const)("opens the panel on %s and says so", async (_label, detail, via) => {
    render(<MascotAssistant />);
    fireEvent.click(amr(), { detail });
    expect(useAgentStore.getState()).toMatchObject({ open: true, openedVia: via });
    await panelOpen();
  });

  it("closes the panel on the next press, through closeSheet", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    try {
      render(<MascotAssistant />);
      fireEvent.click(amr(), { detail: 0 });
      await panelOpen();
      // Past the burst window, so the press toggles rather than plays.
      now.mockReturnValue(20_000);
      fireEvent.click(amr(), { detail: 0 });
      expect(useAgentStore.getState()).toMatchObject({ open: false, openedVia: null });
      expect(amr()).toHaveAttribute("aria-expanded", "false");
    } finally {
      now.mockRestore();
    }
  });
});

describe("Ctrl/Cmd+J", () => {
  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
  ] as const)("%s+J opens the panel as a keyboard open, and closes it again", async (_k, mod) => {
    render(<MascotAssistant />);
    fireEvent.keyDown(document.body, { key: "j", ...mod });
    expect(useAgentStore.getState()).toMatchObject({ open: true, openedVia: "keyboard" });
    expect(amr()).toHaveAttribute("aria-expanded", "true");
    await panelOpen();

    fireEvent.keyDown(document.body, { key: "J", ...mod });
    expect(useAgentStore.getState()).toMatchObject({ open: false, openedVia: null });
  });
});
