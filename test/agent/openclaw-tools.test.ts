/**
 * OpenClaw prompt-based tool-calling adapter.
 *
 * OpenClaw (chat.amrelharony.com) is OpenAI-compatible for chat, but it does
 * NOT emit native `tool_calls`. Instead the model writes the call as Claude-
 * style XML in the message CONTENT and returns finish_reason "stop":
 *   <tool_caller><invoke name="X"><parameter name="k">v</parameter></invoke></tool_caller>
 * and it accepts results fed back as a user turn:
 *   <tool_result name="X">{json}</tool_result>
 *
 * This module parses those invokes out of streamed text and serialises calls +
 * results back into the format OpenClaw expects. Verified live against the
 * gateway (see PR notes). Pure — unit-tested here.
 */

import { describe, it, expect } from "vitest";
import {
  parseOpenClawToolCalls,
  serializeOpenClawToolCall,
  serializeOpenClawToolResult,
} from "@/lib/agent/openclaw-tools";

describe("parseOpenClawToolCalls", () => {
  it("returns the text unchanged with no invokes when there is no tool_caller block", () => {
    const r = parseOpenClawToolCalls("Just a normal answer.");
    expect(r.invokes).toEqual([]);
    expect(r.visibleText).toBe("Just a normal answer.");
  });

  it("extracts a single invoke and strips the XML from the visible text", () => {
    const text =
      'Sure, logging that now.\n<tool_caller>\n<invoke name="log_impediment">\n<parameter name="title">test blocker</parameter>\n</invoke>\n</tool_caller>';
    const r = parseOpenClawToolCalls(text);
    expect(r.invokes).toEqual([{ name: "log_impediment", input: { title: "test blocker" } }]);
    expect(r.visibleText).toBe("Sure, logging that now.");
  });

  it("coerces JSON-typed parameter values (number/boolean/array) but keeps plain strings", () => {
    const text =
      '<tool_caller><invoke name="create_story"><parameter name="title">Login flow</parameter><parameter name="points">5</parameter><parameter name="ready">true</parameter><parameter name="tags">["auth","ui"]</parameter></invoke></tool_caller>';
    const r = parseOpenClawToolCalls(text);
    expect(r.invokes).toHaveLength(1);
    expect(r.invokes[0]).toEqual({
      name: "create_story",
      input: { title: "Login flow", points: 5, ready: true, tags: ["auth", "ui"] },
    });
  });

  it("parses multiple invokes (in one block or several)", () => {
    const text =
      '<tool_caller><invoke name="a"><parameter name="x">1</parameter></invoke></tool_caller>' +
      " and then " +
      '<tool_caller><invoke name="b"><parameter name="y">two</parameter></invoke></tool_caller>';
    const r = parseOpenClawToolCalls(text);
    expect(r.invokes.map((i) => i.name)).toEqual(["a", "b"]);
    expect(r.invokes[0].input).toEqual({ x: 1 });
    expect(r.invokes[1].input).toEqual({ y: "two" });
  });

  it("tolerates an invoke with no parameters", () => {
    const r = parseOpenClawToolCalls(
      '<tool_caller><invoke name="list_state"></invoke></tool_caller>'
    );
    expect(r.invokes).toEqual([{ name: "list_state", input: {} }]);
  });
});

describe("serializeOpenClawToolCall", () => {
  it("round-trips a call back into the <tool_caller> XML the model produced", () => {
    const xml = serializeOpenClawToolCall("log_impediment", { title: "test blocker" });
    const back = parseOpenClawToolCalls(xml);
    expect(back.invokes).toEqual([{ name: "log_impediment", input: { title: "test blocker" } }]);
  });

  it("serialises non-string values as JSON so they round-trip typed", () => {
    const xml = serializeOpenClawToolCall("create_story", { points: 5, ready: true });
    const back = parseOpenClawToolCalls(xml);
    expect(back.invokes[0].input).toEqual({ points: 5, ready: true });
  });
});

describe("serializeOpenClawToolResult", () => {
  it("wraps a result string in a named tool_result tag", () => {
    expect(serializeOpenClawToolResult("log_impediment", '{"logged":true}')).toBe(
      '<tool_result name="log_impediment">{"logged":true}</tool_result>'
    );
  });
});
