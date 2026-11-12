import { describe, expect, it } from "vitest";
import { claudeNameFromId, registry } from "@/lib/actions/registry";
import "@/lib/actions/register-all";
import { getToolById } from "@/lib/constants/tools";
import { phrase, toolLabel, verbPhrase } from "@/lib/agent/tool-label";

/**
 * toolLabel turns a call's wire name into the words a step row shows:
 * the tool's catalog name and a sentence-case verb, never the raw id.
 */

describe("toolLabel", () => {
  it("reads the underscored wire names the model calls tools by", () => {
    expect(toolLabel("tool_retro_add_card")).toEqual({ tool: "Retro Board", verb: "Add card" });
    expect(toolLabel("tool_planning_poker_cast_vote")).toEqual({
      tool: "Planning Poker",
      verb: "Cast vote",
    });
    expect(toolLabel("tool_kanban_move_card")).toEqual({ tool: "Kanban Board", verb: "Move card" });
  });

  it("reads the dotted registry ids the same way", () => {
    expect(toolLabel("tool.retro.add_card")).toEqual({ tool: "Retro Board", verb: "Add card" });
    expect(toolLabel("tool.retro_actions.add")).toEqual({ tool: "Retro Actions", verb: "Add" });
    expect(toolLabel("tool.planning_poker.cast_vote")).toEqual({
      tool: "Planning Poker",
      verb: "Cast vote",
    });
  });

  it("takes the longest run of words that names a tool", () => {
    // "retro-actions" before "retro", "sprint-goal" before nothing shorter.
    expect(toolLabel("tool_retro_actions_add")).toEqual({ tool: "Retro Actions", verb: "Add" });
    expect(toolLabel("tool_sprint_goal_set_goal")).toEqual({
      tool: "Sprint Goal Builder",
      verb: "Set goal",
    });
    expect(toolLabel("tool_health_dashboard_list_state").tool).toBe("Team Dashboard");
    expect(toolLabel("tool_health_check_list_state").tool).toBe("Squad Health Check");
    expect(toolLabel("tool_hundred_dollar_test_add_item")).toEqual({
      tool: "$100 Test",
      verb: "Add item",
    });
  });

  it("files workspace entities under Workspace, verb first", () => {
    expect(toolLabel("workspace_team_member_add")).toEqual({
      tool: "Workspace",
      verb: "Add team member",
    });
    expect(toolLabel("workspace_team_member_create")).toEqual({
      tool: "Workspace",
      verb: "Create team member",
    });
    expect(toolLabel("workspace.team_member.create")).toEqual({
      tool: "Workspace",
      verb: "Create team member",
    });
    // An entity word that is also a verb word ("log") stays with the entity.
    expect(toolLabel("workspace_poker_estimation_log_delete")).toEqual({
      tool: "Workspace",
      verb: "Delete poker estimation log",
    });
  });

  it("names a workspace list in the plural", () => {
    expect(toolLabel("workspace_sprint_list").verb).toBe("List sprints");
    expect(toolLabel("workspace_story_list").verb).toBe("List stories");
    expect(toolLabel("workspace_sprint_series_list").verb).toBe("List sprint series");
    expect(toolLabel("workspace_definition_of_done_list").verb).toBe("List definitions of done");
    expect(toolLabel("workspace.okr.list").verb).toBe("List OKRs");
    expect(toolLabel("workspace_weighted_criterion_list").verb).toBe("List weighted criteria");
  });

  it("says the workspace settings plainly", () => {
    expect(toolLabel("workspace_scalars_get")).toEqual({ tool: "Workspace", verb: "Get settings" });
    expect(toolLabel("workspace_scalars_set_team_name")).toEqual({
      tool: "Workspace",
      verb: "Set team name",
    });
    expect(toolLabel("workspace.scalars.set_maturity_level").verb).toBe("Set maturity level");
  });

  it("says a tool's read of its own data as Read", () => {
    expect(toolLabel("tool_retro_list_state")).toEqual({ tool: "Retro Board", verb: "Read" });
    expect(toolLabel("tool.kanban.list_state")).toEqual({ tool: "Kanban Board", verb: "Read" });
    // Only the whole verb: "list items" stays as it is.
    expect(toolLabel("tool_moscow_list_items").verb).toBe("List items");
  });

  it("says persist as save, and a check-in as a person would", () => {
    expect(toolLabel("tool_rice_scoring_score_and_persist").verb).toBe("Score and save");
    expect(toolLabel("tool.moscow.classify_and_persist").verb).toBe("Classify and save");
    expect(toolLabel("tool.wsjf.persist_to_prioritization").verb).toBe("Save to prioritization");
    expect(toolLabel("tool.weighted_decision.score_and_persist_option").verb).toBe(
      "Score and save an option"
    );
    expect(toolLabel("tool.okrs.check_in").verb).toBe("Check in");
    expect(toolLabel("tool.working_agreement.record_check_in").verb).toBe("Record a check-in");
    expect(toolLabel("tool.working_agreement.remove_check_in").verb).toBe("Remove check-in");
  });

  it("keeps the plainer verbs for verbs: an argument's words are said as written", () => {
    expect(phrase(["list", "state"])).toBe("List state");
    expect(phrase(["check", "in"])).toBe("Check in");
    expect(verbPhrase(["list", "state"])).toBe("Read");
  });

  it("files intents under Workspace too", () => {
    expect(toolLabel("intent_plan_sprint")).toEqual({ tool: "Workspace", verb: "Plan sprint" });
    expect(toolLabel("intent.create_okr_for_sprint")).toEqual({
      tool: "Workspace",
      verb: "Create OKR for sprint",
    });
    expect(toolLabel("intent_log_impediment_from_retro_card").verb).toBe(
      "Log impediment from retro card"
    );
  });

  it("falls back to plain words for a tool the catalog doesn't list", () => {
    expect(toolLabel("tool_ceremony_cadence_get")).toEqual({
      tool: "Ceremony cadence",
      verb: "Get",
    });
    expect(toolLabel("tool.model_registry.add_model")).toEqual({
      tool: "Model registry",
      verb: "Add model",
    });
    expect(toolLabel("tool_model_registry_add_model")).toEqual({
      tool: "Model registry",
      verb: "Add model",
    });
    expect(toolLabel("tool_canvas_add_sticky")).toEqual({ tool: "Canvas", verb: "Add sticky" });
  });

  it("keeps acronyms and framework names as they are spelled", () => {
    expect(toolLabel("tool_sprint_goal_link_okr").verb).toBe("Link OKR");
    expect(toolLabel("tool_cost_of_delay_compute_cd3")).toEqual({
      tool: "Cost-of-Delay Tracker",
      verb: "Compute CD3",
    });
    expect(toolLabel("workspace_nps_response_create").verb).toBe("Create NPS response");
    expect(toolLabel("tool_prioritizer_rank_by_wsjf").verb).toBe("Rank by WSJF");
    expect(toolLabel("tool_release_readiness_check_dod").verb).toBe("Check DoD");
    // An acronym opening the phrase keeps its capitals; a short form is said in full.
    expect(toolLabel("intent_okr_review").verb).toBe("OKR review");
    expect(toolLabel("workspace_a11y_tracker_list").verb).toBe("List accessibility trackers");
  });

  it("never shows a raw id for an odd or unknown name", () => {
    expect(toolLabel("")).toEqual({ tool: "Tool", verb: "" });
    expect(toolLabel("___")).toEqual({ tool: "Tool", verb: "" });
    expect(toolLabel(undefined as unknown as string)).toEqual({ tool: "Tool", verb: "" });
    expect(toolLabel("do_magic_trick")).toEqual({ tool: "Tool", verb: "Do magic trick" });
    // No group prefix: a tool's own words still lead.
    expect(toolLabel("retro_add_card")).toEqual({ tool: "Retro Board", verb: "Add card" });
    expect(toolLabel("tool_retro")).toEqual({ tool: "Retro Board", verb: "" });
    expect(toolLabel("Tool.Retro.Add-Card!")).toEqual({ tool: "Retro Board", verb: "Add card" });
  });

  it("names every registered action in words, in both forms", () => {
    const actions = registry.list();
    expect(actions.length).toBeGreaterThan(300);
    for (const action of actions) {
      for (const name of [claudeNameFromId(action.id), action.id]) {
        const label = toolLabel(name);
        const shown = `${label.tool} · ${label.verb}`;
        expect(shown, name).not.toMatch(/[_]/);
        expect(label.tool, name).not.toBe("");
        expect(label.verb, name).not.toBe("");
        expect(label.verb, name).not.toMatch(/persist/i);
        // A tool the catalog lists is always named from the catalog: the
        // longest-run match never splits a name in the wrong place.
        const [group, segment] = action.id.split(".");
        const catalog = group === "tool" ? getToolById(segment.replace(/_/g, "-")) : undefined;
        if (catalog) expect(label.tool, name).toBe(catalog.name);
        else if (group !== "tool") expect(label.tool, name).toBe("Workspace");
      }
    }
  });
});
