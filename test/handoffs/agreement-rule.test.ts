/**
 * The "agreement-rule" hand-off route: a kickoff's rule proposed in the
 * Working Agreement, with nobody's consent yet, never twice, done once the
 * whole team consents and nobody objects.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TeamMember, WorkingAgreement } from "@/lib/stores/workspace-types";

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
}));

import { sendHandoff } from "@/lib/handoffs/send";
import { getHandoffRoute } from "@/lib/handoffs/registry";
import {
  RULE_ALREADY_THERE,
  agreementRuleRoute,
  buildAgreementRule,
} from "@/lib/handoffs/targets/agreement-rule";
import type { HandoffLink, HandoffSource } from "@/lib/handoffs/types";
import {
  RULE_DESCRIPTION_MAX,
  RULE_TEXT_MAX,
  WA_ID,
  ruleKey,
  withConsent,
} from "@/lib/working-agreement/model";

const ws = () => useWorkspaceStore.getState();
const doc = () => (ws().workingAgreements ?? []).find((d) => d.id === WA_ID);

const src = (over: Partial<HandoffSource> = {}): HandoffSource => ({
  title: "Pair on risky changes",
  description: "Anything that touches payments.",
  sourceRef: { tool: "kickoff", id: "r1", doc: "kickoff_1" },
  ...over,
});

function linkStore() {
  let links: HandoffLink[] = [];
  return {
    get links() {
      return links;
    },
    getLinks: () => links,
    setLinks: (update: (cur: readonly HandoffLink[] | undefined) => HandoffLink[]) => {
      links = update(links);
    },
  };
}

const member = (id: string, name: string): TeamMember => ({ id, name }) as TeamMember;

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({ workingAgreements: [], teamMembers: [] });
});

describe("the agreement-rule route", () => {
  it("is registered with its labels and target", () => {
    expect(getHandoffRoute("agreement-rule")).toBe(agreementRuleRoute);
    expect(agreementRuleRoute.label).toBe("Working agreement rule");
    expect(agreementRuleRoute.doneLabel).toBe("Proposed in the Working Agreement");
    expect(agreementRuleRoute.targetToolId).toBe("working-agreement");
    expect(agreementRuleRoute.targetHref("any")).toBe("/working-agreement");
  });

  it("starts the agreement when there is none, and appends the rule with no consent", () => {
    const link = sendHandoff("agreement-rule", src(), linkStore())!;
    expect(doc()?.rules).toEqual([
      {
        id: link.targetId,
        category: "other",
        text: "Pair on risky changes",
        description: "Anything that touches payments.",
        agreedBy: [],
        consent: [],
        sourceRef: { tool: "kickoff", id: "r1", doc: "kickoff_1" },
      },
    ]);
    expect(doc()?.meta.version).toBe(0);
  });

  it("appends after the rules already there, leaving them as they are", () => {
    const existing: WorkingAgreement = {
      id: WA_ID,
      rules: [{ id: "rule-1", category: "meetings", text: "Cameras optional", agreedBy: [] }],
      meta: { version: 1, publishedAt: "2026-10-02" },
    };
    useWorkspaceStore.setState({ workingAgreements: [existing] });
    const link = sendHandoff("agreement-rule", src(), linkStore())!;
    expect(doc()?.rules.map((r) => r.id)).toEqual(["rule-1", link.targetId]);
    expect(doc()?.meta).toEqual({ version: 1, publishedAt: "2026-10-02" });
  });

  it("refuses a rule the agreement already has, whatever its case, spacing or full stop", () => {
    sendHandoff("agreement-rule", src(), linkStore());
    expect(agreementRuleRoute.problem?.(src({ title: "  PAIR on   risky changes." }))).toBe(
      RULE_ALREADY_THERE
    );
    const other = linkStore();
    expect(
      sendHandoff("agreement-rule", src({ title: "pair on risky changes" }), other)
    ).toBeNull();
    expect(other.links).toEqual([]);
    expect(doc()?.rules).toHaveLength(1);
    expect(ruleKey("  PAIR on   risky changes.")).toBe(ruleKey("Pair on risky changes"));
  });

  it("caps the text and description", () => {
    const rule = buildAgreementRule(
      src({
        title: "x".repeat(RULE_TEXT_MAX + 10),
        description: "y".repeat(RULE_DESCRIPTION_MAX + 10),
      }),
      "r"
    );
    expect(rule.text).toHaveLength(RULE_TEXT_MAX);
    expect(rule.description).toHaveLength(RULE_DESCRIPTION_MAX);
    expect(buildAgreementRule(src({ description: "  " }), "r")).not.toHaveProperty("description");
  });

  it("Undo removes only the proposed rule", () => {
    const existing: WorkingAgreement = {
      id: WA_ID,
      rules: [{ id: "rule-1", category: "meetings", text: "Cameras optional", agreedBy: [] }],
      meta: { version: 0 },
    };
    useWorkspaceStore.setState({ workingAgreements: [existing] });
    const store = linkStore();
    const link = sendHandoff("agreement-rule", src(), store)!;
    expect(agreementRuleRoute.exists(link.targetId)).toBe(true);
    undo.last!.revert();
    expect(agreementRuleRoute.exists(link.targetId)).toBe(false);
    expect(doc()?.rules.map((r) => r.id)).toEqual(["rule-1"]);
    expect(store.links).toEqual([]);
  });

  it("is done once everyone on the team consents and nobody objects (example members don't count)", () => {
    useWorkspaceStore.setState({
      teamMembers: [member("m1", "Ana"), member("m2", "Bo"), member("example-m3", "Cy")],
    });
    const link = sendHandoff("agreement-rule", src(), linkStore())!;
    const rule = () => doc()!.rules.find((r) => r.id === link.targetId)!;
    const vote = (name: string, v: "consent" | "concern" | "object") =>
      ws().upsertWorkingAgreement({
        ...doc()!,
        rules: doc()!.rules.map((r) =>
          r.id === link.targetId ? withConsent(r, name, v, "2026-11-12T09:00:00.000Z") : r
        ),
      });
    expect(agreementRuleRoute.isDone?.(link.targetId)).toBe(false);
    vote("Ana", "consent");
    expect(agreementRuleRoute.isDone?.(link.targetId)).toBe(false);
    vote("Bo", "object");
    expect(agreementRuleRoute.isDone?.(link.targetId)).toBe(false);
    vote("Bo", "concern");
    expect(rule().agreedBy).toEqual(["Ana"]);
    expect(agreementRuleRoute.isDone?.(link.targetId)).toBe(true);
    expect(agreementRuleRoute.isDone?.("gone")).toBe(false);
  });
});
