import { describe, it, expect } from "vitest";
import {
  QR_MAX_BYTES,
  QR_MAX_VERSION,
  QR_QUIET_ZONE,
  QR_VERSIONS,
  encodeQr,
  qrBlocks,
  qrByteCapacity,
  qrDataCapacity,
  qrDataCodewords,
  qrErrorCorrection,
  qrFormatBits,
  qrFunctionPatterns,
  qrGenerator,
  qrInterleave,
  qrMaskBit,
  qrPath,
  qrPenalty,
  qrSize,
  qrVersionBits,
  qrVersionFor,
  type QrCode,
} from "@/lib/qr/encode";
import {
  ALIGNMENT_CENTRES,
  alignmentPatterns,
  decodeQr,
  formatBitPositions,
  isFunctionModule,
  maskFlips,
  rasterisePath,
  stripQuietZone,
  syndromes,
} from "./decoder";

/**
 * The QR encoder in src/lib/qr, checked against the standard's own numbers
 * and against a decoder written for these tests (./decoder.ts), which
 * shares no code with it.
 */

const VERSIONS = Array.from({ length: QR_MAX_VERSION }, (_, i) => i + 1);
const MASK_NUMBERS = [0, 1, 2, 3, 4, 5, 6, 7];

/** Text of exactly `length` ASCII bytes that looks like a link. */
function linkOfLength(length: number): string {
  const head = "https://agile.amrelharony.com/join/retro/";
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz-_=#";
  let out = head.slice(0, length);
  for (let i = out.length; i < length; i++) out += alphabet[(i * 7) % alphabet.length];
  return out;
}

function mustEncode(text: string, mask?: number): QrCode {
  const qr = encodeQr(text, mask === undefined ? {} : { mask });
  if (!qr) throw new Error(`no QR code for ${text.length} characters`);
  return qr;
}

/** A symbol of each version, at the version's full capacity. */
const FULL = VERSIONS.map((version) => mustEncode(linkOfLength(qrByteCapacity(version))));

function square(qr: QrCode, top: number, left: number, side: number): string[] {
  return Array.from({ length: side }, (_, r) =>
    Array.from({ length: side }, (_, c) => (qr.modules[top + r][left + c] ? "1" : "0")).join("")
  );
}

describe("sizes and capacities at level M", () => {
  it("covers versions 1 to 10, 21 to 57 modules a side", () => {
    expect(QR_MAX_VERSION).toBe(10);
    expect(VERSIONS.map(qrSize)).toEqual([21, 25, 29, 33, 37, 41, 45, 49, 53, 57]);
    expect(() => qrSize(0)).toThrow(RangeError);
    expect(() => qrSize(11)).toThrow(RangeError);
    expect(() => qrSize(2.5)).toThrow(RangeError);
  });

  it("holds the standard's data codewords and bytes per version", () => {
    // ISO/IEC 18004 table 7, level M.
    expect(VERSIONS.map(qrDataCapacity)).toEqual([16, 28, 44, 64, 86, 108, 124, 154, 182, 216]);
    expect(VERSIONS.map(qrByteCapacity)).toEqual([14, 26, 42, 62, 84, 106, 122, 152, 180, 213]);
    expect(QR_MAX_BYTES).toBe(213);
  });

  it("picks the smallest version that fits", () => {
    expect(qrVersionFor(1)).toBe(1);
    for (const version of VERSIONS) {
      const capacity = qrByteCapacity(version);
      expect(qrVersionFor(capacity)).toBe(version);
      expect(qrVersionFor(capacity + 1)).toBe(version === QR_MAX_VERSION ? null : version + 1);
    }
  });

  it("gives null for an empty text and for one past the largest version", () => {
    expect(encodeQr("")).toBeNull();
    expect(encodeQr(linkOfLength(QR_MAX_BYTES + 1))).toBeNull();
    expect(encodeQr(linkOfLength(QR_MAX_BYTES))?.version).toBe(10);
    // Bytes count, not characters: 72 three-byte characters are 216 bytes.
    expect(encodeQr("€".repeat(72))).toBeNull();
    expect(encodeQr("€".repeat(71))?.version).toBe(10);
  });

  it.each(VERSIONS)("version %i: the fixed patterns leave room for its codewords", (version) => {
    const { reserved } = qrFunctionPatterns(version);
    const free = reserved.flat().filter((r) => !r).length;
    expect(Math.floor(free / 8)).toBe(QR_VERSIONS[version - 1].totalCodewords);
    // Table 1: the remainder bits.
    expect(free % 8).toBe(version >= 2 && version <= 6 ? 7 : 0);
  });

  it.each(VERSIONS)("version %i: reserves exactly the modules the layout says", (version) => {
    const { reserved } = qrFunctionPatterns(version);
    const size = qrSize(version);
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        expect(reserved[row][column], `row ${row}, column ${column}`).toBe(
          isFunctionModule(version, row, column)
        );
      }
    }
  });
});

