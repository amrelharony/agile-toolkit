import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TOUCH_LINK } from "@/components/ui/touch-target";

/**
 * Sign-in page: "Back to the toolkit", the squad-invite link and the footer
 * credit are standalone links, so they get a 44px target on touch screens.
 */

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth/supabase-browser", () => ({ getAuthBrowserClient: () => null }));

import { SignInCard } from "@/app/auth/sign-in/sign-in-card";
import SignInPage from "@/app/auth/sign-in/page";

const classes = (s: string) => s.split(/\s+/).filter(Boolean);

describe("sign-in page", () => {
  it("pads 'Back to the toolkit' and the squad-invite link on touch", () => {
    render(<SignInCard />);
    expect(screen.getByRole("link", { name: "Back to the toolkit" })).toHaveClass(
      ...classes(TOUCH_LINK),
      "pt-2"
    );
    expect(screen.getByRole("link", { name: /Join with a squad invite code/ })).toHaveClass(
      "pointer-coarse:min-h-11",
      "py-2"
    );
  });

  it("gives the footer credit a 44px touch target", () => {
    render(<SignInPage />);
    const credit = screen.getByRole("link", { name: "Amr Elharony" });
    expect(credit).toHaveClass(...classes(TOUCH_LINK), "underline");
    expect(credit).toHaveAttribute("href", "https://amrelharony.com");
  });
});
