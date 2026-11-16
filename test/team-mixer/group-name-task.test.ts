import { describe, expect, it } from "vitest";
import { GROUP_NAME_AI } from "@/app/(tools)/team-mixer/group-name-task";
import { THEME_NAMES_MAX, themeNamesTask } from "@/lib/ai/tasks/picker";

describe("Team Mixer's group names from Picker's AI task", () => {
  it("sends a theme and a count only, and reads the names back", () => {
    expect(GROUP_NAME_AI?.task).toBe(themeNamesTask);
    const input = GROUP_NAME_AI!.input("Rivers", 3);
    expect(input).toEqual({ theme: "Rivers", count: 3 });
    expect(themeNamesTask.input.safeParse(input).success).toBe(true);
    expect(GROUP_NAME_AI!.names({ names: ["Nile", "Volga"] })).toEqual(["Nile", "Volga"]);
    expect(GROUP_NAME_AI!.max).toBe(THEME_NAMES_MAX);
  });
});
