/**
 * tool.user_interviews.* coverage (singleton doc, S5).
 *
 *   1. registration — list_state read; add_interview/add_quote write.
 *   2. add_interview + add_quote + list_state — quote count + top tags.
 *   3. add_quote refuses an unknown interview id.
 */

import { describe, it, expect, beforeEach } from "vitest";
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
    // "UX" + "ux" normalise to one tag "ux" with count 2 (quotes), from one participant
    expect(r.topTags[0]).toEqual({ tag: "ux", count: 2, participants: 1 });
  });

  it("add_quote refuses an unknown interview id", async () => {
    const r = (await registry
      .get("tool.user_interviews.add_quote")!
      .handler({ interviewId: "ghost", text: "x" }, ctx())) as { added: boolean };
    expect(r.added).toBe(false);
  });
});
