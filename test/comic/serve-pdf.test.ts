// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { servePdf } from "@/lib/comic/serve-pdf";

/** servePdf against a real file: what pdf.js sees from the colour PDF route. */

const dir = mkdtempSync(path.join(tmpdir(), "serve-pdf-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const BODY = `%PDF-1.7\n${"x".repeat(1000)}\n%%EOF\n`;
const FILE = path.join(dir, "edition.pdf");
writeFileSync(FILE, BODY);
const SIZE = Buffer.byteLength(BODY);

describe("servePdf", () => {
  it("sends the whole file, advertising range support", async () => {
    const res = await servePdf(FILE, null, { "Cache-Control": "private, max-age=60" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBe(String(SIZE));
    expect(res.headers.get("content-range")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
    expect(await res.text()).toBe(BODY);
  });

  it("answers a range request with 206 and just those bytes", async () => {
    const res = await servePdf(FILE, "bytes=0-7");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 0-7/${SIZE}`);
    expect(res.headers.get("content-length")).toBe("8");
    expect(await res.text()).toBe("%PDF-1.7");
  });

  it("serves the tail of the file for a suffix range", async () => {
    const res = await servePdf(FILE, "bytes=-6");
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("%%EOF\n");
  });

  it("answers 416 with the real size for a range past the end", async () => {
    const res = await servePdf(FILE, `bytes=${SIZE}-`);
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${SIZE}`);
  });

  it("answers 404 when the file is missing or empty", async () => {
    expect((await servePdf(path.join(dir, "nope.pdf"), null)).status).toBe(404);
    const empty = path.join(dir, "empty.pdf");
    writeFileSync(empty, "");
    expect((await servePdf(empty, null)).status).toBe(404);
  });
});
