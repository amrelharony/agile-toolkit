/**
 * A strategy map grown to within a few bytes of its row's cap
 * (ENTITY_ROW_MAX_BYTES less `slack`) and still under the node cap: parts
 * under the root with 3-byte text and detail at their caps, then short
 * pads whose detail takes what is left, to within about 60 bytes. The
 * parts carry only what a read keeps, so the row reads back the same size.
 *
 * With `slack` 0 the row has no room for one more send's link (85 bytes or
 * more); with 120 it holds a link but not a drafted branch.
 */

import {
  ENTITY_ROW_MAX_BYTES,
  type StrategyMap,
  type StrategyMapNode,
} from "@/lib/stores/workspace-types";
import { jsonBytes } from "@/lib/utils/json-bytes";

export function nearlyFull(base: StrategyMap, slack = 0): StrategyMap {
  const root = base.nodes.find((n) => n.parentId === null);
  if (!root) throw new Error("nearlyFull needs a map with a root");
  const nodes = [...base.nodes];
  const part = (text: string, detail: string): StrategyMapNode => ({
    id: `fill${nodes.length}`,
    parentId: root.id,
    level: 1,
    text,
    detail,
  });
  const cap = ENTITY_ROW_MAX_BYTES - slack;
  // The nodes list is never empty (it has the root): each part adds its bytes and a comma.
  const cost = (n: StrategyMapNode) => jsonBytes(n) + 1;
  let bytes = jsonBytes(base);
  const wide = () => part("語".repeat(200), "語".repeat(1000));
  while (bytes + cost(wide()) <= cap) {
    const n = wide();
    nodes.push(n);
    bytes += cost(n);
  }
  for (let room = cap - bytes - cost(part("Pad", "x")); room >= 0; ) {
    const n = part("Pad", "x" + "語".repeat(Math.min(999, Math.floor(room / 3))));
    nodes.push(n);
    bytes += cost(n);
    room = cap - bytes - cost(part("Pad", "x"));
  }
  const full = { ...base, nodes };
  if (jsonBytes(full) !== bytes || bytes > cap) throw new Error("nearlyFull overshot the row");
  return full;
}
