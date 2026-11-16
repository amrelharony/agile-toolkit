// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generatePickerPrompts } from "@/lib/ai-prompts/picker";

/**
 * Picker's copyable prompts read the rotation as the page shows it (each
 * role's people, fairest first) and the name shortlist; the team's own
 * words go inside the user-content block.
 */

describe("generatePickerPrompts", () => {
  const data = {
    roles: [
      {
        name: "Facilitator",
        rows: [
          { name: "Chloé", turns: 0, last: "never", away: false },
          { name: "Amina", turns: 2, last: "1 weeks ago", away: true },
        ],
      },
      { name: "Scribe", rows: [] },
    ],
    shortlist: ["Nile", "Mekong"],
  };

  it("plans a fair rotation from the fairness table", () => {
    const [rota] = generatePickerPrompts(data);
    expect(rota.id).toBe("picker-rotation-plan");
    expect(rota.prompt).toContain("Facilitator:");
    expect(rota.prompt).toContain("| Chloé | 0 | never | here |");
    expect(rota.prompt).toContain("| Amina | 2 | 1 weeks ago | away |");
    expect(rota.prompt).not.toContain("Scribe:");
    expect(rota.prompt).toMatch(/<user_content>[\s\S]*Chloé[\s\S]*<\/user_content>/);
  });

  it("asks for more names like the shortlist", () => {
    const names = generatePickerPrompts(data)[1];
    expect(names.id).toBe("picker-name-ideas");
    expect(names.prompt).toContain("- Nile\n- Mekong");
  });

  it("offers nothing with no rotation and no shortlist", () => {
    expect(generatePickerPrompts({ roles: [{ name: "Scribe", rows: [] }], shortlist: [] })).toEqual(
      []
    );
  });
});
