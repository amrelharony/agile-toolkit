/**
 * RFC Tracker's "Push to Decision Log" writes the one decision record
 * (workspace.decisions), numbered with the log and linking back to the
 * RFC, instead of the Decision Log's old blob, which the log no longer
 * reads.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { DECISION_LOG_KEY } from "@/lib/decisions/legacy-log";
import { pushRfcDecision } from "@/app/(tools)/rfc-tracker/push-decision";

const ws = () => useWorkspaceStore.getState();

const rfc = {
  id: "rfc-1",
  title: " Adopt OpenTelemetry ",
  description: " Traces across services. ",
  decision: " We will instrument the gateway first. ",
  openedAt: "2026-10-01",
  decidedAt: "2026-10-08",
};

beforeEach(() => {
  localStorage.clear();
  useWorkspaceStore.setState({ decisions: [], daciDecisions: [], rapidDecisions: [] });
});

describe("pushRfcDecision", () => {
  it("adds an accepted, numbered ADR raised and decided on the RFC's days, linked back", () => {
    ws().upsertDecision({
      id: "d0",
      title: "Earlier",
      decision: "",
      status: "proposed",
      date: "2026-09-01",
      number: 2,
    });
    const result = pushRfcDecision(rfc, "2026-10-20");
    expect(result.ok).toBe(true);
    const saved = ws().decisions.find((d) => d.sourceRef?.tool === "rfc-tracker")!;
    expect(saved).toEqual({
      id: saved.id,
      title: "Adopt OpenTelemetry",
      context: "Traces across services.",
      decision: "We will instrument the gateway first.",
      status: "accepted",
      date: "2026-10-01",
      decidedAt: "2026-10-08",
      template: "adr",
      sourceRef: { tool: "rfc-tracker", id: "rfc-1" },
      number: 3,
    });
    // The old blob is left alone.
    expect(localStorage.getItem(DECISION_LOG_KEY)).toBeNull();
  });

  it("refuses a second push of the same RFC, and a title the log already has", () => {
    const first = pushRfcDecision(rfc, "2026-10-20");
    expect(first.ok).toBe(true);
    const again = pushRfcDecision({ ...rfc, title: "Renamed since" }, "2026-10-20");
    expect(again).toMatchObject({ ok: false, reason: "already-pushed" });

    // The title of a record still in the old Decision Log's blob counts too.
    localStorage.setItem(
      DECISION_LOG_KEY,
      JSON.stringify([{ id: "old", title: "use feature flags", date: "2026-09-01" }])
    );
    const same = pushRfcDecision({ ...rfc, id: "rfc-2", title: "Use Feature Flags" }, "2026-10-20");
    expect(same).toMatchObject({ ok: false, reason: "same-title", existing: { id: "old" } });
    expect(ws().decisions).toHaveLength(1);
  });

  it("dates a decided RFC with no days today", () => {
    const result = pushRfcDecision({ id: "rfc-3", title: "No days" }, "2026-10-20");
    expect(result.ok && result.decision).toMatchObject({
      date: "2026-10-20",
      decidedAt: "2026-10-20",
      decision: "",
    });
  });
});
