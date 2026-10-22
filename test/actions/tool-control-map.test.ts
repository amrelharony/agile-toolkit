/**
 * tool.control_map.* coverage (singleton doc, S9).
 *
 *   1. registration — list_state read; add_control/set_status/add_evidence
 *      write + mcpHandler + no confirm.
 *   2. add_control + list_state — byFramework/byStatus/implementedCount/coverage.
 *   3. set_status — updates by row id; unknown → {updated:false}.
 *   4. add_evidence — appends a link to a control.
 *   5. evidence links are held to the page's rule: http(s) only, scheme-less
 *      links get https; the MCP path writes the same document server-side.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// The MCP path talks to the server store: an in-memory row per kind + id.
const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      return rows.get(`${kind}/${id}`) ?? null;
    }),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
  };
});

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

describe("tool.control_map evidence links", () => {
  const seedRow = () =>
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
    });
  const links = () => (useWorkspaceStore.getState().controlMaps ?? [])[0].controls[0].evidenceLinks;

  beforeEach(() => {
    rows.clear();
    seedRow();
  });

  // Bug: the agent path stored any string, so a javascript: link reached the
  // page's <a href> without the sanitiser the page applies to typed links.
  it("refuses a link that isn't http(s)", async () => {
    for (const link of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd"]) {
      const r = (await registry
        .get("tool.control_map.add_evidence")!
        .handler({ id: "row1", link }, ctx())) as { updated: boolean; reason?: string };
      expect(r).toEqual({ updated: false, reason: "invalid_link" });
    }
    expect(links()).toEqual([]);
  });

  it("gives a scheme-less link https, as the page does", async () => {
    const r = (await registry
      .get("tool.control_map.add_evidence")!
      .handler({ id: "row1", link: "  wiki.example.com/access-review " }, ctx())) as {
      updated: boolean;
    };
    expect(r.updated).toBe(true);
    expect(links()).toEqual(["https://wiki.example.com/access-review"]);
  });

  it("returns updated:false for an unknown control id", async () => {
    const r = (await registry
      .get("tool.control_map.add_evidence")!
      .handler({ id: "nope", link: "https://example.com" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(false);
  });

  it("keeps only the valid links given to add_control", async () => {
    await registry.get("tool.control_map.add_control")!.handler(
      {
        controlId: "CC7.2",
        framework: "soc2",
        title: "Monitoring",
        evidenceLinks: ["https://siem.example.com/dash", "javascript:alert(1)", "runbook.example"],
      },
      ctx()
    );
    const added = (useWorkspaceStore.getState().controlMaps ?? [])[0].controls[1];
    expect(added.evidenceLinks).toEqual([
      "https://siem.example.com/dash",
      "https://runbook.example/",
    ]);
  });

  it("reports an absent map as empty with zero coverage", async () => {
    useWorkspaceStore.setState({ controlMaps: [] });
    const r = (await registry.get("tool.control_map.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      total: number;
      coverage: number;
    };
    expect(r).toMatchObject({ exists: false, total: 0, coverage: 0 });
  });

  it("writes through the server store on the MCP path, with the same link rule", async () => {
    const added = (await registry.get("tool.control_map.add_control")!.mcpHandler!(
      { controlId: "A.9", framework: "iso27001", title: "Access mgmt" },
      ctx()
    )) as {
      id: string;
    };
    const bad = (await registry.get("tool.control_map.add_evidence")!.mcpHandler!(
      { id: added.id, link: "javascript:alert(1)" },
      ctx()
    )) as { updated: boolean };
    expect(bad.updated).toBe(false);
    await registry.get("tool.control_map.add_evidence")!.mcpHandler!(
      { id: added.id, link: "https://example.com/audit.pdf" },
      ctx()
    );
    await registry.get("tool.control_map.set_status")!.mcpHandler!(
      { id: added.id, status: "verified" },
      ctx()
    );

    const row = rows.get(`workspace:controlMap/${CM_ID}`) as ControlMap;
    expect(row.controls).toHaveLength(1);
    expect(row.controls[0]).toMatchObject({
      controlId: "A.9",
      status: "verified",
      evidenceLinks: ["https://example.com/audit.pdf"],
    });
    const r = (await registry.get("tool.control_map.list_state")!.mcpHandler!({}, ctx())) as {
      total: number;
      coverage: number;
    };
    expect(r).toMatchObject({ total: 1, coverage: 1 });
  });
});