describe("finder, timing and alignment patterns", () => {
  const FINDER = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"];
  const ALIGNMENT = ["11111", "10001", "10101", "10001", "11111"];

  it.each(FULL)("version $version: three finders, each inside a light separator", (qr) => {
    const n = qr.size;
    expect(square(qr, 0, 0, 7)).toEqual(FINDER);
    expect(square(qr, 0, n - 7, 7)).toEqual(FINDER);
    expect(square(qr, n - 7, 0, 7)).toEqual(FINDER);
    for (let i = 0; i < 8; i++) {
      // Top left: row 7 and column 7.
      expect(qr.modules[7][i]).toBe(false);
      expect(qr.modules[i][7]).toBe(false);
      // Top right: row 7 and column n - 8.
      expect(qr.modules[7][n - 1 - i]).toBe(false);
      expect(qr.modules[i][n - 8]).toBe(false);
      // Bottom left: row n - 8 and column 7.
      expect(qr.modules[n - 8][i]).toBe(false);
      expect(qr.modules[n - 1 - i][7]).toBe(false);
    }
    // No fourth finder in the bottom-right corner.
    expect(square(qr, n - 7, n - 7, 7)).not.toEqual(FINDER);
  });

  it.each(FULL)("version $version: timing lines alternate between the finders", (qr) => {
    for (let i = 8; i <= qr.size - 9; i++) {
      expect(qr.modules[6][i], `row 6, column ${i}`).toBe(i % 2 === 0);
      expect(qr.modules[i][6], `row ${i}, column 6`).toBe(i % 2 === 0);
    }
  });

  it.each(FULL)("version $version: alignment patterns at the standard's centres", (qr) => {
    const centres = alignmentPatterns(qr.version);
    expect(centres).toHaveLength(qr.version === 1 ? 0 : qr.version < 7 ? 1 : 6);
    for (const [row, column] of centres) {
      expect(square(qr, row - 2, column - 2, 5), `centre ${row}, ${column}`).toEqual(ALIGNMENT);
    }
  });

  it("puts version 2's one alignment pattern at 18, 18 and version 7's six where Annex E says", () => {
    expect(alignmentPatterns(2)).toEqual([[18, 18]]);
    expect(alignmentPatterns(7)).toEqual([
      [6, 22],
      [22, 6],
      [22, 22],
      [22, 38],
      [38, 22],
      [38, 38],
    ]);
    expect(QR_VERSIONS.map((v) => v.align)).toEqual(VERSIONS.map((v) => ALIGNMENT_CENTRES[v]));
  });
});

describe("format and version bits", () => {
  // ISO/IEC 18004 Annex C, level M, masks 0 to 7.
  const FORMAT_M = [
    0b101010000010010, 0b101000100100101, 0b101111001111100, 0b101101101001011, 0b100010111111001,
    0b100000011001110, 0b100111110010111, 0b100101010100000,
  ];

  it("computes the standard's 15 format bits for each mask", () => {
    expect(MASK_NUMBERS.map(qrFormatBits)).toEqual(FORMAT_M);
  });

  it.each(MASK_NUMBERS)("mask %i: both copies of the format bits are in the symbol", (mask) => {
    for (const text of [linkOfLength(20), linkOfLength(130)]) {
      const qr = mustEncode(text, mask);
      const [first, second] = formatBitPositions(qr.size);
      const read = (positions: [number, number][]) =>
        positions.reduce((acc, [r, c], bit) => acc | (Number(qr.modules[r][c]) << bit), 0);
      expect(read(first)).toBe(FORMAT_M[mask]);
      expect(read(second)).toBe(FORMAT_M[mask]);
      // The module beside the bottom-left finder is always dark.
      expect(qr.modules[qr.size - 8][8]).toBe(true);
      const decoded = decodeQr(qr.modules);
      expect(decoded.mask).toBe(mask);
      expect(decoded.levelBits).toBe(0b00);
    }
  });

  it("computes the standard's 18 version bits for versions 7 to 10", () => {
    // ISO/IEC 18004 Annex D.
    expect([7, 8, 9, 10].map(qrVersionBits)).toEqual([0x07c94, 0x085bc, 0x09a99, 0x0a4d3]);
  });

  it.each(FULL)("version $version: version bits in both blocks from version 7", (qr) => {
    const decoded = decodeQr(qr.modules);
    if (qr.version < 7) {
      expect(decoded.versionCopies).toBeNull();
    } else {
      expect(decoded.versionCopies).toEqual([qrVersionBits(qr.version), qrVersionBits(qr.version)]);
    }
  });
});

