import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Owner state comes from useAuthOptional (via useIsOwner).
const h = vi.hoisted(() => ({
  auth: null as { status: string; user: { id: string } | null } | null,
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));

import { YourDataDialog } from "@/components/data/your-data-dialog";

const COUNTS =
  "The comics and kudos pages do send anonymous counts: which printed piece brought you there, if any, and on a weekly story whether you opened and finished it, roughly how long you read, and your answers, love, share, retro hand-off or click on its tool.";
const COUNTS_ANON = "Those counts don't say who you are.";

function description(): string {
  render(<YourDataDialog open onOpenChange={() => {}} />);
  const dialog = screen.getByRole("dialog", { name: "Your data" });
  const id = dialog.getAttribute("aria-describedby");
  return document.getElementById(id ?? "")?.textContent ?? "";
}

const ROOMS =
  "If you start or join a live room, what you type there passes through our realtime provider (Supabase) to everyone with the link, and we don't store it.";
const AI =
  "If you choose to chat with Amr's AI, your messages and what Amr reads from your tools to answer are sent to write the reply, and the site keeps only a daily message count.";

// What the dialog tells a visitor must stay true when live rooms or visitor AI
// are on: both send what the visitor types off this browser.
describe("YourDataDialog: what a visitor is told", () => {
  beforeEach(() => {
    h.auth = null;
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("with live rooms and visitor AI both off, says nothing is sent to the servers", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
    expect(description()).toBe(
      `Everything you make in the toolkit is saved in this browser only, and none of it is sent to our servers. ${COUNTS} None of it says who you are.`
    );
  });

  it("with visitor AI on, names the chat with Amr's AI and drops the absolute", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "1");
    const text = description();
    expect(text).toBe(
      `Everything you make in the toolkit is saved in this browser only. ${AI} ${COUNTS} ${COUNTS_ANON}`
    );
    expect(text).not.toContain("none of it is sent to our servers");
  });

  it("with live rooms on and visitor AI off, names the rooms and drops the absolute", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
    const text = description();
    expect(text).toBe(
      `Everything you make in the toolkit is saved in this browser only. ${ROOMS} ${COUNTS} ${COUNTS_ANON}`
    );
    expect(text).not.toContain("none of it is sent to our servers");
  });

  it("with both on, names the rooms and then the chat", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "1");
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
    expect(description()).toBe(
      `Everything you make in the toolkit is saved in this browser only. ${ROOMS} ${AI} ${COUNTS} ${COUNTS_ANON}`
    );
  });

  it("with visitor AI on, leaves the owner's text as it was", () => {
    h.auth = { status: "authenticated", user: { id: "u1" } };
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "1");
    expect(description()).toBe("Your work syncs to your account and is also kept in this browser.");
  });
});
