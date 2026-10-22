/**
 * tool.devex_survey.* coverage (singleton doc, S7).
 *
 *   1. registration — list_state read; record_response write + mcpHandler.
 *   2. record_response + list_state — per-metric averages.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/devex-survey";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.devex_survey — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.devex_survey.list_state")?.category).toBe("read");
    expect(registry.get("tool.devex_survey.record_response")?.category).toBe("write");
    expect(registry.get("tool.devex_survey.record_response")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.devex_survey.record_response")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.devex_survey.record_response + list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ devexSurveys: [] }));

  it("averages the 3 metrics", async () => {
    await registry
      .get("tool.devex_survey.record_response")!
      .handler({ flowState: 4, feedbackLoops: 2, cognitiveLoad: 3 }, ctx());
    await registry
      .get("tool.devex_survey.record_response")!
      .handler({ flowState: 2, feedbackLoops: 4, cognitiveLoad: 1 }, ctx());

    const r = (await registry.get("tool.devex_survey.list_state")!.handler({}, ctx())) as {
      total: number;
      averages: { flowState: number; feedbackLoops: number; cognitiveLoad: number };
    };
    expect(r.total).toBe(2);
    expect(r.averages.flowState).toBe(3); // (4+2)/2
    expect(r.averages.feedbackLoops).toBe(3); // (2+4)/2
    expect(r.averages.cognitiveLoad).toBe(2); // (3+1)/2
  });

  const record = (params: Record<string, unknown>) =>
    registry
      .get("tool.devex_survey.record_response")!
      .handler({ flowState: 3, feedbackLoops: 3, cognitiveLoad: 3, ...params }, ctx());
  const responses = () => (useWorkspaceStore.getState().devexSurveys ?? [])[0]?.responses ?? [];

  it("returns zero averages when empty", async () => {
    const r = (await registry.get("tool.devex_survey.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      total: number;
      averages: { flowState: number };
    };
    expect(r).toMatchObject({ exists: false, total: 0, averages: { flowState: 0 } });
  });

  it("keeps an explicit date, respondent and comments", async () => {
    await record({ date: "2026-09-01", respondent: "Ana", comments: "CI is slow" });
    expect(responses()[0]).toMatchObject({
      date: "2026-09-01",
      respondent: "Ana",
      comments: "CI is slow",
    });
  });

  // Bug: the default date came from toISOString() (UTC), so just after local
  // midnight east of UTC an agent-logged response landed on yesterday, while
  // the form (todayLocalISO) logs today.
  it("defaults the date to the local today, not the UTC one", async () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    process.env.TZ = "Asia/Tokyo"; // UTC+9, no DST
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 9, 18, 0, 30)); // 2026-10-17T15:30Z
      await record({});
      expect(responses()[0].date).toBe("2026-10-18");
      expect(responses()[0].respondent).toBe("");
    } finally {
      vi.useRealTimers();
      process.env.TZ = zone;
    }
  });
});
