/**
 * Read a Web `Request` body as text with a hard byte cap enforced WHILE
 * streaming — independent of the `Content-Length` header.
 *
 * Why this exists: the MCP route's original guard only inspected the
 * `content-length` header (see route.ts). A client using HTTP/1.1 chunked
 * transfer-encoding — or one that simply omits the header — bypassed the cap
 * entirely, and `req.json()` would then buffer the whole stream before
 * parsing. That is the exact "stream multi-MB JSON at a serverless function"
 * attack the header check claims to stop. App Router Route Handlers impose no
 * body limit of their own (the legacy `bodyParser` 1 MB cap was Pages-API
 * only), so the header was the only line of defence.
 *
 * This reads the body stream chunk-by-chunk, cancelling the stream the moment
 * the running total exceeds `maxBytes`, so an oversize or header-less payload
 * can never force unbounded buffering — regardless of what (if anything) the
 * client advertised in `Content-Length`.
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
    if (Buffer.byteLength(text) > maxBytes) throw new PayloadTooLargeError(maxBytes);
    return text;
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
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
      // Buffer.from(Uint8Array) copies the bytes, so cancelling/releasing the
      // underlying stream later can't corrupt what we've accumulated.
      chunks.push(Buffer.from(value));
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* reader already released after cancel — nothing to do */
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}
