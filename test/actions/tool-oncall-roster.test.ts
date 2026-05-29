/**
 * tool.oncall_roster.* coverage (singleton doc, S8).
 *
 *   1. registration — list_state read; shift/page/expected write + hardening.
 *   2. add_shift — valid add; endDate<startDate → {added:false}.
 *   3. log_page — by shiftId (severity tally); unknown shift → {logged:false}.
 *   4. remove_shift — cascades pages tied to the shift.
 *   5. set_expected_pages — round-trips into list_state.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/oncall-roster";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

const call = (verb: string, params: Record<string, unknown>) =>
  registry.get(`tool.oncall_roster.${verb}`)!.handler(params, ctx());
const list = () =>
  call("list_state", {}) as Promise<{
    exists: boolean;
    totalShifts: number;
    totalPages: number;
    expectedPagesPerWeek?: number;
    pagesBySeverity: Record<string, number>;
    pagesByPerson: Record<string, number>;
    shifts: { id: string; person: string; pageCount: number }[];
  }>;

describe("tool.oncall_roster — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.oncall_roster.list_state")?.category).toBe("read");
    for (const verb of [
      "add_shift",
      "remove_shift",
      "log_page",
      "remove_page",
      "set_expected_pages",
    ]) {
      expect(registry.get(`tool.oncall_roster.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.oncall_roster.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.oncall_roster.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.oncall_roster — shifts, pages, cascade", () => {
  beforeEach(() => useWorkspaceStore.setState({ oncallRosters: [] }));

  it("adds shifts, logs pages, tallies, and cascades on remove", async () => {
    const s1 = (await call("add_shift", {
      person: "Ada",
      startDate: "2026-05-01",
      endDate: "2026-05-07",
    })) as { added: boolean; id: string };
    expect(s1.added).toBe(true);

    // invalid window → not added
    const bad = (await call("add_shift", {
      person: "Grace",
      startDate: "2026-05-10",
      endDate: "2026-05-01",
    })) as { added: boolean };
    expect(bad.added).toBe(false);

    let r = await list();
    expect(r.exists).toBe(true);
    expect(r.totalShifts).toBe(1);

    const p1 = (await call("log_page", {
      shiftId: s1.id,
      severity: "sev2",
      description: "DB latency",
    })) as { logged: boolean; id: string };
    expect(p1.logged).toBe(true);
    await call("log_page", { shiftId: s1.id, severity: "sev1" });

    // page on unknown shift → not logged
    const pBad = (await call("log_page", { shiftId: "nope", severity: "sev3" })) as {
      logged: boolean;
    };
    expect(pBad.logged).toBe(false);

    r = await list();
    expect(r.totalPages).toBe(2);
    expect(r.pagesBySeverity.sev1).toBe(1);
    expect(r.pagesBySeverity.sev2).toBe(1);
    expect(r.pagesByPerson.Ada).toBe(2);
    expect(r.shifts[0].pageCount).toBe(2);

    // remove one page
    const rmP = (await call("remove_page", { pageId: p1.id })) as { removed: boolean };
    expect(rmP.removed).toBe(true);
    r = await list();
    expect(r.totalPages).toBe(1);

    // expected pages per week round-trips
    await call("set_expected_pages", { expectedPagesPerWeek: 7 });
    r = await list();
    expect(r.expectedPagesPerWeek).toBe(7);

    // remove shift cascades its remaining page
    const rmS = (await call("remove_shift", { shiftId: s1.id })) as { removed: boolean };
    expect(rmS.removed).toBe(true);
    r = await list();
    expect(r.totalShifts).toBe(0);
    expect(r.totalPages).toBe(0);
  });
});
