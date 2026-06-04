/**
 * Read a Web `Request` body as text with a hard byte cap enforced WHILE
 * streaming — independent of the `Content-Length` header.
 *
 * Why this exists: a route's body-size guard that only inspects the
 * `content-length` header is bypassed by a client using HTTP/1.1 chunked
 * transfer-encoding (or one that simply omits the header) — `req.json()`
 * would then buffer the whole stream before parsing. That is the
 * "stream multi-MB JSON at a serverless function" DoS the header check claims
 * to stop. App Router Route Handlers impose no body limit of their own.
 *
 * This reads the body stream chunk-by-chunk, cancelling the moment the running
 * total exceeds `maxBytes`, so an oversize or header-less payload can never
 * force unbounded buffering — regardless of what the client advertised.
 *
 * Implemented with Web APIs only (ReadableStream / TextDecoder / Uint8Array,
 * no Node `Buffer`) so it is safe in BOTH the Node and Edge runtimes — the MCP
 * route runs on Node, the agent stream route on Edge.
 */

export class PayloadTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "PayloadTooLargeError";
  }
}

export async function readBoundedText(req: Request, maxBytes: number): Promise<string> {
  const body = req.body;
  // No stream available (e.g. a runtime that already buffered the body, or a
  // bodyless request). Fall back to text(), but still enforce the cap on the
  // materialised result so the contract holds either way.
  if (!body) {
    const text = await req.text();
    if (new TextEncoder().encode(text).length > maxBytes) throw new PayloadTooLargeError(maxBytes);
    return text;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new PayloadTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* reader already released after cancel — nothing to do */
    }
  }

  // Concatenate all bytes, THEN decode once — so a multibyte UTF-8 character
  // split across a chunk boundary is decoded correctly (per-chunk decoding
  // would corrupt it).
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}
