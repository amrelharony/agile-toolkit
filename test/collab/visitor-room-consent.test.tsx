import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  VISITOR_ROOM_CONSENT_TEXT,
  VOTE_ROOM_CONSENT_TEXT,
  VisitorRoomConsent,
  type VisitorRoomConsentProps,
} from "@/components/collab/visitor-room-consent";

function renderConsent(props: Partial<VisitorRoomConsentProps> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    <VisitorRoomConsent
      open
      mode="join"
      toolName="Planning Poker"
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      {...props}
    />
  );
  const nameInput = () => screen.getByLabelText(/your name/i);
  const consentBox = () => screen.getByRole("checkbox");
  const submit = () =>
    fireEvent.click(screen.getByRole("button", { name: /join room|start room/i }));
  return { ...utils, onConfirm, onOpenChange, nameInput, consentBox, submit };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("VisitorRoomConsent", () => {
  it("states plainly where the text goes, who sees it and that it isn't stored", () => {
    renderConsent();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(VISITOR_ROOM_CONSENT_TEXT);
    expect(VISITOR_ROOM_CONSENT_TEXT).toBe(
      "What you type passes through our realtime provider (Supabase) to everyone with the link. " +
        "We don't store it; the room disappears when everyone leaves. " +
        "The host may send the room's answers, without names, to an AI service for a summary. " +
        "Emoji reactions carry your room id, so others in the room could tell who sent one. " +
        "Share the link only with your team."
    );
    // The wording is the dialog's accessible description.
    expect(dialog).toHaveAccessibleDescription(VISITOR_ROOM_CONSENT_TEXT);
    expect(
      screen.getByRole("heading", { name: "Join the live Planning Poker room" })
    ).toBeVisible();
  });

  it("offers Start in start mode", () => {
    renderConsent({ mode: "start", toolName: "Retro" });
    expect(screen.getByRole("heading", { name: "Start a live Retro room" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Start room" })).toBeVisible();
  });

  it("tells vote-round participants their answers are encrypted and only totals are kept", () => {
    renderConsent({ variant: "vote", mode: "join", toolName: "Health Check" });
    const dialog = screen.getByRole("dialog");
    expect(VOTE_ROOM_CONSENT_TEXT).toBe(
      "Answers are encrypted in each person's browser, so only the host's browser can read them, " +
        "and it keeps the totals only. They pass through our realtime provider (Supabase). " +
        "Others in the room see your name and whether you've answered, not what. " +
        "After the host reveals the results, everyone in the room sees the totals, for questions " +
        "with enough answers; if everyone gives the same answer, the totals show it. " +
        "In a number round the host's browser keeps the numbers without names, and the results show " +
        "the median, lowest and highest answers as they are. " +
        "The host may send the room's answers, without names, to an AI service for a summary. " +
        "Emoji reactions carry your room id, so others in the room could tell who sent one. " +
        "Share the link only with your team."
    );
    // It promises no more than the round can keep.
    expect(VOTE_ROOM_CONSENT_TEXT).not.toMatch(/never|anonymous/i);
    expect(dialog).toHaveAccessibleDescription(VOTE_ROOM_CONSENT_TEXT);
    expect(dialog).not.toHaveTextContent(VISITOR_ROOM_CONSENT_TEXT);
    expect(
      screen.getByRole("checkbox", {
        name: "I understand that everyone in the room sees my name and whether I've answered.",
      })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Join the live Health Check room" })).toBeVisible();
  });

  it("keeps the board text by default", () => {
    renderConsent();
    expect(
      screen.getByRole("checkbox", {
        name: "I understand that anyone with the link can see what I type.",
      })
    ).toBeInTheDocument();
  });

  it("does not call back without a name, even with consent ticked", () => {
    const { onConfirm, consentBox, submit } = renderConsent();
    fireEvent.click(consentBox());
    submit();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your name.");
  });

  it("does not call back without consent, even with a name", () => {
    const { onConfirm, nameInput, submit } = renderConsent();
    fireEvent.change(nameInput(), { target: { value: "Sam" } });
    submit();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/tick the box/i);
  });

  it("refuses a name with bidi or control characters", () => {
    const { onConfirm, nameInput, consentBox, submit } = renderConsent();
    fireEvent.change(nameInput(), { target: { value: "Sam‮evil" } });
    fireEvent.click(consentBox());
    submit();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
  });

  it("calls back once with the cleaned name after name and consent", () => {
    const { onConfirm, nameInput, consentBox, submit } = renderConsent();
    fireEvent.change(nameInput(), { target: { value: "  Sam   Lee " } });
    fireEvent.click(consentBox());
    submit();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("Sam Lee");
  });

  it("starts with consent unticked every time it opens", () => {
    const { rerender, onConfirm, consentBox, submit } = renderConsent({ defaultName: "Sam" });
    fireEvent.click(consentBox());
    expect(consentBox()).toBeChecked();
    const props = {
      mode: "join" as const,
      toolName: "Retro",
      onConfirm,
      onOpenChange: vi.fn(),
      defaultName: "Sam",
    };
    rerender(<VisitorRoomConsent open={false} {...props} />);
    rerender(<VisitorRoomConsent open {...props} />);
    expect(consentBox()).not.toBeChecked();
    submit();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Cancel closes without calling back", () => {
    const { onConfirm, onOpenChange } = renderConsent();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders nothing with the flag off", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "");
    renderConsent();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
