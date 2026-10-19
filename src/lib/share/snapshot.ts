/**
 * Snapshot links: share a read-only copy of a tool's state without a server.
 *
 * The state is JSON → deflate-raw (CompressionStream) → base64url, placed in
 * the URL *fragment* (`/s#s1.<payload>`). Browsers never send the fragment
 * to the server, so the data stays between the sender and whoever opens the
 * link — consistent with "your data stays in your browser". Opening the link
 * renders the snapshot read-only with "Copy into my browser".
 *
 * Untrusted input on decode: size-capped before and after decompression,
 * parsed with a prototype-safe reviver, and checked by a caller-supplied
 * validator for the tool's shape.
 */

export const SNAPSHOT_VERSION = 1;
/** Above this the link gets unwieldy in chat apps; callers should warn. */
export const SNAPSHOT_WARN_CHARS = 8 * 1024;
/** Hard cap on the encoded payload we create or accept. */
export const SNAPSHOT_MAX_CHARS = 32 * 1024;
/** Hard cap on decompressed JSON, to stop decompression bombs. */
export const SNAPSHOT_MAX_DECODED_BYTES = 1024 * 1024;

const PREFIX = "s1.";

export interface SnapshotEnvelope<T> {
  v: typeof SNAPSHOT_VERSION;
  /** Tool id, e.g. "retro". */
  tool: string;
  /** Tool-defined schema version for `data`. */
  schema: number;
  createdAt: string;
  title?: string;
  data: T;
}

export class SnapshotError extends Error {}

function safeReviver(key: string, value: unknown): unknown {
  if (key === "__proto__" || key === "constructor" || key === "prototype") return undefined;
  return value;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new SnapshotError("The link is damaged.");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
  limit?: number
) {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = source
    .pipeThrough(stream as unknown as TransformStream<Uint8Array, Uint8Array>)
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (limit !== undefined && total > limit) {
      await reader.cancel();
      throw new SnapshotError("This snapshot is too large to open.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Whether this browser can create and open snapshot links. */
export function snapshotsSupported(): boolean {
  return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
}

/** Encode a snapshot into the fragment payload (without the leading `#`). */
export async function encodeSnapshot<T>(
  envelope: Omit<SnapshotEnvelope<T>, "v" | "createdAt"> & { createdAt?: string }
): Promise<string> {
  const full: SnapshotEnvelope<T> = {
    v: SNAPSHOT_VERSION,
    createdAt: envelope.createdAt ?? new Date().toISOString(),
    tool: envelope.tool,
    schema: envelope.schema,
    title: envelope.title,
    data: envelope.data,
  };
  const json = new TextEncoder().encode(JSON.stringify(full));
  const compressed = await pipe(json, new CompressionStream("deflate-raw"));
  const payload = PREFIX + toBase64Url(compressed);
  if (payload.length > SNAPSHOT_MAX_CHARS) {
    throw new SnapshotError(
      "This board is too big to share as a link. Export it as a file instead."
    );
  }
  return payload;
}

/**
 * Decode a fragment payload. `validate` checks the tool-specific `data`
 * shape; anything that fails is rejected with a user-facing message.
 */
export async function decodeSnapshot<T>(
  fragment: string,
  validate: (data: unknown, envelope: { tool: string; schema: number }) => data is T
): Promise<SnapshotEnvelope<T>> {
  const payload = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (!payload.startsWith(PREFIX)) throw new SnapshotError("This isn't a snapshot link.");
  if (payload.length > SNAPSHOT_MAX_CHARS) throw new SnapshotError("This link is too long.");
  let json: string;
  try {
    const bytes = await pipe(
      fromBase64Url(payload.slice(PREFIX.length)),
      new DecompressionStream("deflate-raw"),
      SNAPSHOT_MAX_DECODED_BYTES
    );
    json = new TextDecoder().decode(bytes);
  } catch (err) {
    if (err instanceof SnapshotError) throw err;
    throw new SnapshotError("The link is damaged or incomplete.");
  }
  let parsed: Partial<SnapshotEnvelope<unknown>>;
  try {
    parsed = JSON.parse(json, safeReviver);
  } catch {
    throw new SnapshotError("The link is damaged or incomplete.");
  }
  if (!parsed || typeof parsed !== "object" || parsed.v !== SNAPSHOT_VERSION) {
    throw new SnapshotError("This snapshot was made by a newer version of the toolkit.");
  }
  if (typeof parsed.tool !== "string" || typeof parsed.schema !== "number") {
    throw new SnapshotError("The link is damaged or incomplete.");
  }
  if (!validate(parsed.data, { tool: parsed.tool, schema: parsed.schema })) {
    throw new SnapshotError("This snapshot doesn't contain a valid board.");
  }
  return {
    v: SNAPSHOT_VERSION,
    tool: parsed.tool,
    schema: parsed.schema,
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
    title: typeof parsed.title === "string" ? parsed.title : undefined,
    data: parsed.data as T,
  };
}
