import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { insertByEventTime, sortByEventTime } from "@/app/(tools)/post-mortem/helpers";

/**
 * Post-mortem: timeline entries were stamped with the time they were typed
 * in, so a timeline rebuilt after the incident had every event at "now".
 * An optional Event time sets when it happened (blank = now), and the
 * timeline stays in event-time order.
 */

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { PostMortemClient } from "@/app/(tools)/post-mortem/post-mortem-client";

const NOW = new Date(2026, 9, 19, 12, 0);
const timeline = () =>
  (useWorkspaceStore.getState().postMortemLogs ?? [])[0]?.postmortems[0]?.timeline ?? [];

function addEntry(text: string, eventTime?: string) {
  if (eventTime !== undefined) {
    fireEvent.change(screen.getByLabelText("Event time"), { target: { value: eventTime } });
  }
  fireEvent.change(screen.getByLabelText("Timeline entry text"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /Entry/ }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  useWorkspaceStore.setState({
    postMortemLogs: [
      {
        id: "postMortem:current",
        postmortems: [
          {
            id: "pm1",
            title: "Checkout outage",
            incidentDate: "2026-10-18",
            status: "draft",
            contributingFactors: [],
            timeline: [],
            actions: [],
          },
        ],
      },
    ] as never,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Post-mortem timeline event time", () => {
  it("stamps an entry with the chosen event time and keeps the timeline in order", () => {
    render(<PostMortemClient />);
    const time = screen.getByLabelText("Event time");
    expect(time).toHaveAttribute("type", "datetime-local");
    expect(time).toHaveAccessibleDescription(/blank to use the current time/);

    addEntry("Alert fired", "2026-10-18T14:05");
    expect(timeline()[0].ts).toBe(new Date(2026, 9, 18, 14, 5).toISOString());
    // The field resets to "now" for the next entry.
    expect(screen.getByLabelText("Event time")).toHaveValue("");

    addEntry("Rolled back"); // blank = now
    addEntry("Deploy went out", "2026-10-18T13:50");
    expect(timeline().map((e) => e.text)).toEqual([
      "Deploy went out",
      "Alert fired",
      "Rolled back",
    ]);
    expect(timeline()[2].ts).toBe(NOW.toISOString());

    const items = screen.getAllByRole("button", { name: /^Remove timeline entry/ });
    expect(items.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Remove timeline entry: Deploy went out",
      "Remove timeline entry: Alert fired",
      "Remove timeline entry: Rolled back",
    ]);
  });
});

describe("Timeline ordering helpers", () => {
  const e = (id: string, ts: string) => ({ id, ts });

  it("inserts by event time, after entries with the same time", () => {
    const tl = [e("a", "2026-10-18T10:00:00Z"), e("b", "2026-10-18T12:00:00Z")];
    expect(insertByEventTime(tl, e("c", "2026-10-18T11:00:00Z")).map((x) => x.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(insertByEventTime(tl, e("d", "2026-10-18T12:00:00Z")).map((x) => x.id)).toEqual([
      "a",
      "b",
      "d",
    ]);
  });

  it("sorts an out-of-order timeline (e.g. agent-appended entries) for display", () => {
    const tl = [e("late", "2026-10-18T12:00:00Z"), e("early", "2026-10-18T09:00:00Z")];
    expect(sortByEventTime(tl).map((x) => x.id)).toEqual(["early", "late"]);
    expect(tl.map((x) => x.id)).toEqual(["late", "early"]);
  });
});
