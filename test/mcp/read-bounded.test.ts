/**
 * Streaming body-size cap for the MCP route.
 *
 * The route originally guarded body size via the `Content-Length` header
 * only, which a chunked / header-less client bypasses. `readBoundedText`
 * enforces the cap WHILE reading the stream, so these cases prove the cap
 * holds with AND without a Content-Length header.
 */

import { describe, it, expect } from "vitest";
import { readBoundedText, PayloadTooLargeError } from "@/lib/mcp/read-bounded";

/** A chunked ReadableStream body — Node/undici sends this without a
 *  Content-Length header, exactly like an HTTP/1.1 chunked client. */
function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

function streamRequest(chunks: string[]): Request {
  return new Request("http://x/api/mcp", {
    method: "POST",
    body: streamFrom(chunks),
    // undici requires duplex for a stream body.
    ...({ duplex: "half" } as Record<string, unknown>),
  });
}

describe("readBoundedText", () => {
  it("returns the full body when under the cap (string body)", async () => {
    const req = new Request("http://x/api/mcp", { method: "POST", body: '{"a":1}' });
    expect(await readBoundedText(req, 1024)).toBe('{"a":1}');
  });

  it("enforces the cap even with NO Content-Length (chunked stream)", async () => {
    const big = "x".repeat(2000);
    const req = streamRequest([big, big]); // 4000 bytes, no content-length
    // Precondition: this is the bypass case — the header is absent.
    expect(req.headers.get("content-length")).toBeNull();
    await expect(readBoundedText(req, 1024)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("accepts a multi-chunk stream body that fits under the cap", async () => {
    const req = streamRequest(["{", '"ok":true', "}"]);
    expect(await readBoundedText(req, 1024)).toBe('{"ok":true}');
  });

  it("rejects exactly one byte over the cap", async () => {
    const req = streamRequest(["a".repeat(11)]);
    await expect(readBoundedText(req, 10)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("accepts a body exactly at the cap", async () => {
    const req = streamRequest(["a".repeat(10)]);
    expect(await readBoundedText(req, 10)).toBe("a".repeat(10));
  });
});
