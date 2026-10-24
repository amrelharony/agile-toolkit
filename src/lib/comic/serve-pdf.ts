import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { parseByteRange } from "./byte-range";

/**
 * Stream a PDF from disk with byte-range support, for a route handler.
 *
 * pdf.js first sends a plain GET to learn the length and whether ranges
 * work (`Accept-Ranges: bytes`, no Content-Encoding), cancels it, then asks
 * for 1 MB ranges. The file is streamed, never read whole, and a cancelled
 * response destroys the file stream behind it. Node runtime only.
 *
 * @param headers extra headers (cache policy, robots, disposition) sent on
 *   every answer that carries the file.
 */
export async function servePdf(
  file: string,
  rangeHeader: string | null,
  headers: Record<string, string> = {}
): Promise<Response> {
  let size: number;
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size === 0) return notFound();
    size = info.size;
  } catch {
    return notFound();
  }

  const range = parseByteRange(rangeHeader, size);
  const out = new Headers(headers);
  out.set("Content-Type", "application/pdf");
  out.set("Accept-Ranges", "bytes");

  if (range === "unsatisfiable") {
    out.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers: out });
  }

  const { start, end } = range ?? { start: 0, end: size - 1 };
  out.set("Content-Length", String(end - start + 1));
  if (range) out.set("Content-Range", `bytes ${start}-${end}/${size}`);
  // Node's web stream type and the DOM's are the same object at runtime.
  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, { status: range ? 206 : 200, headers: out });
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
