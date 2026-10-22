import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Interview } from "@/lib/stores/workspace-types";

/**
 * User Interview Log: interviews list + editor, quotes with tags, the theme
 * frequency panel, the privacy banner and the anonymised export.
 */

interface Exported {
  csvData?: { headers: string[]; rows: unknown[][] };
  jsonData?: unknown;
}
const h = vi.hoisted(() => ({
  log: vi.fn(),
  owner: false,
  exported: {} as Exported,
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (props: Exported) => {
    h.exported.csvData = props.csvData;
    h.exported.jsonData = props.jsonData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: h.log }),
}));
vi.mock("@/lib/auth/use-is-owner", () => ({ useIsOwner: () => h.owner }));

import { UserInterviewsClient } from "@/app/(tools)/user-interviews/user-interviews-client";

const UI_ID = "userInterviewLog:current";

const interview = (id: string, patch: Partial<Interview> = {}): Interview => ({
  id,
  date: "2026-10-01",
  participant: `P-${id}`,
  quotes: [],
  ...patch,
});

const quote = (id: string, text: string, tags: string[] = []) => ({ id, text, tags });

const seed = (...interviews: Interview[]) =>
  useWorkspaceStore.setState({ userInterviewLogs: [{ id: UI_ID, interviews }] });

const stored = () =>
  (useWorkspaceStore.getState().userInterviewLogs ?? []).find((d) => d.id === UI_ID)?.interviews ??
  [];

const listButton = (participant: string) =>
  screen.getByText(participant, { selector: "div.truncate" }).closest("button")!;

const commit = (el: HTMLElement, value: string) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};

