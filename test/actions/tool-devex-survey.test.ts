/**
 * tool.devex_survey.* coverage (singleton doc, S7).
 *
 *   1. registration — list_state read; record_response write + mcpHandler.
 *   2. record_response + list_state — per-metric averages.
 */

import { describe, it, expect, beforeEach } from "vitest";
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
});
