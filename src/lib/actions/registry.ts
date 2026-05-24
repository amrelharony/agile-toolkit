import { z } from "zod";
import type { ZodType } from "zod";
import type { ActionCategory, AnyToolAction, ToolAction } from "./types";

/**
 * Singleton registry of all callable actions. Populated by side-effect
 * imports from `register-all.ts`. Both the in-app agent runtime and
 * the MCP server consume the same registry instance, so a single
 * action definition is reachable from every entry point.
 */
class ToolActionRegistry {
  private actions = new Map<string, AnyToolAction>();
  /** Reverse map from Anthropic-format name (dots → underscores) back
   *  to the canonical registry id. Built lazily and rebuilt on
   *  register/unregister so name munging is no longer lossy — an action
   *  named `set_team_name` registered under `workspace.scalars.set_team_name`
   *  resolves correctly even though the round-trip via underscores
   *  ambiguity is impossible (the dot positions are not recoverable). */
  private claudeNameToId = new Map<string, string>();

  register<P, R>(action: ToolAction<P, R>): void {
    if (this.actions.has(action.id)) {
      // Idempotent: re-registering the same id (e.g. HMR reload) is a no-op.
      // If you intentionally need to replace, call `unregister` first.
      return;
    }
    const claudeName = claudeNameFromId(action.id);
    // BUG-AR1: detect Claude-name (dot→underscore munged) collisions
    // BEFORE writing the reverse map. Two distinct ids like
    // `tool.foo_bar` and `tool_foo.bar` munge to the same Claude name
    // (`tool_foo_bar`) and the old code silently overwrote the first
    // entry — the agent would dispatch one id's name to the other id's
    // handler. Throw at register time so the collision is caught by a
    // failing build / `register-all` import, not in production.
    const existingForName = this.claudeNameToId.get(claudeName);
    if (existingForName && existingForName !== action.id) {
      throw new Error(
        `Action name collision: "${claudeName}" already maps to "${existingForName}" — cannot register "${action.id}". Rename one of them.`
      );
    }
    this.actions.set(action.id, action as AnyToolAction);
    this.claudeNameToId.set(claudeName, action.id);
  }

  unregister(id: string): void {
    this.actions.delete(id);
    this.claudeNameToId.delete(claudeNameFromId(id));
  }

  get(id: string): AnyToolAction | undefined {
    return this.actions.get(id);
  }

  /** Resolve a name in EITHER form (dotted id or Anthropic-munged
   *  underscores). Use this from agent / MCP runtimes that don't know
   *  which form the model emitted. */
  resolve(nameOrId: string): AnyToolAction | undefined {
    return this.actions.get(nameOrId) ?? this.actions.get(this.claudeNameToId.get(nameOrId) ?? "");
  }

  list(filter?: { toolId?: string; category?: ActionCategory }): AnyToolAction[] {
    const out: AnyToolAction[] = [];
    this.actions.forEach((a) => {
      if (filter?.toolId && !a.toolId.startsWith(filter.toolId)) return;
      if (filter?.category && a.category !== filter.category) return;
      out.push(a);
    });
    return out;
  }

  /**
   * Serialise the registry as Anthropic tool-use definitions.
   * Zod schemas are converted to JSON Schema via a minimal shim — we
   * avoid the `zod-to-json-schema` dependency by walking the small subset
   * of zod we actually use in action schemas.
   */
  toClaudeTools(): Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }> {
    const tools: Array<{
      name: string;
      description: string;
      input_schema: Record<string, unknown>;
    }> = [];
    this.actions.forEach((a) => {
      tools.push({
        // Anthropic tool names must match ^[a-zA-Z0-9_-]{1,128}$ — convert
        // dots to underscores so `workspace.sprint.create` becomes
        // `workspace_sprint_create`.
        name: claudeNameFromId(a.id),
        description: a.description,
        input_schema: zodToJsonSchema(a.paramsSchema),
      });
    });
    return tools;
  }

  /**
   * Serialise the registry as OpenAI / GLM function-calling tool defs.
   * Schema: `[{ type: "function", function: { name, description, parameters } }]`.
   * Tool names use the same dot→underscore munging as the Anthropic
   * variant (OpenAI tool names must match `^[a-zA-Z0-9_-]+$`), so
   * `registry.resolve(toolCall.function.name)` still finds the dotted
   * registry id.
   */
  toOpenAiTools(): Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }> {
    const tools: Array<{
      type: "function";
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }> = [];
    this.actions.forEach((a) => {
      tools.push({
        type: "function",
        function: {
          name: claudeNameFromId(a.id),
          description: a.description,
          parameters: zodToJsonSchema(a.paramsSchema),
        },
      });
    });
    return tools;
  }

  /**
   * Serialise the registry as MCP tool definitions. MCP's `tools/list`
   * response wants `name`, `description`, and `inputSchema` (note the
   * camelCase — different from Anthropic's snake_case).
   */
  toMcpTools(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    const tools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }> = [];
    this.actions.forEach((a) => {
      tools.push({
        name: a.id, // MCP names tolerate dots — keep the human-readable id
        description: a.description,
        inputSchema: zodToJsonSchema(a.paramsSchema),
      });
    });
    return tools;
  }
}

export const registry = new ToolActionRegistry();

export function claudeNameFromId(id: string): string {
  return id.replace(/\./g, "_");
}

/**
 * @deprecated Underscore→dot reversal is not unique when action names
 * themselves contain underscores (e.g. `set_team_name`). Use
 * `registry.resolve(name)` instead, which consults the registry's
 * reverse map built at register time.
 *
 * Retained only for type compatibility; returns the input unchanged so
 * existing callers fall through to the dotted-form lookup path.
 */
export function idFromClaudeName(name: string): string {
  return name;
}

/**
 * Wrapper around Zod 4's built-in `z.toJSONSchema()` that swallows
 * conversion errors (some refinements / transformers aren't JSON-Schema
 * representable) and falls back to a permissive `{}`.
 *
 * Returns plain JSON Schema (Draft 2020-12 with `$schema` stripped) so
 * both Anthropic tool-use and MCP can consume it directly.
 */
export function zodToJsonSchema(schema: ZodType<unknown>): Record<string, unknown> {
  try {
    const json = z.toJSONSchema(schema as z.ZodType, { target: "draft-2020-12" }) as Record<
      string,
      unknown
    >;
    // Anthropic / MCP don't want the `$schema` declaration — strip it.
    delete json["$schema"];
    return json;
  } catch (err) {
    // Surface conversion failures: without this the tool registers with an
    // empty schema (`{}`) which the API treats as "accepts anything",
    // turning every validation failure downstream into the misleading
    // "schema violation" — no clue the root cause was the conversion.
    // eslint-disable-next-line no-console
    console.warn(
      "[registry/zodToJsonSchema] conversion failed, falling back to permissive {}:",
      err instanceof Error ? err.message : String(err)
    );
    return {};
  }
}