/** Theme frequency badges, in display order. */
const themes = () =>
  screen.queryByText("Theme Frequency")
    ? Array.from(screen.getByText("Theme Frequency").nextElementSibling!.children).map(
        (b) => b.textContent
      )
    : [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 18, 10, 0));
  h.log.mockClear();
  h.owner = false;
  h.exported.csvData = undefined;
  h.exported.jsonData = undefined;
  useWorkspaceStore.setState({ userInterviewLogs: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("User Interviews — empty state + banner", () => {
  it("asks to select or create an interview and shows no themes", () => {
    render(<UserInterviewsClient />);
    expect(screen.getByText(/Select or create an interview/)).toBeInTheDocument();
    expect(screen.queryByText("Theme Frequency")).not.toBeInTheDocument();
    expect(screen.getByText(/Stored unencrypted in this browser/)).not.toHaveTextContent(
      "synced to your cloud workspace"
    );
    expect(screen.getByRole("checkbox", { name: "Anonymize on export" })).toBeChecked();
  });

  it("tells the owner their interviews also sync to the cloud", () => {
    h.owner = true;
    render(<UserInterviewsClient />);
    expect(screen.getByText(/Stored unencrypted in this browser/)).toHaveTextContent(
      "synced to your cloud workspace"
    );
  });
});

describe("User Interviews — interviews", () => {
  it("adds a new interview dated today at the top and opens it", () => {
    seed(interview("i1"));
    render(<UserInterviewsClient />);
    fireEvent.click(screen.getByRole("button", { name: /New Interview/ }));

    const [added, existing] = stored();
    expect(existing.id).toBe("i1");
    expect(added).toMatchObject({ date: "2026-10-18", participant: "", quotes: [] });
    expect(listButton("(unnamed)")).toHaveAttribute("aria-pressed", "true");
    expect(listButton("P-i1")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Participant name or pseudonym")).toHaveValue("");
    expect(screen.getByLabelText("Interview date")).toHaveValue("2026-10-18");
    expect(h.log).toHaveBeenCalledWith("interview_added", { interviewId: added.id });
  });

  it("opens an interview from the list and shows its quote count", () => {
    seed(
      interview("i1", { quotes: [quote("q1", "a")] }),
      interview("i2", { quotes: [quote("q2", "b"), quote("q3", "c")] })
    );
    render(<UserInterviewsClient />);
    expect(listButton("P-i1")).toHaveTextContent("2026-10-01 · 1 quote");
    expect(listButton("P-i2")).toHaveTextContent("2026-10-01 · 2 quotes");

    fireEvent.click(listButton("P-i2"));
    expect(listButton("P-i2")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Participant name or pseudonym")).toHaveValue("P-i2");
    expect(screen.getByLabelText("Quote 2")).toHaveValue("c");
  });

  it("commits participant, date and context on blur", () => {
    seed(interview("i1"), interview("i2"));
    render(<UserInterviewsClient />);
    fireEvent.click(listButton("P-i2"));

    const participant = screen.getByLabelText("Participant name or pseudonym");
    fireEvent.change(participant, { target: { value: "Dana (PM)" } });
    expect(stored()[1].participant).toBe("P-i2");
    fireEvent.blur(participant);
    commit(screen.getByLabelText("Interview date"), "2026-10-15");
    commit(screen.getByLabelText("Context"), "Uses the mobile app daily");

    expect(stored()[1]).toMatchObject({
      participant: "Dana (PM)",
      date: "2026-10-15",
      context: "Uses the mobile app daily",
    });
    expect(stored()[0]).toEqual(interview("i1"));
    expect(listButton("Dana (PM)")).toHaveTextContent("2026-10-15 · 0 quotes");
  });

  it("deletes the open interview and returns to the empty editor", () => {
    seed(interview("i1"), interview("i2"));
    render(<UserInterviewsClient />);
    fireEvent.click(listButton("P-i1"));
    fireEvent.click(screen.getByRole("button", { name: /Delete Interview/ }));
    expect(stored().map((i) => i.id)).toEqual(["i2"]);
    expect(screen.getByText(/Select or create an interview/)).toBeInTheDocument();
    expect(h.log).toHaveBeenCalledWith("interview_removed", {
      interviewId: "i1",
      participant: "P-i1",
    });
  });

  it("closes the editor when the open interview disappears from the store", () => {
    seed(interview("i1"));
    render(<UserInterviewsClient />);
    fireEvent.click(listButton("P-i1"));
    act(() => seed());
    expect(screen.getByText(/Select or create an interview/)).toBeInTheDocument();
    // A re-appearing interview with the same id is not re-opened silently.
    act(() => seed(interview("i1")));
    expect(listButton("P-i1")).toHaveAttribute("aria-pressed", "false");
  });
});

describe("User Interviews — quotes and tags", () => {
  it("adds a quote, commits its text, and removes the right one", () => {
    seed(interview("i1", { quotes: [quote("q1", "first")] }));
    render(<UserInterviewsClient />);
    fireEvent.click(listButton("P-i1"));
    fireEvent.click(screen.getByRole("button", { name: /Add Quote/ }));
    expect(stored()[0].quotes).toHaveLength(2);
    expect(h.log).toHaveBeenCalledWith("insight_added", { interviewId: "i1" });

    commit(screen.getByLabelText("Quote 2"), "setup took me an hour");
    expect(stored()[0].quotes[1].text).toBe("setup took me an hour");

    fireEvent.click(screen.getByRole("button", { name: "Remove quote 1" }));
    expect(stored()[0].quotes.map((q) => q.text)).toEqual(["setup took me an hour"]);
  });

  it("normalises tags (trim, lowercase, drop empties) on blur and on Enter", () => {
    seed(interview("i1", { quotes: [quote("q1", "a"), quote("q2", "b")] }));
    render(<UserInterviewsClient />);
    fireEvent.click(listButton("P-i1"));

    const tags1 = screen.getByLabelText("Tags for quote 1, comma-separated");
    commit(tags1, " Onboarding ,, UX ,");
    expect(stored()[0].quotes[0].tags).toEqual(["onboarding", "ux"]);
    expect(tags1).toHaveValue("onboarding, ux");

    const tags2 = screen.getByLabelText("Tags for quote 2, comma-separated");
    fireEvent.change(tags2, { target: { value: "ux, pricing" } });
    tags2.focus();
    fireEvent.keyDown(tags2, { key: "Enter" });
    expect(stored()[0].quotes[1].tags).toEqual(["ux", "pricing"]);
  });

  it("keeps a trailing comma while typing", () => {
    seed(interview("i1", { quotes: [quote("q1", "a", ["ux"])] }));
    render(<UserInterviewsClient />);
    fireEvent.click(listButton("P-i1"));
    const tags = screen.getByLabelText("Tags for quote 1, comma-separated");
    fireEvent.change(tags, { target: { value: "ux, " } });
    expect(tags).toHaveValue("ux, ");
  });

  // Bug: "UX, ux" stored the tag twice and counted it twice in the themes.
  it("stores a tag once per quote even when typed twice in different cases", () => {
    seed(interview("i1", { quotes: [quote("q1", "a")] }));
    render(<UserInterviewsClient />);
    fireEvent.click(listButton("P-i1"));
    commit(screen.getByLabelText("Tags for quote 1, comma-separated"), "UX, ux, Pricing");
    expect(stored()[0].quotes[0].tags).toEqual(["ux", "pricing"]);
    expect(themes()).toEqual(["ux · 1", "pricing · 1"]);
  });

  it("ranks themes by frequency across interviews and folds legacy mixed-case tags", () => {
    seed(
      interview("i1", {
        quotes: [quote("q1", "a", ["pricing", "UX"]), quote("q2", "b", ["ux", " "])],
      }),
      interview("i2", { quotes: [quote("q3", "c", ["Ux ", "onboarding"])] })
    );
    render(<UserInterviewsClient />);
    expect(themes()).toEqual(["ux · 3", "pricing · 1", "onboarding · 1"]);
  });

  it("shows at most 24 themes", () => {
    const tags = Array.from({ length: 30 }, (_, i) => `t${i}`);
    seed(interview("i1", { quotes: [quote("q1", "a", tags)] }));
    render(<UserInterviewsClient />);
    expect(themes()).toHaveLength(24);
  });
});

describe("User Interviews — export", () => {
  const withPii = () =>
    seed(
      interview("i1", {
        participant: "Dana Smith",
        context: "Reach me at dana@example.com",
        quotes: [quote("q1", "Email dana@example.com about it", ["ux"])],
      }),
      interview("i2")
    );

  it("redacts participants and PII in quotes by default", () => {
    withPii();
    render(<UserInterviewsClient />);
    expect(h.exported.csvData?.headers).toEqual(["Date", "Participant", "Quote", "Tags"]);
    // One row per quote; i2 has none.
    expect(h.exported.csvData?.rows).toEqual([
      ["2026-10-01", "[redacted]", "Email [redacted:email] about it", "ux"],
    ]);
    const json = h.exported.jsonData as Interview[];
    expect(json[0].participant).toBe("[redacted]");
    expect(json[0].quotes[0].text).toBe("Email [redacted:email] about it");
  });

  // Bug: "Anonymize on export" left the interview context untouched, so an
  // email in it went out in the JSON export.
  it("redacts PII in the interview context too", () => {
    withPii();
    render(<UserInterviewsClient />);
    const json = h.exported.jsonData as Interview[];
    expect(json[0].context).toBe("Reach me at [redacted:email]");
    expect(JSON.stringify(json)).not.toContain("dana@example.com");
    expect(json[1].context).toBeUndefined();
  });

  it("exports raw data when anonymising is switched off", () => {
    withPii();
    render(<UserInterviewsClient />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Anonymize on export" }));
    expect(h.exported.csvData?.rows).toEqual([
      ["2026-10-01", "Dana Smith", "Email dana@example.com about it", "ux"],
    ]);
    expect(h.exported.jsonData).toEqual(stored());
  });
});
