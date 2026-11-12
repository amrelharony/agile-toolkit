import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

/**
 * A phone has no spare margin, so space is kept for Amr at the bottom: main's
 * padding and the pinned bars clear him. He stays a full figure rather than
 * shrinking to a launcher, and nothing is drawn behind him: an opaque strip there
 * read as a bar across the bottom of the screen (8 November 2026). He and his
 * space stay while a page field has the keyboard (chat revamp PR 8: he used to
 * step off the page then).
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

import { MascotAssistant, phoneBandVars } from "@/components/agent/mascot/mascot-assistant";
import { useAgentStore } from "@/lib/agent/store";
import { useMascotStore } from "@/lib/agent/mascot/store";

function stubWidth(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width") ? phone : false,
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
  document.documentElement.style.removeProperty("--amr-band-bottom");
});

describe("Amr's space on phones", () => {
  it("keeps space at the bottom and publishes its height, with nothing drawn behind him", () => {
    stubWidth(true);
    const { container, unmount } = render(<MascotAssistant />);
    // No bar: the page shows behind him.
    expect(container.querySelector("[data-amr-band]")).toBeNull();
    expect(container.querySelector(".bg-bg")).toBeNull();
    const published = document.documentElement.style.getPropertyValue("--amr-band-bottom");
    expect(published).toMatch(/^calc\(\d+px \+ env\(safe-area-inset-bottom, 0px\)\)$/);
    // Tall enough for the 104 px box's figure, not a launcher-sized sliver.
    expect(parseInt(published.match(/\d+/)![0], 10)).toBeGreaterThan(80);
    // He's still there, clear of the home indicator.
    const button = screen.getByRole("button", { name: "Ask Amr" });
    expect(button.style.bottom).toContain("safe-area-inset-bottom");

    unmount();
    expect(document.documentElement.style.getPropertyValue("--amr-band-bottom")).toBe("");
  });

  it("keeps his space, and him, while a page field has the keyboard: nothing shifts as one types", () => {
    stubWidth(true);
    render(
      <>
        <input aria-label="Retro card" />
        <MascotAssistant />
      </>
    );
    const before = document.documentElement.style.getPropertyValue("--amr-band-bottom");
    const button = screen.getByRole("button", { name: "Ask Amr" });
    const field = screen.getByLabelText("Retro card");
    act(() => field.focus());
    // He used to step off the page here, and his space with him.
    expect(screen.getByRole("button", { name: "Ask Amr" })).toBe(button);
    expect(document.documentElement.style.getPropertyValue("--amr-band-bottom")).toBe(before);
    expect(button.style.bottom).toContain("safe-area-inset-bottom");
    act(() => field.blur());
    expect(screen.getByRole("button", { name: "Ask Amr" })).toBe(button);
    expect(document.documentElement.style.getPropertyValue("--amr-band-bottom")).toBe(before);
  });

  it("leaves wider screens alone", () => {
    stubWidth(false);
    const { container } = render(<MascotAssistant />);
    expect(container.querySelector("[data-amr-band]")).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--amr-band-bottom")).toBe("");
  });
});

describe("phone band variables", () => {
  it("a top band publishes its height and its edge below the header", () => {
    expect(phoneBandVars("top", 120)).toEqual({
      "--amr-band-top": "120px",
      "--amr-band-top-edge": "calc(var(--header-h, 56px) + 120px)",
    });
  });

  it("a bottom band includes the home-indicator inset", () => {
    expect(phoneBandVars("bottom", 120)).toEqual({
      "--amr-band-bottom": "calc(120px + env(safe-area-inset-bottom, 0px))",
    });
  });
});
