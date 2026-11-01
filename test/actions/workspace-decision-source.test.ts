/**
 * A hand-off to the "decision" route can carry what the merged decision
 * record starts from (HandoffSource.decision): the template, the options in
 * order and the recommendation. Type-level (tsc checks test files); the
 * decision-record track builds the record from it.
 */

import { describe, expectTypeOf, it } from "vitest";
import type { HandoffSource } from "@/lib/handoffs/types";
import type { DecisionTemplate } from "@/lib/stores/workspace-types";

describe("HandoffSource.decision", () => {
  it("is optional, with an optional template, options and recommendation", () => {
    expectTypeOf<HandoffSource["decision"]>().toEqualTypeOf<
      { template?: DecisionTemplate; options?: string[]; recommendation?: string } | undefined
    >();
    // A weighted matrix's send: the options ranked, the leader recommended.
    const fromMatrix: HandoffSource = {
      title: "Where do we host the new service?",
      sourceRef: { tool: "weighted-decision", id: "weightedMatrix_abc12345" },
      decision: { options: ["Managed cloud", "On-prem"], recommendation: "Managed cloud" },
    };
    expectTypeOf(fromMatrix.decision).not.toBeNever();
  });
});
