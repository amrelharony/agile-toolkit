import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastMock }));

import { VisitorRoomChip } from "@/components/collab/visitor-room-chip";

const CODE = "ABCDEFGHJKMN";

function withAnnouncer({ children }: { children: ReactNode }) {
  return <LiveAnnouncerProvider>{children}</LiveAnnouncerProvider>;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  toastMock.success.mockClear();
  toastMock.error.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("VisitorRoomChip", () => {
  it("shows the code and how full the room is", () => {
    render(<VisitorRoomChip tool="planning-poker" code={CODE} memberCount={3} isHost />);
    expect(screen.getByText(CODE)).toBeVisible();
    expect(screen.getByText("3/20")).toBeVisible();
    expect(screen.getByText("3 of 20 people")).toBeInTheDocument();
  });

  it("copies the join link built from the page origin", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<VisitorRoomChip tool="retro" code={CODE} memberCount={1} isHost />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    });
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/retro/${CODE}`);
    expect(toastMock.success).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Copied" })).toBeVisible();
  });

  it("appends a link fragment such as a vote round's #k= host key", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const fp = "abcdefghijklmnopqrstuv";
    render(
      <VisitorRoomChip
        tool="health-check"
        code={CODE}
        memberCount={1}
        isHost
        linkFragment={`#k=${fp}`}
      />
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    });
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/join/health-check/${CODE}#k=${fp}`
    );
  });

  it("ignores a fragment that isn't a short, URL-safe #fragment", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(
      <VisitorRoomChip tool="retro" code={CODE} memberCount={1} isHost linkFragment={"k=no-hash"} />
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    });
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/retro/${CODE}`);
  });

  it("shows the link in a toast when the clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<VisitorRoomChip tool="retro" code={CODE} memberCount={1} isHost />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    });
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining(`/join/retro/${CODE}`));
  });

  it("gives the host End room and a participant Leave", () => {
    const onEnd = vi.fn();
    const onLeave = vi.fn();
    const { rerender } = render(
      <VisitorRoomChip
        tool="retro"
        code={CODE}
        memberCount={2}
        isHost
        onEnd={onEnd}
        onLeave={onLeave}
      />
    );
    expect(screen.queryByRole("button", { name: "Leave" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "End room" }));
    expect(onEnd).toHaveBeenCalledTimes(1);

    rerender(
      <VisitorRoomChip
        tool="retro"
        code={CODE}
        memberCount={2}
        isHost={false}
        onEnd={onEnd}
        onLeave={onLeave}
      />
    );
    expect(screen.queryByRole("button", { name: "End room" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("announces joins and leaves politely", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <VisitorRoomChip tool="retro" code={CODE} memberCount={2} isHost />,
      { wrapper: withAnnouncer }
    );
    const polite = screen.getByTestId("live-polite");
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(polite).toHaveTextContent("");

    rerender(<VisitorRoomChip tool="retro" code={CODE} memberCount={3} isHost />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(polite).toHaveTextContent("Someone joined. 3 of 20 people in the room.");

    rerender(<VisitorRoomChip tool="retro" code={CODE} memberCount={2} isHost />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(polite).toHaveTextContent("Someone left. 2 of 20 people in the room.");
  });

  it("renders nothing with the flag off or for a malformed code", () => {
    const { container, rerender } = render(
      <VisitorRoomChip tool="retro" code="ABC123" memberCount={1} isHost />
    );
    expect(container).toBeEmptyDOMElement();
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "");
    rerender(<VisitorRoomChip tool="retro" code={CODE} memberCount={1} isHost />);
    expect(container).toBeEmptyDOMElement();
  });
});
