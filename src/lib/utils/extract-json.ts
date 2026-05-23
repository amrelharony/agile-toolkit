/**
 * Extract the first complete JSON object or array embedded in a longer
 * text string (typically an LLM response that may include preamble,
 * ` ```json ` code fences, or trailing commentary).
 *
 * Strategy: find the first opening brace/bracket, then walk forward
 * tracking depth WHILE respecting JSON string literals (so `{` inside
 * `"..."` doesn't get counted as a real open brace). Stops at the
 * matching close-depth-0 brace and tries `JSON.parse` on the slice.
 *
 * Why this matters: the previous codebase used
 * `text.indexOf("{")` + `text.lastIndexOf("}")`, which:
 *
 *   1. Extends the slice through any unrelated trailing brace in
 *      commentary text — e.g. `{"k":1} (Note: the } in this output is
 *      escaped)` slices to the final `)`-adjacent `}`, JSON.parse fails.
 *   2. Mis-matches braces that live inside string literals — translated
 *      content containing the literal `{` produces an unbalanced span.
 *   3. Returns the OUTER span when the response contains multiple
 *      independent JSON blocks: `{"a":1} and also {"b":2}` slices the
 *      whole thing, parses nothing.
 *
 * The string-aware depth walk handles all three cleanly.
 *
 * Returns `null` on any failure (no extractable JSON, malformed slice).
 * Caller is responsible for type-narrowing the result.
 */
export function extractJson<T>(text: string, wrapper: "{" | "["): T | null {
  if (!text) return null;
  const close = wrapper === "{" ? "}" : "]";
  const start = text.indexOf(wrapper);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === wrapper) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
