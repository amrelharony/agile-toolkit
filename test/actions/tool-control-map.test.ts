/**
 * tool.control_map.* coverage (singleton doc, S9).
 *
 *   1. registration — list_state read; add_control/set_status/add_evidence
 *      write + mcpHandler + no confirm.
 *   2. add_control + list_state — byFramework/byStatus/implementedCount/coverage.
 *   3. set_status — updates by row id; unknown → {updated:false}.
 *   4. add_evidence — appends a link to a control.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ControlMap } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/control-map";

const CM_ID = "controlMap:current";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.control_map — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.control_map.list_state")?.category).toBe("read");
    for (const verb of ["add_control", "set_status", "add_evidence"]) {
      expect(registry.get(`tool.control_map.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.control_map.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.control_map.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.control_map.add_control + list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ controlMaps: [] }));

  it("appends with default status and reports coverage", async () => {
    await registry
      .get("tool.control_map.add_control")!
      .handler(
        { controlId: "CC6.1", framework: "soc2", title: "Access control", status: "verified" },
        ctx()
      );
    await registry
      .get("tool.control_map.add_control")!
      .handler({ controlId: "A.9", framework: "iso27001", title: "Access mgmt" }, ctx());

    const docs = useWorkspaceStore.getState().controlMaps ?? [];
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe(CM_ID);
    // second control got the default status
    expect(docs[0].controls.find((c) => c.controlId === "A.9")!.status).toBe("not_started");

    const r = (await registry.get("tool.control_map.list_state")!.handler({}, ctx())) as {
      total: number;
      byFramework: Record<string, number>;
      byStatus: Record<string, number>;
      implementedCount: number;
      coverage: number;
    };
    expect(r.total).toBe(2);
    expect(r.byFramework.soc2).toBe(1);
    expect(r.byFramework.iso27001).toBe(1);
    expect(r.implementedCount).toBe(1); // only the verified one
    expect(r.coverage).toBe(0.5); // 1/2
  });
});

describe("tool.control_map.set_status + add_evidence", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      controlMaps: [
        {
          id: CM_ID,
          controls: [
            {
              id: "row1",
              controlId: "CC6.1",
              framework: "soc2",
              title: "Access control",
              status: "not_started",
              evidenceLinks: [],
            },
          ],
        } as ControlMap,
      ],
    })
  );

  it("updates status by row id", async () => {
    const r = (await registry
      .get("tool.control_map.set_status")!
      .handler({ id: "row1", status: "implemented" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(true);
    expect((useWorkspaceStore.getState().controlMaps ?? [])[0].controls[0].status).toBe(
      "implemented"
    );
  });

  it("appends an evidence link", async () => {
    const r = (await registry
      .get("tool.control_map.add_evidence")!
      .handler({ id: "row1", link: "https://example.com/audit.pdf" }, ctx())) as {
      updated: boolean;
    };
    expect(r.updated).toBe(true);
    expect((useWorkspaceStore.getState().controlMaps ?? [])[0].controls[0].evidenceLinks).toContain(
      "https://example.com/audit.pdf"
    );
  });

  it("returns updated:false for an unknown control id", async () => {
    const r = (await registry
      .get("tool.control_map.set_status")!
      .handler({ id: "nope", status: "verified" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(false);
  });
});