describe("data codewords", () => {
  const ascii = (text: string) => new TextEncoder().encode(text);

  it("writes the mode, the length, the bytes, a terminator and the pad bytes", () => {
    // 0100 | 00000010 | 01101000 01101001 | 0000, then EC and 11 in turn.
    expect(qrDataCodewords(ascii("hi"), 1)).toEqual([
      0x40, 0x26, 0x86, 0x90, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec,
      0x11,
    ]);
  });

  it("uses a 16-bit length from version 10", () => {
    const codewords = qrDataCodewords(ascii("hi"), 10);
    // 0100 | 0000000000000010 | 0110 1000 0110 1001 | 0000
    expect(codewords.slice(0, 6)).toEqual([0x40, 0x00, 0x26, 0x86, 0x90, 0xec]);
    expect(codewords).toHaveLength(216);
  });

  it.each(VERSIONS)("version %i: a text at full capacity leaves no padding", (version) => {
    const text = linkOfLength(qrByteCapacity(version));
    const codewords = qrDataCodewords(ascii(text), version);
    expect(codewords).toHaveLength(qrDataCapacity(version));
    expect(decodeQr(mustEncode(text).modules).padding).toEqual([]);
  });

  it("pads with EC then 11, in that order, up to the version's capacity", () => {
    const decoded = decodeQr(mustEncode(linkOfLength(30)).modules); // version 3: 44 data codewords
    expect(decoded.version).toBe(3);
    expect(decoded.padding).toHaveLength(44 - 32);
    decoded.padding.forEach((pad, i) => expect(pad).toBe(i % 2 === 0 ? 0xec : 0x11));
  });

  it("refuses bytes that do not fit the version", () => {
    expect(() => qrDataCodewords(ascii(linkOfLength(15)), 1)).toThrow(RangeError);
  });
});

