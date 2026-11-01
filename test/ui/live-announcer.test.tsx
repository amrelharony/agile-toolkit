import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { LiveAnnouncerProvider, useAnnounce } from "@/components/a11y/live-announcer";

function Announcer({ message }: { message: string }) {
  const announce = useAnnounce();
  return <button onClick={() => announce(message)}>Say it</button>;
}

describe("LiveAnnouncerProvider", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("announces after the short gap", () => {
    render(
      <LiveAnnouncerProvider>
        <Announcer message="Saved" />
      </LiveAnnouncerProvider>
    );
    act(() => screen.getByRole("button").click());
    expect(screen.getByTestId("live-polite").textContent).toBe("");
    act(() => vi.advanceTimersByTime(50));
    expect(screen.getByTestId("live-polite").textContent).toBe("Saved");
  });

  it("leaves no timer running once it unmounts", () => {
    const { unmount } = render(
      <LiveAnnouncerProvider>
        <Announcer message="Saved" />
      </LiveAnnouncerProvider>
    );
    act(() => screen.getByRole("button").click());
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
