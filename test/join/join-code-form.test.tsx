import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * `/join`'s "type a code" box: any case, spaces, dashes or the whole link;
 * a link goes straight to its room (its channel names the tool, and it
 * carries the host's key); a bare code asks which of the rooms a code alone
 * can open (Poker, Retro), and says why the others need the QR code or link.
 */

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: nav.push }),
}));

import JoinPage from "@/app/join/page";
import { JoinCodeForm } from "@/app/join/join-code-form";

const CODE = "ABCD2345EFGH";
const FP = "abcdefghijklmnopqrstuv";

function type(text: string) {
  fireEvent.change(screen.getByLabelText("Room code"), { target: { value: text } });
}

function join() {
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  nav.push.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("the /join page", () => {
  it("offers the code box, filled from ?code=", () => {
    render(JoinPage({ searchParams: { code: "abcd-2345-efgh" } }));
    expect(screen.getByRole("heading", { name: "Join a live room" })).toBeInTheDocument();
    expect(screen.getByLabelText("Room code")).toHaveValue("abcd-2345-efgh");
    // Reading it back grouped, before anything connects.
    expect(screen.getByText("ABCD-2345-EFGH")).toBeInTheDocument();
  });

  it("says live rooms are off with the flag off", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "");
    render(JoinPage({ searchParams: {} }));
    expect(screen.getByRole("heading", { name: "Live rooms are off" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Room code")).toBeNull();
  });
});

describe("typing a code", () => {
  it.each([
    "ABCD-2345-EFGH",
    "abcd 2345 efgh",
    "  aBcD2345eFgH  ",
    "ABCD – 2345 – EFGH",
    "ＡＢＣＤ２３４５ＥＦＧＨ",
  ])("reads %j as the room's code and asks which room it is", (typed) => {
    render(<JoinCodeForm />);
    type(typed);
    join();
    expect(nav.push).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Which room is ABCD-2345-EFGH?" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retro" }));
    expect(nav.push).toHaveBeenCalledWith(`/join/retro/${CODE}`);
  });

  it("explains why a vote, picker, wall or card deck needs the QR code or link", () => {
    render(<JoinCodeForm />);
    type(CODE);
    join();
    expect(screen.getByText(/needs its QR code or link/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Planning Poker" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quick Vote" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Type another code" }));
    expect(screen.getByLabelText("Room code")).toHaveValue(CODE);
  });

  it("goes straight to the room of a pasted link, keeping the host's key", () => {
    render(<JoinCodeForm />);
    type(`https://agile.example.test/join/quick-vote/${CODE.toLowerCase()}#k=${FP}`);
    join();
    expect(nav.push).toHaveBeenCalledWith(`/join/quick-vote/${CODE}#k=${FP}`);
  });

  it("stops a signed room's link that lost its key, and says how to get it again", () => {
    render(<JoinCodeForm />);
    type(`/join/audience-wall/${CODE}`);
    join();
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/missing the part that proves/);
  });

  it("says which look-alike can't be in a code, without guessing", () => {
    render(<JoinCodeForm />);
    type("ABCD-2345-EFG0");
    join();
    expect(screen.getByRole("alert")).toHaveTextContent(
      'Room codes never use 0, O, 1, I or L, so "0" must be another character.'
    );
    expect(screen.getByLabelText("Room code")).toHaveFocus();
    expect(screen.getByLabelText("Room code")).toHaveAttribute("aria-invalid", "true");
    // Fixing it clears the error.
    type("ABCD-2345-EFGH");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("counts the characters of a code that's too short", () => {
    render(<JoinCodeForm />);
    type("ABCD-2345");
    join();
    expect(screen.getByRole("alert")).toHaveTextContent("That's 8 characters. A room code has 12.");
  });
});
