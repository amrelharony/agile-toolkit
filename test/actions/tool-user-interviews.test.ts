/**
 * tool.user_interviews.* coverage (singleton doc, S5).
 *
 *   1. registration — list_state read; add_interview/add_quote write.
 *   2. add_interview + add_quote + list_state — quote count + top tags.
 *   3. add_quote refuses an unknown interview id.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/user-interviews";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.user_interviews — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.user_interviews.list_state")?.category).toBe("read");
    for (const verb of ["add_interview", "add_quote"]) {
      expect(registry.get(`tool.user_interviews.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.user_interviews.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.user_interviews.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.user_interviews lifecycle", () => {
  beforeEach(() => useWorkspaceStore.setState({ userInterviewLogs: [] }));

  it("adds an interview + tagged quotes and ranks tags", async () => {
    const iv = (await registry
      .get("tool.user_interviews.add_interview")!
      .handler({ participant: "P1" }, ctx())) as { added: boolean; id: string };
    expect(iv.added).toBe(true);

    await registry
      .get("tool.user_interviews.add_quote")!
      .handler({ interviewId: iv.id, text: "I hate the setup", tags: ["UX", "onboarding"] }, ctx());
    await registry
      .get("tool.user_interviews.add_quote")!
      .handler({ interviewId: iv.id, text: "setup is confusing", tags: ["ux"] }, ctx());

    const r = (await registry.get("tool.user_interviews.list_state")!.handler({}, ctx())) as {
      totalInterviews: number;
      totalQuotes: number;
      topTags: { tag: string; count: number }[];
    };
    expect(r.totalInterviews).toBe(1);
    expect(r.totalQuotes).toBe(2);
    // "UX" + "ux" normalise to one tag "ux" with count 2
    expect(r.topTags[0]).toEqual({ tag: "ux", count: 2 });
  });

  it("add_quote refuses an unknown interview id", async () => {
    const r = (await registry
      .get("tool.user_interviews.add_quote")!
      .handler({ interviewId: "ghost", text: "x" }, ctx())) as { added: boolean };
    expect(r.added).toBe(false);
  });
});

describe("tool.user_interviews details", () => {
  beforeEach(() => useWorkspaceStore.setState({ userInterviewLogs: [] }));
  afterEach(() => {
    vi.useRealTimers();
  });

  const interviews = () => (useWorkspaceStore.getState().userInterviewLogs ?? [])[0].interviews;

  // Bug: the default date was the UTC day, so near midnight an agent-logged
  // interview was dated a day off from the local day the tool shows.
  it("dates an interview with the local calendar day by default", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(
      new Date(2026, 9, 18, 12).getTimezoneOffset() < 0
        ? new Date(2026, 9, 18, 0, 30)
        : new Date(2026, 9, 18, 23, 30)
    );
    await registry.get("tool.user_interviews.add_interview")!.handler({ participant: "P1" }, ctx());
    expect(interviews()[0].date).toBe("2026-10-18");
  });

  it("keeps an explicit date and the context", async () => {
    await registry
      .get("tool.user_interviews.add_interview")!
      .handler({ participant: "P1", date: "2026-09-30", context: "power user" }, ctx());
    expect(interviews()[0]).toMatchObject({
      participant: "P1",
      date: "2026-09-30",
      context: "power user",
      quotes: [],
    });
  });

  // Bug: the same tag typed twice (any case) was stored twice and double-counted.
  it("add_quote stores each normalised tag once and drops blanks", async () => {
    const iv = (await registry
      .get("tool.user_interviews.add_interview")!
      .handler({ participant: "P1" }, ctx())) as { id: string };
    await registry
      .get("tool.user_interviews.add_quote")!
      .handler({ interviewId: iv.id, text: "q", tags: ["UX", " ux ", "", "Pricing"] }, ctx());
    expect(interviews()[0].quotes[0].tags).toEqual(["ux", "pricing"]);
    const r = (await registry.get("tool.user_interviews.list_state")!.handler({}, ctx())) as {
      topTags: { tag: string; count: number }[];
    };
    expect(r.topTags).toEqual([
      { tag: "ux", count: 1 },
      { tag: "pricing", count: 1 },
    ]);
  });

  it("list_state returns at most the top 5 tags, most frequent first", async () => {
    const iv = (await registry
      .get("tool.user_interviews.add_interview")!
      .handler({ participant: "P1" }, ctx())) as { id: string };
    const add = (tags: string[]) =>
      registry
        .get("tool.user_interviews.add_quote")!
        .handler({ interviewId: iv.id, text: "q", tags }, ctx());
    await add(["a", "b", "c", "d", "e", "f"]);
    await add(["f"]);
    const r = (await registry.get("tool.user_interviews.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      totalQuotes: number;
      topTags: { tag: string; count: number }[];
    };
    expect(r.exists).toBe(true);
    expect(r.totalQuotes).toBe(2);
    expect(r.topTags).toHaveLength(5);
    expect(r.topTags[0]).toEqual({ tag: "f", count: 2 });
  });
});
