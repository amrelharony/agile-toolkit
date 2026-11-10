import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AuthContextValue } from "@/lib/auth/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story as WorkspaceStory } from "@/lib/stores/workspace-types";

/**
 * Planning Poker's Export menu offers CSV beside Markdown: one row per
 * story with its ticket key (the title when it has none), its summary and
 * the agreed estimate. The key is the backlog story's the session story
 * came from, found through the queue, the logged estimates and the stories
 * "Save to backlog" made.
 */

type Csv = { headers: string[]; rows: (string | number)[][] };
const exported = vi.hoisted(() => ({ csv: undefined as Csv | undefined }));
const h = vi.hoisted(() => ({ auth: null as Partial<AuthContextValue> | null }));

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => h.auth }));
vi.mock("@/lib/realtime/supabase-client", () => ({
  isRealtimeAvailable: () => false,
  getSupabaseClient: () => null,
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: Csv }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
vi.mock("@/lib/utils/undoable", () => ({ undoable: (a: { apply: () => void }) => a.apply() }));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const motionProps = new Set([
    "initial",
    "animate",
    "exit",
    "transition",
    "layout",
    "whileHover",
    "whileTap",
  ]);
  const strip = (props: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(props).filter(([key]) => !motionProps.has(key)));
  const cache = new Map<string, unknown>();
  const component = (tag: string) => {
    if (!cache.has(tag)) {
      const C = React.forwardRef<HTMLElement, Record<string, unknown>>((props, ref) =>
        React.createElement(tag, { ...strip(props), ref })
      );
      C.displayName = `Motion(${tag})`;
      cache.set(tag, C);
    }
    return cache.get(tag);
  };
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: new Proxy({}, { get: (_target, tag: string) => component(tag) }),
  };
});

import { PlanningPokerClient } from "@/app/(tools)/planning-poker/planning-poker-client";
import { LOCAL_SESSION_KEY } from "@/app/(tools)/planning-poker/local-session";
import { POKER_CSV_HEADERS, pokerCsv, sessionTicketKeys } from "@/app/(tools)/planning-poker/csv";
import type { Session } from "@/app/(tools)/planning-poker/types";
import { POKER_LOG_ID } from "@/lib/handoffs/targets/poker-queue";

function session(overrides: Partial<Session> = {}): Session {
  return {
    roomCode: "ABC234",
    sessionName: "Refinement",
    scale: ["1", "2", "3", "5", "8", "13", "?"],
    scaleType: "fibonacci",
    host: "Scrum Master",
    hostId: "me",
    participants: [{ id: "me", name: "Scrum Master", vote: null }],
    stories: [],
    currentStoryIdx: 0,
    revealed: false,
    ...overrides,
  };
}

const STORIES: Session["stories"] = [
  { id: "s-queued", title: "Fraud checks", finalEstimate: null },
  { id: "s-done", title: "Pay with a saved card", finalEstimate: "5" },
  { id: "s-saved", title: "Receipts by email", finalEstimate: "0.5" },
  { id: "s-typed", title: "Gift\ncards", finalEstimate: "M" },
  { id: "s-open", title: "Refunds", finalEstimate: null },
];

const BACKLOG: WorkspaceStory[] = [
  { id: "st-fraud", title: "Fraud checks", status: "backlog", ticketKey: "PAY-7" },
  { id: "st-card", title: "Pay with a saved card", status: "todo", ticketKey: "PAY-12" },
  {
    id: "st-receipts",
    title: "Receipts by email",
    status: "backlog",
    ticketKey: "PAY-30",
    sourceRef: { tool: "planning-poker", id: "s-saved" },
  },
  // Same title as a session story, but never queued: not a match.
  { id: "st-refunds", title: "Refunds", status: "backlog", ticketKey: "PAY-99" },
];

const SOURCES = {
  queue: [
    {
      id: "q1",
      title: "Fraud checks",
      sourceRef: { tool: "story", id: "st-fraud" },
      queuedAt: "2026-11-01T09:00:00.000Z",
      sessionStoryId: "s-queued",
    },
  ],
  estimates: [
    {
      id: "q0",
      storyTitle: " pay with a  saved card ",
      finalEstimate: "3",
      scaleType: "fibonacci",
      decidedAt: "2026-11-01T09:05:00.000Z",
      sourceRef: { tool: "story", id: "st-card" },
    },
  ],
  stories: BACKLOG,
};

beforeEach(() => {
  exported.csv = undefined;
  h.auth = { status: "anonymous", user: null };
  window.localStorage.clear();
  useWorkspaceStore.setState({ stories: [], pokerEstimationLogs: [] });
});

describe("the ticket key of a session story", () => {
  it("comes from the queue, the logged estimates or the story saved to the backlog", () => {
    const keys = sessionTicketKeys(STORIES, SOURCES);
    expect(Object.fromEntries(keys)).toEqual({
      // Still on the queue: matched by the id the queue stamped.
      "s-queued": "PAY-7",
      // Estimated, so off the queue: matched by title against the log,
      // whatever was accepted since.
      "s-done": "PAY-12",
      // Typed here, then saved to the backlog.
      "s-saved": "PAY-30",
    });
  });

  it("is absent without a workspace story, or when that story has no key", () => {
    expect(sessionTicketKeys(STORIES, { stories: [] }).size).toBe(0);
    const noKeys = BACKLOG.map((s) => ({ ...s, ticketKey: undefined }));
    expect(sessionTicketKeys(STORIES, { ...SOURCES, stories: noKeys }).size).toBe(0);
    // A logged estimate whose story was deleted since matches nothing.
    const gone = BACKLOG.filter((s) => s.id !== "st-card");
    expect(sessionTicketKeys(STORIES, { ...SOURCES, stories: gone }).has("s-done")).toBe(false);
  });
});

describe("Planning Poker results as CSV", () => {
  it("has a row per story: ticket key or title, summary, story points", () => {
    const csv = pokerCsv(session({ stories: STORIES }), sessionTicketKeys(STORIES, SOURCES));
    expect(csv).toEqual({
      headers: ["Ticket key or title", "Summary", "Story points"],
      rows: [
        ["PAY-7", "Fraud checks", ""],
        ["PAY-12", "Pay with a saved card", 5],
        ["PAY-30", "Receipts by email", 0.5],
        // No key: the title stands in. A T-shirt size stays as written.
        ["Gift cards", "Gift cards", "M"],
        ["Refunds", "Refunds", ""],
      ],
    });
    expect(csv?.headers).toBe(POKER_CSV_HEADERS);
  });

  it("is nothing to export without stories", () => {
    expect(pokerCsv(null)).toBeUndefined();
    expect(pokerCsv(session())).toBeUndefined();
  });

  it("is handed to the Export menu with the keys this browser knows", () => {
    useWorkspaceStore.setState({
      stories: BACKLOG,
      pokerEstimationLogs: [
        { id: POKER_LOG_ID, estimates: SOURCES.estimates, queue: SOURCES.queue },
      ],
    });
    window.localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session({ stories: STORIES })));
    render(<PlanningPokerClient />);
    expect(exported.csv?.rows).toEqual([
      ["PAY-7", "Fraud checks", ""],
      ["PAY-12", "Pay with a saved card", 5],
      ["PAY-30", "Receipts by email", 0.5],
      ["Gift cards", "Gift cards", "M"],
      ["Refunds", "Refunds", ""],
    ]);
  });
});
