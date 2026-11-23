/**
 * The owner's usage in Amr's panel (src/components/agent/mascot/rate-limit-bar.tsx):
 * quiet words under 75% of the fullest window; from 75%, or once a cap is
 * hit, a narration caption with a meter (its values and aria-valuetext in
 * words), the words and the last reply's tokens in sight with no tooltip,
 * and a capped window named, the weekly one included. Forced colours keep
 * the bar.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RateLimitInfo } from "@/lib/agent/store";

const h = vi.hoisted(() => ({
  fetched: null as RateLimitInfo | null,
}));
vi.mock("@/lib/agent/persist", () => ({
  fetchChatUsage: vi.fn(async () => h.fetched),
}));

import {
  METER_FROM,
  RateLimitBar,
  USAGE_LABEL,
  freesUp,
  lastReplyTokens,
  limitReached,
  usageWindow,
  usageWords,
} from "@/components/agent/mascot/rate-limit-bar";
import { fetchChatUsage } from "@/lib/agent/persist";
import { useAgentStore } from "@/lib/agent/store";

/** A usage snapshot: 12 of 200 today, 40 of 1,000 this week, 90 of 4,000 this month. */
const usage = (over: Partial<RateLimitInfo> = {}): RateLimitInfo => ({
  dailyUsed: 12,
  dailyMax: 200,
  weeklyUsed: 40,
  weeklyMax: 1000,
  monthlyUsed: 90,
  monthlyMax: 4000,
  limited: false,
  ...over,
});

async function renderBar(rl: RateLimitInfo | null, tokens: number | null = null) {
  h.fetched = null;
  useAgentStore.setState({ rateLimit: rl, lastTurnTokens: tokens });
  const view = render(<RateLimitBar />);
  // The read on mount answers (with nothing new here).
  await act(async () => {});
  return view;
}

const bar = () => screen.getByTestId("rate-limit-bar");

beforeEach(() => {
  vi.mocked(fetchChatUsage).mockClear();
});

afterEach(() => {
  useAgentStore.setState({ rateLimit: null, lastTurnTokens: null });
});

