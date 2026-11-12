import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  VISITOR_ROOM_CONSENT_TEXT,
  WALL_ROOM_CONSENT_TEXT,
  VisitorRoomConsent,
} from "@/components/collab/visitor-room-consent";
import * as disclosures from "@/lib/site/disclosures";

/**
 * The consent step before a show room and a wall room. A wall room's text
 * says what happens to a post: shared with the room without a name, kept
 * by the host only as anonymous text, a raised hand named, and the AI line.
 */

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function renderConsent(variant: "show" | "wall") {
  const onConfirm = vi.fn();
  render(
    <VisitorRoomConsent
      open
      mode="join"
      variant={variant}
      toolName={variant === "wall" ? "Audience Wall" : "Picker"}
      onConfirm={onConfirm}
      onOpenChange={() => {}}
    />
  );
  return { onConfirm, dialog: screen.getByRole("dialog") };
}

describe("the wall room's consent", () => {
  it("is lib/site/disclosures.ts's text, and the dialog's description", () => {
    expect(WALL_ROOM_CONSENT_TEXT).toBe(disclosures.WALL_ROOM_CONSENT_TEXT);
    const { dialog } = renderConsent("wall");
    expect(dialog).toHaveAccessibleDescription(WALL_ROOM_CONSENT_TEXT);
    expect(
      within(dialog).getByRole("checkbox", { name: /sees my posts, without my name/ })
    ).toBeVisible();
  });

  it("says what is shared, what the host may keep, and that no names are kept", () => {
    expect(WALL_ROOM_CONSENT_TEXT).toMatch(/without your name/);
    expect(WALL_ROOM_CONSENT_TEXT).toMatch(/save the posts and their votes as anonymous text/);
    expect(WALL_ROOM_CONSENT_TEXT).toMatch(/no names are kept/);
    expect(WALL_ROOM_CONSENT_TEXT).toMatch(/raise your hand/);
    expect(WALL_ROOM_CONSENT_TEXT).toMatch(/realtime provider \(Supabase\)/);
    expect(WALL_ROOM_CONSENT_TEXT).toMatch(/AI service/);
    expect(WALL_ROOM_CONSENT_TEXT).toMatch(/Share the link only with your team\.$/);
  });

  it("still asks for a name and the box before it confirms", () => {
    const { onConfirm, dialog } = renderConsent("wall");
    fireEvent.change(within(dialog).getByLabelText(/your name/i), { target: { value: "Sam" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Join room" }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Join room" }));
    expect(onConfirm).toHaveBeenCalledWith("Sam");
  });
});

describe("the show room's consent", () => {
  it("uses the live-room notice and asks about the name only", () => {
    const { dialog } = renderConsent("show");
    expect(dialog).toHaveAccessibleDescription(VISITOR_ROOM_CONSENT_TEXT);
    expect(
      within(dialog).getByRole("checkbox", {
        name: "I understand that everyone in the room sees my name.",
      })
    ).toBeVisible();
  });
});