describe("Reed-Solomon error correction", () => {
  it("builds the standard's generator polynomial for 7 codewords", () => {
    // Annex A: x^7 + 127x^6 + 122x^5 + 154x^4 + 164x^3 + 11x^2 + 68x + 117.
    expect(qrGenerator(7)).toEqual([127, 122, 154, 164, 11, 68, 117]);
  });

  it("matches a published worked example (HELLO WORLD at 1-M)", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(qrErrorCorrection(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it.each([7, 10, 16, 18, 22, 24, 26])("%i codewords: the block's syndromes are all zero", (n) => {
    const data = Array.from({ length: 40 }, (_, i) => (i * 37 + n * 11) % 256);
    const block = [...data, ...qrErrorCorrection(data, n)];
    expect(syndromes(block, n)).toEqual(new Array(n).fill(0));
    // One wrong codeword and they are not.
    block[5] ^= 0x01;
    expect(syndromes(block, n).some((s) => s !== 0)).toBe(true);
  });

  it.each(FULL)("version $version: every block in the symbol has zero syndromes", (qr) => {
    const spec = QR_VERSIONS[qr.version - 1];
    const { blocks } = decodeQr(qr.modules);
    expect(blocks).toHaveLength(spec.blocks);
    for (const block of blocks) {
      expect(block.ec).toHaveLength(spec.ecPerBlock);
      expect(syndromes([...block.data, ...block.ec], spec.ecPerBlock)).toEqual(
        new Array(spec.ecPerBlock).fill(0)
      );
    }
  });
});

describe("blocks and interleaving", () => {
  it("gives the later blocks the extra data codeword", () => {
    const sizes = (version: number) =>
      qrBlocks(
        Array.from({ length: qrDataCapacity(version) }, (_, i) => i % 256),
        version
      ).map((b) => b.data.length);
    expect(sizes(4)).toEqual([32, 32]);
    expect(sizes(8)).toEqual([38, 38, 39, 39]);
    expect(sizes(9)).toEqual([36, 36, 36, 37, 37]);
    expect(sizes(10)).toEqual([43, 43, 43, 43, 44]);
  });

  it("takes the data codewords in order, block after block", () => {
    const data = Array.from({ length: qrDataCapacity(8) }, (_, i) => i);
    const blocks = qrBlocks(data, 8);
    expect(blocks.flatMap((b) => b.data)).toEqual(data);
    expect(() => qrBlocks(data.slice(1), 8)).toThrow(RangeError);
  });

  it("interleaves data codewords, then error-correction codewords, one from each block in turn", () => {
    const blocks = [
      { data: [1, 2], ec: [10, 11] },
      { data: [3, 4], ec: [12, 13] },
      { data: [5, 6, 7], ec: [14, 15] },
    ];
    expect(qrInterleave(blocks)).toEqual([1, 3, 5, 2, 4, 6, 7, 10, 12, 14, 11, 13, 15]);
  });

  it.each(FULL)("version $version: the symbol carries every codeword once", (qr) => {
    const decoded = decodeQr(qr.modules);
    expect(decoded.codewords).toHaveLength(QR_VERSIONS[qr.version - 1].totalCodewords);
    expect(decoded.remainderBits).toEqual(
      new Array(qr.version >= 2 && qr.version <= 6 ? 7 : 0).fill(0)
    );
  });
});

describe("masks and the penalty score", () => {
  it("applies the standard's eight mask conditions", () => {
    for (const mask of MASK_NUMBERS) {
      for (let row = 0; row < 12; row++) {
        for (let column = 0; column < 12; column++) {
          expect(qrMaskBit(mask, row, column), `mask ${mask} at ${row}, ${column}`).toBe(
            maskFlips(mask, row, column)
          );
        }
      }
    }
    expect(() => qrMaskBit(8, 0, 0)).toThrow(RangeError);
  });

  it("never masks a fixed module: the eight masks differ only in data and format modules", () => {
    const text = linkOfLength(100);
    const version = mustEncode(text).version;
    const { modules: fixed, reserved } = qrFunctionPatterns(version);
    const formatModules = new Set(
      formatBitPositions(qrSize(version))
        .flat()
        .map(([r, c]) => `${r},${c}`)
    );
    for (const mask of MASK_NUMBERS) {
      const qr = mustEncode(text, mask);
      reserved.forEach((row, r) =>
        row.forEach((isFixed, c) => {
          if (isFixed && !formatModules.has(`${r},${c}`))
            expect(qr.modules[r][c]).toBe(fixed[r][c]);
        })
      );
    }
  });

  it("scores an all-light symbol by runs, blocks and balance", () => {
    const light = Array.from({ length: 21 }, () => new Array<boolean>(21).fill(false));
    // Rule 1: 42 lines of 21, each 3 + 16. Rule 2: 20 × 20 blocks at 3.
    // Rule 3: none. Rule 4: no dark modules at all, 9 steps of 5% from half.
    expect(qrPenalty(light)).toBe(42 * 19 + 400 * 3 + 90);
  });

  it("scores a checkerboard at zero", () => {
    const board = Array.from({ length: 21 }, (_, r) =>
      Array.from({ length: 21 }, (_, c) => (r + c) % 2 === 0)
    );
    expect(qrPenalty(board)).toBe(0);
  });

  it("charges 40 for a finder look-alike with four light modules beside it", () => {
    const board = Array.from({ length: 11 }, (_, r) =>
      Array.from({ length: 11 }, (_, c) => (r + c) % 2 === 1)
    );
    const before = board.map((row) => [...row]);
    board[0] = [true, false, true, true, true, false, true, false, false, false, false];
    expect(qrPenalty(before)).toBe(0);
    expect(qrPenalty(board)).toBe(40);
    // The same on its side, the light modules first.
    const turned = board.map((_, r) => board.map((row) => row[r])).reverse();
    expect(qrPenalty(turned)).toBe(40);
  });

  it("charges 3 for five in a row and 1 more for each module after that", () => {
    const withRow5 = (row: number[]) => {
      const board = Array.from({ length: 11 }, (_, r) =>
        Array.from({ length: 11 }, (_, c) => (r + c) % 2 === 1)
      );
      board[5] = row.map((v) => v === 1);
      return board;
    };
    // The rest of the board is a checkerboard, so only row 5's run counts.
    expect(qrPenalty(withRow5([1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0]))).toBe(0);
    expect(qrPenalty(withRow5([1, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1]))).toBe(3);
    expect(qrPenalty(withRow5([1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0]))).toBe(4);
    expect(qrPenalty(withRow5([1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1]))).toBe(5);
    // Light runs count the same.
    expect(qrPenalty(withRow5([0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0]))).toBe(3);
  });

  it.each([
    linkOfLength(12),
    linkOfLength(52),
    linkOfLength(92),
    linkOfLength(150),
    linkOfLength(213),
  ])("chooses the mask with the lowest penalty (%#)", (text) => {
    const chosen = mustEncode(text);
    const scores = MASK_NUMBERS.map((mask) => qrPenalty(mustEncode(text, mask).modules));
    expect(qrPenalty(chosen.modules)).toBe(Math.min(...scores));
    // The first of equals, so the result is the same on every run.
    expect(chosen.mask).toBe(scores.indexOf(Math.min(...scores)));
    expect(chosen.modules).toEqual(mustEncode(text, chosen.mask).modules);
  });
});

describe("round trip through the test decoder", () => {
  const CODE = "ABCDEFGHJKMN";
  const LINKS = [
    ["a short local link", `http://localhost:3000/join/retro/${CODE}`],
    ["a Poker link", `https://agile.amrelharony.com/join/planning-poker/${CODE}`],
    ["a Retro link", `https://agile.amrelharony.com/join/retro/${CODE}`],
    [
      "a vote-round link with its #k= part",
      `https://agile.amrelharony.com/join/hundred-dollar-test/${CODE}#k=abcdefghijklmnopqrstuv`,
    ],
    [
      "a vote-round link with the longest #k= part the chip allows",
      `https://agile.amrelharony.com/join/psych-safety/${CODE}#k=${"Ab0_-=".repeat(10)}xy`,
    ],
    [
      "a preview deployment's long link",
      `https://agile-toolkit-git-claude-live-rooms-qr-code-amrs-projects-88452763.vercel.app/join/hundred-dollar-test/${CODE}#k=abcdefghijklmnopqrstuv`,
    ],
  ] as const;

  it.each(LINKS)("%s", (_label, link) => {
    const qr = mustEncode(link);
    const decoded = decodeQr(qr.modules);
    expect(decoded.text).toBe(link);
    expect(decoded.version).toBe(qr.version);
    expect(decoded.version).toBe(qrVersionFor(link.length));
    expect(decoded.mask).toBe(qr.mask);
    expect(decoded.levelBits).toBe(0b00);
    expect(qr.size).toBe(17 + 4 * qr.version);
    expect(qr.modules).toHaveLength(qr.size);
  });

  it("covers every version from 1 to 10 with links of growing length", () => {
    const seen = new Set<number>();
    for (let length = 1; length <= QR_MAX_BYTES; length++) {
      const link = linkOfLength(length);
      const qr = mustEncode(link);
      expect(decodeQr(qr.modules).text, `${length} bytes`).toBe(link);
      seen.add(qr.version);
    }
    expect(Array.from(seen).sort((a, b) => a - b)).toEqual(VERSIONS);
  });

  it.each(MASK_NUMBERS)("mask %i reads back, whichever version", (mask) => {
    for (const length of [9, 40, 80, 120, 170, 213]) {
      const link = linkOfLength(length);
      expect(decodeQr(mustEncode(link, mask).modules).text).toBe(link);
    }
  });

  it("reads back text outside ASCII as UTF-8", () => {
    const text = "Rétro d'équipe ☕ الفريق";
    const decoded = decodeQr(mustEncode(text).modules);
    expect(decoded.text).toBe(text);
    expect(decoded.bytes).toHaveLength(new TextEncoder().encode(text).length);
  });

  it("the decoder itself refuses a symbol with one module flipped", () => {
    const qr = mustEncode(LINKS[2][1]);
    const broken = qr.modules.map((row) => [...row]);
    // A data module well away from the fixed patterns.
    const at = qr.size - 3;
    expect(isFunctionModule(qr.version, at, at)).toBe(false);
    broken[at][at] = !broken[at][at];
    expect(() => decodeQr(broken)).toThrow(/Reed-Solomon/);
  });
});

describe("qrPath", () => {
  it.each(FULL)("version $version: draws exactly the dark modules, inside the quiet zone", (qr) => {
    const side = qr.size + 2 * QR_QUIET_ZONE;
    const drawn = rasterisePath(qrPath(qr), side);
    expect(stripQuietZone(drawn, QR_QUIET_ZONE)).toEqual(qr.modules);
  });

  it("takes another margin, or none", () => {
    const qr = mustEncode("https://agile.amrelharony.com/join/retro/ABCDEFGHJKMN");
    expect(rasterisePath(qrPath(qr, 0), qr.size)).toEqual(qr.modules);
    expect(stripQuietZone(rasterisePath(qrPath(qr, 2), qr.size + 4), 2)).toEqual(qr.modules);
  });

  it("joins a run of dark modules into one rectangle", () => {
    expect(
      qrPath(
        {
          modules: [
            [true, true, false, true],
            [false, false, false, false],
          ],
        },
        0
      )
    ).toBe("M0 0h2v1h-2zM3 0h1v1h-1z");
  });
});
