import { registry } from "@/lib/actions/registry";
import { makeContext } from "@/lib/actions/context";
import type { AnyToolAction } from "@/lib/actions/types";
import { phrase, toolLabel } from "./tool-label";
import type { ConfirmPrompt, ToolResultBlock, ToolUseBlock } from "./types";

interface ExecuteOptions {
  userId: string;
  /** Resolves true to proceed with a write/intent action, false to deny. `prompt` says what will run, in words. */
  confirm: (prompt: ConfirmPrompt) => Promise<boolean>;
  /**
   * When true (Approve all), skip confirm() for write/intent actions, except a
   * destructive one (isDestructiveAction), which always asks. Read still no-prompt.
   */
  autoApprove: boolean;
  /** Turn abort signal — stopping the turn (Stop, New chat, a thread switch)
   *  cancels an in-flight handler so the loop doesn't stay parked (and
   *  `streaming`) for up to the 30s timeout. Closing the panel doesn't. */
  signal?: AbortSignal;
  /**
   * Ask before EVERY non-read action, even one whose `requiresConfirmation`
   * is false, and ignore `autoApprove`. The visitor chat sets it: a visitor
   * approves each change Amr makes to their tools.
   */
  forceConfirmWrites?: boolean;
  /**
   * Only the tools offered this turn may run (the visitor chat). A name this
   * returns false for gets "Tool not available" before it is even looked up,
   * so a model can't reach an action it was never given. It is asked again
   * after a confirmation, since the answer can change while the card waits.
   */
  isAllowed?: (name: string) => boolean;
}

/** An action name's first word that makes the action destructive. */
const DESTRUCTIVE_VERBS: ReadonlySet<string> = new Set([
  "archive",
  "clear",
  "delete",
  "remove",
  "reset",
]);

/**
 * A change the owner is always asked about: a write or intent whose name
 * starts with delete, remove, reset, clear or archive (`delete`,
 * `remove_check_in`, `archive_dimension`; not `unarchive`). It asks even when
 * the action declares `requiresConfirmation: false` and even under Approve
 * all, which is what lets the owner's chat say "Amr asks before deleting or
 * resetting anything". A read never is.
 */
export function isDestructiveAction(action: Pick<AnyToolAction, "name" | "category">): boolean {
  if (action.category === "read") return false;
  const [first = ""] = action.name.toLowerCase().split(/[^a-z0-9]+/);
  return DESTRUCTIVE_VERBS.has(first);
}

/**
 * A promise that rejects when `signal` aborts OR after `timeoutMs`, plus a
 * `cleanup` to call once the race settles. Without the cleanup, the timeout
 * timer keeps running (and fires) up to `timeoutMs` after the handler already
 * returned, and the abort listener stays attached — every tool call would leak
 * a dangling timer + listener across a multi-tool turn.
 */
