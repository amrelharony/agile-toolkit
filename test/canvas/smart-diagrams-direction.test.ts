import { describe, expect, it } from "vitest";
import { parseDiagramCsv, diagramToObjects } from "@/lib/whiteboard/smart-diagrams";
import type { WhiteboardCard, WhiteboardConnector } from "@/lib/stores/workspace-types";

/**
 * Regression: flowchart connectors were emitted as `b → a` (target → source),
 * the same pattern the TREE branch uses (parent → child). But a flowchart
 * header is `from,to`, so column 0 (`r.a`) is the SOURCE and column 1
 * (`r.b`) is the TARGET. arrowEnd renders the arrowhead at `toId`, so the
 * old code drew every arrow pointing back at the source. Arrows must point
 * source → target (a → b).
 */
function titleOf(objects: ReturnType<typeof diagramToObjects>, id: string): string | undefined {
  const card = objects.find((o): o is WhiteboardCard => o.type === "card" && o.id === id);
  return card?.title;
}

describe("diagramToObjects — flowchart edge direction", () => {
  it("points the arrow from source to target (from,to)", () => {
    const parsed = parseDiagramCsv("from,to\nStart,Finish");
    expect(parsed.shape).toBe("flowchart");

    const objects = diagramToObjects("board-1", parsed, { x: 0, y: 0 });
    const connector = objects.find((o): o is WhiteboardConnector => o.type === "connector");
    expect(connector).toBeDefined();
    expect(titleOf(objects, connector!.fromId)).toBe("Start");
    expect(titleOf(objects, connector!.toId)).toBe("Finish");
    expect(connector!.arrowEnd).toBe(true);
  });

  it("preserves direction across a multi-step flow", () => {
    const parsed = parseDiagramCsv("source,target\nA,B\nB,C");
    const objects = diagramToObjects("board-1", parsed, { x: 0, y: 0 });
    const edges = objects
      .filter((o): o is WhiteboardConnector => o.type === "connector")
      .map((c) => `${titleOf(objects, c.fromId)}->${titleOf(objects, c.toId)}`)
      .sort();
    expect(edges).toEqual(["A->B", "B->C"]);
  });
});

describe("diagramToObjects — tree edge direction (unchanged)", () => {
  it("points the arrow from parent to child (child,parent)", () => {
    const parsed = parseDiagramCsv("child,parent\nLeaf,Root");
    expect(parsed.shape).toBe("tree");

    const objects = diagramToObjects("board-1", parsed, { x: 0, y: 0 });
    const connector = objects.find((o): o is WhiteboardConnector => o.type === "connector");
    expect(connector).toBeDefined();
    expect(titleOf(objects, connector!.fromId)).toBe("Root");
    expect(titleOf(objects, connector!.toId)).toBe("Leaf");
  });
});
