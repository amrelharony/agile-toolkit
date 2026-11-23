import { describe, expect, it } from "vitest";
import { validateItem, validateObjective, validateTeam } from "@/app/(tools)/pi-planning/forms";

/** A lone high surrogate, which the cloud row refuses. */
const LONE = /[\ud800-\udbff](?![\udc00-\udfff])/;

describe("PI Planning's forms cut text without splitting a character", () => {
  // An emoji is two UTF-16 units: one that straddles the cap must go whole.
  const over = (max: number) => `${"a".repeat(max - 1)}😀`;

  it("a team's name and description", () => {
    const v = validateTeam({ name: over(120), velocity: "", description: over(2000) }, []);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.values.name).toBe("a".repeat(119));
    expect(v.values.description).toBe("a".repeat(1999));
    expect(LONE.test(v.values.name + (v.values.description ?? ""))).toBe(false);
  });

  it("an item's title, what it waits on and its description", () => {
    const v = validateItem(
      {
        title: over(240),
        kind: "dependency",
        points: "",
        dependsOn: over(120),
        due: "",
        description: over(2000),
      },
      "Payments"
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.values.title).toBe("a".repeat(239));
    expect(v.values.dependsOn).toBe("a".repeat(119));
    expect(v.values.description).toBe("a".repeat(1999));
  });

  it("an objective's title", () => {
    const v = validateObjective({
      teamId: "t1",
      title: over(240),
      businessValue: null,
      commitment: "committed",
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.values.title).toBe("a".repeat(239));
  });

  it("keeps text under the cap as it is, emoji and all", () => {
    const v = validateTeam({ name: "Team 😀", velocity: "", description: "" }, []);
    expect(v.ok && v.values.name).toBe("Team 😀");
  });
});
