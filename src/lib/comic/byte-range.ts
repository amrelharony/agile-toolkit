/**
 * HTTP `Range: bytes=…` parsing for serving a PDF to pdf.js, which asks for
 * one range at a time (1 MB chunks, see use-pdf-document.ts).
 *
 * Only a single range is honoured. Anything else — several ranges, another
 * unit, a malformed or backwards range — is ignored and the whole file is
 * sent, which RFC 9110 allows (a server MAY ignore Range). Pure: the route
 * handler does the file I/O.
 */

export type ByteRange = { start: number; end: number };

/**
 * @returns the inclusive byte range to send, `null` to send the whole file,
 *   or "unsatisfiable" for a well-formed range that misses the file (416).
 */
export function parseByteRange(
  header: string | null | undefined,
  size: number
): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;

  if (rawStart === "") {
    // Suffix range: the last N bytes.
    if (rawEnd === "") return null;
    const length = Number(rawEnd);
    if (length === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - length), end: size - 1 };
  }

  const start = Number(rawStart);
  if (rawEnd !== "" && Number(rawEnd) < start) return null;
  if (start >= size) return "unsatisfiable";
  return { start, end: rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1) };
}
