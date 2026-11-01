import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * Amr's box is 132×143 but his figure fills only part of it. The transparent
 * rest would swallow clicks meant for the page under it (a column's "Add a
 * card", a side panel's controls). Only the figure takes clicks, and the empty
 * row below his feet sits past the screen edge.
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
import { useAgentStore } from "@/lib/agent/store";
import { useMascotStore } from "@/lib/agent/mascot/store";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  useAgentStore.setState({ open: false });
  useMascotStore.setState({ ready: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useAgentStore.setState({ open: false });
  useMascotStore.setState({ ready: false });
});

describe("mascot hit area", () => {
  it("takes clicks only on the figure and stands closer to the edge", async () => {
    render(<MascotAssistant />);
    // Before the figure loads: the round launcher takes clicks as before.
    const launcher = screen.getByRole("button", { name: "Open assistant" });
    expect(launcher).not.toHaveClass("pointer-events-none");

    // First interaction starts the figure (after an idle moment).
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    expect(await screen.findByTestId("mascot-sprite", {}, { timeout: 2000 })).toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Open assistant" });
    expect(button).toHaveClass("pointer-events-none");
    const hit = button.querySelector<HTMLElement>("[data-mascot-hit]");
    expect(hit).not.toBeNull();
    expect(hit).toHaveClass("pointer-events-auto");
    // The hit area is the figure's rows, inset from the box edges.
    expect(parseFloat(hit!.style.top)).toBeGreaterThan(0);
    expect(parseFloat(hit!.style.bottom)).toBeGreaterThan(0);
    expect(parseFloat(hit!.style.left)).toBeGreaterThan(0);
    // The empty row below his feet is past the bottom edge.
    expect(parseFloat(button.style.bottom)).toBeLessThan(0);

    // Clicking the figure still opens the assistant.
    fireEvent.click(hit!);
    expect(useAgentStore.getState().open).toBe(true);
  });
});