describe("RateLimitBar", () => {
  it("shows nothing until a snapshot is in, and reads one (without spending) as it opens", async () => {
    h.fetched = usage({ dailyUsed: 30 });
    useAgentStore.setState({ rateLimit: null, lastTurnTokens: null });
    const { container } = render(<RateLimitBar />);
    expect(container).toBeEmptyDOMElement();
    expect(fetchChatUsage).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(bar()).toHaveTextContent("30 of 200 requests used in the last 24 hours");
  });

  it("stays quiet under 75%: muted words with the last reply's tokens, no meter, no tooltip", async () => {
    await renderBar(usage(), 1234);
    expect(bar()).toHaveAttribute("data-usage", "quiet");
    expect(bar()).toHaveTextContent(
      "12 of 200 requests used in the last 24 hours · Last reply: 1,234 tokens"
    );
    expect(bar()).toHaveClass("text-xs", "text-sub");
    expect(bar().className).not.toMatch(/opacity-/);
    expect(screen.queryByRole("meter")).toBeNull();
    expect(document.querySelector("[title]")).toBeNull();
    // No caption box and no bar for numbers the owner needs only near the cap.
    expect(document.querySelector(".comic-caption")).toBeNull();
    expect(document.querySelector("[data-usage-track]")).toBeNull();
  });

  it("names the fullest window, not always the day", async () => {
    await renderBar(usage({ weeklyUsed: 600 }));
    expect(bar()).toHaveTextContent("600 of 1,000 requests used in the last 7 days");
  });

  it("becomes a meter at 75%: values, words for a screen reader, the same words and tokens in sight", async () => {
    const used = Math.ceil(200 * METER_FROM);
    await renderBar(usage({ dailyUsed: used }), 980);
    const meter = screen.getByRole("meter", { name: USAGE_LABEL });
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "200");
    expect(meter).toHaveAttribute("aria-valuenow", String(used));
    expect(meter).toHaveAttribute(
      "aria-valuetext",
      "150 of 200 requests used in the last 24 hours"
    );
    // In a narration caption, the words in sight as well.
    const caption = meter.closest('[data-voice="narration"]');
    expect(caption).toHaveAttribute("data-tone", "note");
    expect(caption).toHaveTextContent("150 of 200 requests used in the last 24 hours");
    // The token count is in sight, outside the meter (whose insides aren't read), with no tooltip.
    const tokens = screen.getByText(lastReplyTokens(980));
    expect(meter).not.toContainElement(tokens);
    expect(document.querySelector("[title]")).toBeNull();
    // The fill shows the share, in the accent below 90%.
    const fill = document.querySelector<HTMLElement>("[data-usage-fill]")!;
    expect(fill.style.width).toBe("75%");
    expect(fill).toHaveClass("bg-accent");
    expect(fill).not.toHaveClass("bg-destructive");
  });

  it("stays quiet just under 75%", async () => {
    await renderBar(usage({ dailyUsed: 149 }));
    expect(screen.queryByRole("meter")).toBeNull();
  });

  it("turns the fill to the danger colour from 90%", async () => {
    await renderBar(usage({ dailyUsed: 185 }));
    expect(document.querySelector("[data-usage-fill]")).toHaveClass("bg-destructive");
    expect(screen.getByRole("meter").closest('[data-voice="narration"]')).toHaveAttribute(
      "data-tone",
      "note"
    );
  });

  it("names the weekly cap when that is the one that is full, and when it frees up", async () => {
    await renderBar(usage({ dailyUsed: 20, weeklyUsed: 1000, limited: true }), 512);
    const meter = screen.getByRole("meter", { name: USAGE_LABEL });
    expect(meter).toHaveAttribute("aria-valuemax", "1000");
    expect(meter).toHaveAttribute("aria-valuenow", "1000");
    expect(meter).toHaveAttribute(
      "aria-valuetext",
      "1,000 of 1,000 requests used in the last 7 days"
    );
    const caption = meter.closest('[data-voice="narration"]') as HTMLElement;
    expect(caption).toHaveAttribute("data-tone", "error");
    expect(caption).toHaveTextContent(limitReached("weekly"));
    expect(caption).toHaveTextContent("Weekly limit reached.");
    expect(caption).toHaveTextContent(freesUp("weekly"));
    expect(caption).toHaveTextContent("It frees up over a rolling 7 days.");
    // Never the daily window's words for a weekly cap.
    expect(caption).not.toHaveTextContent(/24 hours|Daily/);
    expect(caption).toHaveTextContent(lastReplyTokens(512));
    expect(document.querySelector("[data-usage-fill]")).toHaveClass("bg-destructive");
    // No dashes in the words.
    expect(caption.textContent).not.toMatch(/[–—]/);
  });

  it("names the daily cap when the day is full", async () => {
    await renderBar(usage({ dailyUsed: 200, limited: true }));
    expect(bar()).toHaveTextContent("Daily limit reached.");
    expect(bar()).toHaveTextContent("It frees up over a rolling 24 hours.");
  });

  it("keeps the bar in forced colours: a Highlight fill on a Canvas track in a CanvasText line", async () => {
    await renderBar(usage({ dailyUsed: 160 }));
    const track = document.querySelector("[data-usage-track]")!;
    const fill = document.querySelector("[data-usage-fill]")!;
    expect(track).toHaveClass(
      "border",
      "border-border",
      "bg-card",
      "forced-colors:forced-color-adjust-none",
      "forced-colors:border-[color:CanvasText]",
      "forced-colors:bg-[color:Canvas]"
    );
    expect(fill).toHaveClass("forced-colors:bg-[color:Highlight]");
    // The width moves with the data motion tokens, and never under reduced motion.
    expect(fill).toHaveClass("duration-data", "ease-calm", "motion-reduce:transition-none");
    expect(fill.className).not.toMatch(/transition-all/);
    // Never hex in the classes.
    expect(`${track.className} ${fill.className}`).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe("usageWindow", () => {
  it("picks the fullest window, the shorter on a tie", () => {
    expect(usageWindow(usage())?.key).toBe("daily");
    expect(usageWindow(usage({ dailyUsed: 20, weeklyUsed: 100 }))?.key).toBe("daily");
    expect(usageWindow(usage({ monthlyUsed: 3900 }))?.key).toBe("monthly");
  });

  it("names the full window as the cause once capped, even when another looks fuller", () => {
    const w = usageWindow(usage({ dailyUsed: 199, monthlyUsed: 4000, limited: true }));
    expect(w?.key).toBe("monthly");
  });

  it("has nothing to show without a cap", () => {
    expect(usageWindow(usage({ dailyMax: 0, weeklyMax: 0, monthlyMax: 0 }))).toBeNull();
  });

  it("says one request in the singular", () => {
    expect(usageWords({ key: "daily", used: 0, max: 1 })).toBe(
      "0 of 1 request used in the last 24 hours"
    );
    expect(lastReplyTokens(1)).toBe("Last reply: 1 token");
  });
});
