import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * Dragged to a top corner on a phone, Amr hangs from the header's bottom edge,
 * read from --header-h. That token now includes the top safe area
 * (globals.css), so he clears a header made taller by a notch without the
 * mascot knowing about insets (mobile audit 2026-11-08).
 */

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => ({ status: "anonymous", user: null }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/agent/client", () => ({ abortInFlight: vi.fn() }));
vi.mock("@/lib/actions/register-all", () => ({}));
vi.mock("@/components/agent/mascot/mascot-sprite", () => ({
  default: () => <div data-testid="mascot-sprite" />,
}));

import { MascotAssistant } from "@/components/agent/mascot/mascot-assistant";
import { useAgentStore } from "@/lib/agent/store";
import { useMascotStore } from "@/lib/agent/mascot/store";

function stubPhone() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  useAgentStore.setState({ open: false });
  useMascotStore.setState({ ready: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--amr-band-top");
  document.documentElement.style.removeProperty("--amr-band-bottom");
});

describe("Amr in a top corner on a phone", () => {
  it("is placed below the header by --header-h", () => {
    stubPhone();
    render(<MascotAssistant />);
    const button = screen.getByRole("button", { name: "Open assistant" });
    expect(button.style.top).toBe("");

    // Drag him to the top-left of the screen and let go.
    act(() => {
      fireEvent.pointerDown(button, { button: 0, clientX: 300, clientY: 600 });
    });
    act(() => {
      fireEvent.pointerMove(document, { clientX: 20, clientY: 20 });
    });
    act(() => {
      fireEvent.pointerUp(document, { clientX: 20, clientY: 20 });
    });

    const placed = screen.getByRole("button", { name: "Open assistant" });
    expect(placed.style.top).toContain("var(--header-h)");
    expect(placed.style.bottom).toBe("");
  });
});
