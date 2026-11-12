/**
 * A task's output schema in words, for the system prompt's "answer in this
 * shape" line, and a walk over its JSON Schema for the contract test's caps.
 *
 * Read from zod's own JSON Schema (z.toJSONSchema), so the words always match
 * what the parser checks. No server code: safe in either bundle.
 */

import { z, type ZodType } from "zod";

type Json = Record<string, unknown>;

/** The JSON Schema zod makes for `schema`, without the `$schema` line. */
export function jsonSchemaOf(schema: ZodType): Json {
  const json = z.toJSONSchema(schema as z.ZodType, { target: "draft-2020-12" }) as Json;
  delete json.$schema;
  return json;
}

function range(min: unknown, max: unknown, unit: string): string {
  const lo = typeof min === "number" ? min : undefined;
  const hi = typeof max === "number" ? max : undefined;
  if (lo !== undefined && hi !== undefined) {
    return lo === hi ? `exactly ${hi} ${unit}` : `${lo} to ${hi} ${unit}`;
  }
  if (hi !== undefined) return `at most ${hi} ${unit}`;
  if (lo !== undefined) return `at least ${lo} ${unit}`;
  return "";
}

function describeNode(node: Json, indent: string): string {
  const next = `${indent}  `;
  if (Array.isArray(node.enum)) {
    return `one of ${node.enum.map((v) => JSON.stringify(v)).join(", ")}`;
  }
  if (node.const !== undefined) return JSON.stringify(node.const);
  const anyOf = (node.anyOf ?? node.oneOf) as Json[] | undefined;
  if (Array.isArray(anyOf)) {
    return anyOf.map((n) => describeNode(n, indent)).join(" or ");
  }
  switch (node.type) {
    case "object": {
      const props = (node.properties ?? {}) as Record<string, Json>;
      const required = new Set((node.required ?? []) as string[]);
      const lines = Object.entries(props).map(
        ([key, child]) =>
          `${next}${JSON.stringify(key)}${required.has(key) ? "" : " (optional)"}: ${describeNode(child, next)}`
      );
      return lines.length ? `{\n${lines.join(",\n")}\n${indent}}` : "{}";
    }
    case "array": {
      const items = (node.items ?? {}) as Json;
      const count = range(node.minItems, node.maxItems, "items");
      return `[${describeNode(items, indent)}, ...]${count ? ` (${count})` : ""}`;
    }
    case "string": {
      const len = range(node.minLength, node.maxLength, "characters");
      return `text${len ? ` (${len})` : ""}`;
    }
    case "integer":
    case "number": {
      const span = range(node.minimum, node.maximum, "").trim();
      return `${node.type === "integer" ? "whole number" : "number"}${span ? ` (${span})` : ""}`;
    }
    case "boolean":
      return "true or false";
    case "null":
      return "null";
    default:
      return "a value";
  }
}

/**
 * The output's shape as a short, readable outline:
 *   { "options": [text (1 to 60 characters), ...] (2 to 6 items) }
 */
export function describeShape(schema: ZodType): string {
  return describeNode(jsonSchemaOf(schema), "");
}

/** One place in a schema that has no hard cap. */
export interface MissingCap {
  path: string;
  what: "string has no maxLength" | "array has no maxItems" | "unsupported node";
}

/**
 * Every string without a maxLength and every array without a maxItems in a
 * schema (the contract test needs none). Enums and constants are capped by
 * their values.
 */
export function missingCaps(schema: ZodType): MissingCap[] {
  const out: MissingCap[] = [];
  const walk = (node: Json, path: string) => {
    if (Array.isArray(node.enum) || node.const !== undefined) return;
    const anyOf = (node.anyOf ?? node.oneOf) as Json[] | undefined;
    if (Array.isArray(anyOf)) {
      anyOf.forEach((n, i) => walk(n, `${path}|${i}`));
      return;
    }
    switch (node.type) {
      case "object":
        for (const [key, child] of Object.entries(
          (node.properties ?? {}) as Record<string, Json>
        )) {
          walk(child, `${path}.${key}`);
        }
        if (node.additionalProperties && typeof node.additionalProperties === "object") {
          out.push({ path: `${path}.*`, what: "unsupported node" });
        }
        return;
      case "array":
        if (typeof node.maxItems !== "number") out.push({ path, what: "array has no maxItems" });
        walk((node.items ?? {}) as Json, `${path}[]`);
        return;
      case "string":
        if (typeof node.maxLength !== "number") out.push({ path, what: "string has no maxLength" });
        return;
      case "integer":
      case "number":
      case "boolean":
      case "null":
        return;
      default:
        out.push({ path, what: "unsupported node" });
    }
  };
  walk(jsonSchemaOf(schema), "$");
  return out;
}

/** Whether a schema holds an array anywhere (the token minimum is higher then). */
export function hasArray(schema: ZodType): boolean {
  return JSON.stringify(jsonSchemaOf(schema)).includes('"type":"array"');
}
