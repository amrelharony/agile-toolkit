import { describe, expect, it } from "vitest";
import { detectRiskStacking } from "@/lib/analytics/anti-patterns";
import { isHighRisk, riskLevelOf } from "@/lib/risks/model";
import type { Risk, Workspace } from "@/lib/stores/workspace-types";

/**
 * One meaning of a "high" risk across the toolkit (lib/risks/model): the
 * register's bands, high from P×I 10 and critical from 16. The
 * risk-stacking anti-pattern used P×I 12 and the health dashboard 15; both
 * now read the register's rule.
 */

const risk = (id: string, probability: number, impact: number, status: Risk["status"] = "open") =>
  ({ id, title: `Risk ${id}`, probability, impact, status, raisedAt: "2026-10-01" }) as Risk;

describe("a high risk", () => {
  it("is the register's high or critical band", () => {
    expect(riskLevelOf({ probability: 2, impact: 5 })).toBe("high");
    expect(isHighRisk({ probability: 2, impact: 5 })).toBe(true);
    expect(isHighRisk({ probability: 3, impact: 3 })).toBe(false);
    expect(isHighRisk({ probability: 4, impact: 4 })).toBe(true);
  });

  it("stacks from three open high risks rated 10, which P×I 12 used to miss", () => {
    const w = {
      risks: [risk("a", 2, 5), risk("b", 5, 2), risk("c", 2, 5, "mitigating")],
    } as unknown as Workspace;
    expect(detectRiskStacking(w)).toMatchObject({
      id: "RISK_STACKING",
      title: "3 high-severity risks open",
    });
    // Closed or accepted risks don't stack, and neither do medium ones.
    const settled = {
      risks: [
        risk("a", 2, 5),
        risk("b", 5, 2, "closed"),
        risk("c", 3, 3),
        risk("d", 2, 5, "accepted"),
      ],
    } as unknown as Workspace;
    expect(detectRiskStacking(settled)).toBeNull();
  });
});
