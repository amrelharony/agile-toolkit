// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseByteRange } from "@/lib/comic/byte-range";

/** Range parsing for the colour PDF route (single ranges, as pdf.js sends). */

const SIZE = 1000;

describe("parseByteRange", () => {
  it("sends the whole file without a Range header", () => {
    expect(parseByteRange(null, SIZE)).toBeNull();
    expect(parseByteRange(undefined, SIZE)).toBeNull();
    expect(parseByteRange("", SIZE)).toBeNull();
  });

  it("reads a closed range, inclusive at both ends", () => {
    expect(parseByteRange("bytes=0-99", SIZE)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange("bytes=500-500", SIZE)).toEqual({ start: 500, end: 500 });
  });

  it("clamps an end past the file to its last byte", () => {
    expect(parseByteRange("bytes=900-5000", SIZE)).toEqual({ start: 900, end: 999 });
  });

  it("reads an open-ended range to the end of the file", () => {
    expect(parseByteRange("bytes=900-", SIZE)).toEqual({ start: 900, end: 999 });
  });

  it("reads a suffix range as the last N bytes", () => {
    expect(parseByteRange("bytes=-100", SIZE)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange("bytes=-5000", SIZE)).toEqual({ start: 0, end: 999 });
  });

  it("answers 416 for a range that misses the file", () => {
    expect(parseByteRange("bytes=1000-1200", SIZE)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=1000-", SIZE)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=-0", SIZE)).toBe("unsatisfiable");
  });

  it("ignores ranges it doesn't serve: several, backwards, other units, junk", () => {
    expect(parseByteRange("bytes=0-1,5-9", SIZE)).toBeNull();
    expect(parseByteRange("bytes=50-10", SIZE)).toBeNull();
    expect(parseByteRange("items=0-1", SIZE)).toBeNull();
    expect(parseByteRange("bytes=-", SIZE)).toBeNull();
    expect(parseByteRange("bytes=a-b", SIZE)).toBeNull();
  });
});