function raceGuards(
  signal: AbortSignal | undefined,
  timeoutMs: number
): { promise: Promise<never>; cleanup: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Handler timeout after ${timeoutMs}ms`)), timeoutMs);
    if (!signal) return;
    if (signal.aborted) return reject(new Error("cancelled"));
    onAbort = () => reject(new Error("cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  };
  return { promise, cleanup };
}

/**
 * Run a single tool_use block, returning an Anthropic tool_result block
 * to feed back into the next API turn.
 *
 * Action lookup:
 *   - Try the block's exact name first (MCP format with dots).
 *   - Fall back to the dot-decoded form (Anthropic format with underscores).
 *
 * The registry's `id` is the canonical form (`workspace.sprint.create`);
 * Anthropic names munge dots to underscores (`workspace_sprint_create`),
 * so both lookups together cover both transports.
 */
// Hard cap on the size of a tool-use input. Real action params are
// always under a few KB; anything larger is a misbehaving / malicious
// model trying to exhaust memory or stall Zod validation. Same shape
// as the MCP body cap (1 MiB).
const MAX_INPUT_BYTES = 1_048_576;

export async function executeToolUse(
  block: ToolUseBlock,
  opts: ExecuteOptions
): Promise<ToolResultBlock> {
  // The turn was stopped before we got to this tool — answer it
  // with an error result rather than running it, so the tool_call isn't left
  // orphaned in the transcript.
  if (opts.signal?.aborted) {
    return { type: "tool_result", tool_use_id: block.id, content: "Cancelled.", is_error: true };
  }
  if (opts.isAllowed && !opts.isAllowed(block.name)) {
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: `Tool not available: ${block.name}`,
      is_error: true,
    };
  }
  const action = registry.resolve(block.name);
  if (!action) {
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: `Unknown tool: ${block.name}`,
      is_error: true,
    };
  }

  // Reject oversized inputs BEFORE schema validation — Zod walking a
  // 10 MB nested object is slow enough to look like a hang.
  try {
    const approx = JSON.stringify(block.input ?? {});
    if (approx.length > MAX_INPUT_BYTES) {
      return {
        type: "tool_result",
        tool_use_id: block.id,
        content: `Input too large (${approx.length} bytes > ${MAX_INPUT_BYTES}).`,
        is_error: true,
      };
    }
  } catch {
    // JSON.stringify can throw on circular refs in `input` itself
    // (would arrive only via in-process injection, never from the wire).
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: "Input is not JSON-serialisable.",
      is_error: true,
    };
  }

  // Validate input — the model occasionally drifts from the schema.
  const parsed = (
    action.paramsSchema as {
      safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { message: string } };
    }
  ).safeParse(block.input);
  if (!parsed.success) {
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: `Invalid input for ${action.id}: ${parsed.error?.message ?? "schema violation"}`,
      is_error: true,
    };
  }

  // Confirmation gate for write / intent:
  //  - an action asks when it declares requiresConfirmation (writes and
  //    intents default to true), unless Approve all is on;
  //  - a destructive one (delete, remove, reset, clear, archive) always asks,
  //    whatever it declares, and Approve all can't switch that off;
  //  - forceConfirmWrites (visitors) asks for every non-read action whatever
  //    it declares, and Approve all can't switch that off either.
  const writes = action.category !== "read";
  const destructive = isDestructiveAction(action);
  const needsConfirm =
    destructive ||
    (action.requiresConfirmation ?? writes) ||
    (opts.forceConfirmWrites === true && writes);
  const skipConfirm = opts.autoApprove && opts.forceConfirmWrites !== true && !destructive;
  if (needsConfirm && !skipConfirm) {
    const ok = await opts.confirm(describeAction(action, parsed.data, destructive));
    if (!ok) {
      return {
        type: "tool_result",
        tool_use_id: block.id,
        content: `User denied execution of ${action.id}.`,
        is_error: true,
      };
    }
    // The card can wait a long time, and what may run can change meanwhile
    // (a visitor opens a live room). Ask again before running.
    if (opts.isAllowed && !opts.isAllowed(block.name)) {
      return {
        type: "tool_result",
        tool_use_id: block.id,
        content: `Tool not available: ${block.name}`,
        is_error: true,
      };
    }
  }

  const ctx = makeContext(opts.userId, "agent");
  // Race the handler against a 30 s timeout and the abort signal. Without the
  // timeout a hung/looping handler would wedge the whole agent turn (the
  // streaming loop awaits this result); abort wins if the turn is stopped
  // mid-handler (Stop, New chat, a thread switch, sign-out, a profile change),
  // so the loop unwinds immediately. Closing the panel doesn't abort.
  // guards.cleanup tears down the timer + listener once the race settles.
  const HANDLER_TIMEOUT_MS = 30_000;
  const guards = raceGuards(opts.signal, HANDLER_TIMEOUT_MS);
  try {
    const result = await Promise.race([action.handler(parsed.data, ctx), guards.promise]);
    return {
      type: "tool_result",
      tool_use_id: block.id,
      // JSON.stringify returns `undefined` (not a string) for a void/undefined
      // handler result; coerce to "null" so the tool_result content is always a
      // string — an undefined content drops the field and yields an invalid
      // block in the next API turn. (Mirrors the MCP transport's coercion.)
      content: JSON.stringify(result) ?? "null",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: `Handler error: ${msg}`,
      is_error: true,
    };
  } finally {
    guards.cleanup();
  }
}

// ── The confirm card's words ────────────────────────────────────────────

/** The most arguments the card names; the rest are counted. */
const DETAIL_FIELDS = 3;
/** The longest a quoted value runs before it is cut, in characters. */
const VALUE_MAX = 40;
/** What the card names a list of ids by: their count, never the ids. */
const ID_LIST_LABEL = "Items";

/** Verbs whose thing goes into the tool ("Add a card to Retro Board?"). */
const TO_VERBS: ReadonlySet<string> = new Set([
  "add",
  "assign",
  "attach",
  "invite",
  "link",
  "post",
]);
/** Verbs whose thing leaves the tool ("Delete this sprint from your workspace?"). */
const FROM_VERBS: ReadonlySet<string> = new Set([
  "archive",
  "clear",
  "delete",
  "detach",
  "remove",
  "unlink",
]);
/** Verbs that, with nothing after them, act on the whole tool ("Reset Health Check?"). */
const WHOLE_TOOL_VERBS: ReadonlySet<string> = new Set(["clear", "reset"]);
/** Verbs that make something new: "a card", where any other verb says "this card". */
const NEW_VERBS: ReadonlySet<string> = new Set([
  "add",
  "cast",
  "create",
  "log",
  "post",
  "raise",
  "record",
  "start",
  "suggest",
]);
/** First words that already say which one, or read better bare ("Toggle done"). */
const NO_ARTICLE: ReadonlySet<string> = new Set([
  "a",
  "all",
  "an",
  "current",
  "done",
  "each",
  "every",
  "its",
  "my",
  "new",
  "next",
  "our",
  "settings",
  "state",
  "that",
  "the",
  "their",
  "these",
  "this",
  "those",
  "your",
]);

/**
 * What a confirm card asks before `action` runs, in words: the tool's name and
 * the verb from tool-label, a question, and the checked arguments humanised.
 * The card, its step caption and a screen reader read these, so nothing here
 * is an action id, a key name or JSON; the raw arguments are only in the
 * owner's Details on the step, never on the card.
 */
function describeAction(
  action: AnyToolAction,
  input: unknown,
  destructive: boolean
): ConfirmPrompt {
  const label = toolLabel(action.id);
  const verb = label.verb || phrase(keyWords(action.name)) || "Go ahead";
  const confirmLabel = action.confirmLabel?.trim() || undefined;
  return {
    verb,
    title: label.tool,
    question: confirmLabel ? `${confirmLabel}?` : askQuestion(label.tool, verb),
    detail: describeParams(input),
    destructive,
    ...(confirmLabel ? { confirmLabel } : {}),
  };
}

/** The question for a verb in a tool: "Add a card to Retro Board?", "Reset Health Check?". */
function askQuestion(tool: string, verb: string): string {
  const where = tool === "Workspace" ? "your workspace" : tool;
  const [head = "", ...object] = verb.split(" ");
  const lead = head.toLowerCase();
  if (object.length === 0) {
    if (WHOLE_TOOL_VERBS.has(lead)) return `${head} ${where}?`;
    if (FROM_VERBS.has(lead)) return `${head} this from ${where}?`;
    return `${head} in ${where}?`;
  }
  const into = TO_VERBS.has(lead) ? "to" : FROM_VERBS.has(lead) ? "from" : "in";
  return `${head} ${withArticle(lead, object)} ${into} ${where}?`;
}

/** The verb's thing with the article it reads best with: "a card", "this card", "the order", "stories". */
function withArticle(verb: string, object: string[]): string {
  const thing = object.join(" ");
  const first = object[0].toLowerCase();
  const last = object[object.length - 1].toLowerCase();
  // Already says which, a participle ("Mark resolved"), or a plural ("Add stories").
  if (NO_ARTICLE.has(first) || /(?:ed|ing)$/.test(first) || /[^s]s$/.test(last)) return thing;
  if (verb === "set") return `the ${thing}`;
  if (!NEW_VERBS.has(verb)) return `this ${thing}`;
  return `${indefinite(object[0])} ${thing}`;
}

/** "a" or "an", by the word's first sound: "an OKR", "an update", "a user". */
function indefinite(word: string): "a" | "an" {
  // An acronym is said letter by letter: "an RFC", "a KPI".
  if (word.length > 1 && word === word.toUpperCase())
    return /^[AEFHILMNORSX]/.test(word) ? "an" : "a";
  return /^(?:[aeio]|u[b-df-hj-np-tv-z]{2})/i.test(word) ? "an" : "a";
}

/** A key's or a name's words in lower case: "columnKey" → column, key; "cast_vote" → cast, vote. */
function keyWords(key: string): string[] {
  return (
    key
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? []
  );
}

/** An argument's name in words: "columnKey" → "Column", "capacityPoints" → "Capacity points". */
function keyLabel(key: string): string {
  const words = keyWords(key);
  // "Key" says nothing a person needs ("columnKey" is the column).
  if (words.length > 1 && words[words.length - 1] === "key") words.pop();
  return phrase(words);
}

/** Arguments that hold a record's id under a name that doesn't say so. */
const ID_VALUE_KEYS: ReadonlySet<string> = new Set(["supersededBy"]);
/** A UUID: an id whatever key holds it ("chosenOption" takes an id or the option's text). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id or a list of ids ("id", "sprintId", "parentID", "ids", "item_ids", "supersededBy"): no use to a person. */
function isIdKey(key: string): boolean {
  return ID_VALUE_KEYS.has(key) || /^ids?$/i.test(key) || /(?:Ids?|IDs?|_ids?)$/.test(key);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A string quoted and cut to VALUE_MAX, or "" when it holds no words. */
function quoted(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const cut = flat.length > VALUE_MAX ? `${flat.slice(0, VALUE_MAX - 1).trimEnd()}…` : flat;
  return `“${cut}”`;
}

/** One value in words: quoted text, a number, yes or no, a short list or a count; "" to leave it out (a UUID too). */
function valueWords(v: unknown): string {
  if (typeof v === "string") return UUID.test(v.trim()) ? "" : quoted(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) {
    if (v.length === 0) return "";
    const scalars = v.every((x) => typeof x === "string" || typeof x === "number");
    if (scalars && v.length <= DETAIL_FIELDS) {
      return v.map(valueWords).filter(Boolean).join(", ");
    }
    return `${v.length} ${v.length === 1 ? "item" : "items"}`;
  }
  return "";
}

/**
 * The arguments as [name, value] pairs in words. Ids are left out (a list of
 * them is counted), by their key or, under any key, when the value is a UUID,
 * and an object's own fields stand in for it one level down,
 * so a workspace create's `entity` or an update's `patch` reads as its fields.
 */
function fieldsOf(input: unknown, nested = false): Array<[string, string]> {
  if (!isPlainObject(input)) return [];
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(input)) {
    if (isIdKey(key)) {
      if (Array.isArray(value) && value.length > 0) out.push([ID_LIST_LABEL, String(value.length)]);
      continue;
    }
    if (isPlainObject(value)) {
      if (!nested) out.push(...fieldsOf(value, true));
      continue;
    }
    const words = valueWords(value);
    const name = keyLabel(key);
    if (words && name) out.push([name, words]);
  }
  return out;
}

/** The arguments in a line: `Text: “flaky CI” · Column: “went-well”`, at most DETAIL_FIELDS, then a count. */
function describeParams(input: unknown): string {
  const fields = fieldsOf(input);
  const shown = fields.slice(0, DETAIL_FIELDS).map(([name, words]) => `${name}: ${words}`);
  const more = fields.length - DETAIL_FIELDS;
  if (more > 0) shown.push(`${more} more`);
  return shown.join(" · ");
}
