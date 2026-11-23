/**
 * A small QR decoder for the tests: it reads a symbol the way a scanner
 * does once it has found the modules, and shares no code with the encoder
 * in src/lib/qr.
 *
 *   sample the modules -> read and check the format (and version) bits ->
 *   work out which modules carry data -> walk them in the zigzag, undoing
 *   the mask -> undo the interleaving -> check every block's Reed-Solomon
 *   syndromes -> read the mode, the length and the bytes.
 *
 * It corrects nothing: a symbol with a single wrong module fails here,
 * which is what a test wants. Every table below is written out from
 * ISO/IEC 18004 again, in a different shape from the encoder's, so a slip
 * in either shows up as a disagreement.
 */

/** Level M, versions 1 to 10: error-correction codewords per block, then [blocks, data codewords each]. */
const BLOCKS_M: Record<number, { ec: number; groups: [number, number][] }> = {
  1: { ec: 10, groups: [[1, 16]] },
  2: { ec: 16, groups: [[1, 28]] },
  3: { ec: 26, groups: [[1, 44]] },
  4: { ec: 18, groups: [[2, 32]] },
  5: { ec: 24, groups: [[2, 43]] },
  6: { ec: 16, groups: [[4, 27]] },
  7: { ec: 18, groups: [[4, 31]] },
  8: {
    ec: 22,
    groups: [
      [2, 38],
      [2, 39],
    ],
  },
  9: {
    ec: 22,
    groups: [
      [3, 36],
      [2, 37],
    ],
  },
  10: {
    ec: 26,
    groups: [
      [4, 43],
      [1, 44],
    ],
  },
};

/** Annex E: the centres of the alignment patterns. */
export const ALIGNMENT_CENTRES: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

/** The alignment patterns a version really has: every pair of centres that misses the finders. */
export function alignmentPatterns(version: number): [number, number][] {
  const centres = ALIGNMENT_CENTRES[version];
  const size = 17 + 4 * version;
  const out: [number, number][] = [];
  for (const row of centres) {
    for (const column of centres) {
      const nearTop = row < 9;
      const nearLeft = column < 9;
      const nearBottom = row > size - 10;
      const nearRight = column > size - 10;
      if ((nearTop && nearLeft) || (nearTop && nearRight) || (nearBottom && nearLeft)) continue;
      out.push([row, column]);
    }
  }
  return out;
}

/** Table 10, with i the row and j the column. */
const MASKS: ((i: number, j: number) => boolean)[] = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (_i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.trunc(i / 2) + Math.trunc(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

export function maskFlips(mask: number, row: number, column: number): boolean {
  return MASKS[mask](row, column);
}

/** Figure 25: where format bit 0 to 14 sits, in each of the two copies. */
export function formatBitPositions(size: number): [[number, number][], [number, number][]] {
  const n = size;
  return [
    [
      [0, 8],
      [1, 8],
      [2, 8],
      [3, 8],
      [4, 8],
      [5, 8],
      [7, 8],
      [8, 8],
      [8, 7],
      [8, 5],
      [8, 4],
      [8, 3],
      [8, 2],
      [8, 1],
      [8, 0],
    ],
    [
      [8, n - 1],
      [8, n - 2],
      [8, n - 3],
      [8, n - 4],
      [8, n - 5],
      [8, n - 6],
      [8, n - 7],
      [8, n - 8],
      [n - 7, 8],
      [n - 6, 8],
      [n - 5, 8],
      [n - 4, 8],
      [n - 3, 8],
      [n - 2, 8],
      [n - 1, 8],
    ],
  ];
}

/** The remainder of `value` (a polynomial over GF(2), `bits` long) divided by `generator`. */
function bchRemainder(value: number, bits: number, generator: number): number {
  const degree = generator.toString(2).length - 1;
  let rem = value;
  for (let shift = bits - 1; shift >= degree; shift--) {
    if ((rem >>> shift) & 1) rem ^= generator << (shift - degree);
  }
  return rem;
}

/**
 * True for a module that never carries data: finders with their separators
 * and the format strips beside them, the timing lines, the alignment
 * patterns and (version 7 and up) the two version blocks. Worked out from
 * the layout, not from anything the encoder drew.
 */
export function isFunctionModule(version: number, row: number, column: number): boolean {
  const n = 17 + 4 * version;
  // Finder, separator and format strip: a 9 × 9 corner top left, 9 × 8 top
  // right and 8 × 9 bottom left (the last also holds the always-dark module).
  if (row < 9 && column < 9) return true;
  if (row < 9 && column >= n - 8) return true;
  if (row >= n - 8 && column < 9) return true;
  if (row === 6 || column === 6) return true;
  for (const [r, c] of alignmentPatterns(version)) {
    if (Math.abs(row - r) <= 2 && Math.abs(column - c) <= 2) return true;
  }
  if (version >= 7) {
    if (row < 6 && column >= n - 11 && column < n - 8) return true;
    if (column < 6 && row >= n - 11 && row < n - 8) return true;
  }
  return false;
}

// GF(256) by tables of powers and logarithms of 2, modulo x^8 + x^4 + x^3 + x^2 + 1.
const EXP = new Array<number>(510);
const LOG = new Array<number>(256).fill(0);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 510; i++) EXP[i] = EXP[i - 255];
}

function gfTimes(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

/**
 * The syndromes of one block (data then error correction): the block read
 * as a polynomial, at 2^0, 2^1 and so on, one per error-correction
 * codeword. All zero for a block with no errors.
 */
export function syndromes(block: readonly number[], ecLength: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < ecLength; j++) {
    let value = 0;
    for (const codeword of block) value = gfTimes(value, EXP[j]) ^ codeword;
    out.push(value);
  }
  return out;
}

export interface DecodedQr {
  version: number;
  /** The two level bits from the format information: 0b00 is M. */
  levelBits: number;
  mask: number;
  /** The 15 format bits as drawn (after the standard's XOR), from each copy. */
  formatCopies: [number, number];
  /** Versions 7 and up: the 18 version bits from each copy. */
  versionCopies: [number, number] | null;
  /** Every codeword in the order it was laid into the symbol. */
  codewords: number[];
  /** Modules left over after the last codeword, with the mask undone. */
  remainderBits: number[];
  /** The blocks after undoing the interleaving. */
  blocks: { data: number[]; ec: number[] }[];
  /** The data codewords in block order. */
  dataCodewords: number[];
  /** The pad codewords after the text, if any. */
  padding: number[];
  bytes: number[];
  text: string;
}

function fail(message: string): never {
  throw new Error(`QR decode: ${message}`);
}

/** Decode a symbol given as `modules[row][column]`, true for dark, with no quiet zone. */
export function decodeQr(modules: readonly (readonly boolean[])[]): DecodedQr {
  const n = modules.length;
  if (modules.some((row) => row.length !== n)) fail("the symbol is not square");
  const version = (n - 17) / 4;
  if (!Number.isInteger(version) || !(version in BLOCKS_M)) fail(`no version is ${n} modules wide`);

  // Format bits: two copies that must agree and pass their BCH check.
  const read = (positions: [number, number][]) =>
    positions.reduce((acc, [row, column], bit) => acc | (Number(modules[row][column]) << bit), 0);
  const [firstCopy, secondCopy] = formatBitPositions(n);
  const formatCopies: [number, number] = [read(firstCopy), read(secondCopy)];
  if (formatCopies[0] !== formatCopies[1]) fail("the two format copies differ");
  const format = formatCopies[0] ^ 0b101010000010010;
  if (bchRemainder(format, 15, 0b10100110111) !== 0) fail("the format bits fail their check");
  const levelBits = format >>> 13;
  const mask = (format >>> 10) & 0b111;
  if (!modules[n - 8][8]) fail("the always-dark module is light");

  // Version bits, versions 7 and up: bit i sits 3 across and 6 down (and mirrored).
  let versionCopies: [number, number] | null = null;
  if (version >= 7) {
    let topRight = 0;
    let bottomLeft = 0;
    for (let i = 0; i < 18; i++) {
      const along = Math.trunc(i / 3);
      const across = n - 11 + (i % 3);
      topRight |= Number(modules[along][across]) << i;
      bottomLeft |= Number(modules[across][along]) << i;
    }
    versionCopies = [topRight, bottomLeft];
    if (topRight !== bottomLeft) fail("the two version copies differ");
    if (topRight >>> 12 !== version) fail("the version bits name another version");
    if (bchRemainder(topRight, 18, 0b1111100100101) !== 0)
      fail("the version bits fail their check");
  }

  // The zigzag: two columns at a time from the right edge, bouncing off the
  // top and bottom, never using the vertical timing column.
  const bits: number[] = [];
  let row = n - 1;
  let step = -1;
  for (let column = n - 1; column > 0; column -= 2) {
    if (column === 6) column -= 1;
    for (;;) {
      for (const c of [column, column - 1]) {
        if (isFunctionModule(version, row, c)) continue;
        bits.push(Number(modules[row][c] !== maskFlips(mask, row, c)));
      }
      row += step;
      if (row < 0 || row >= n) {
        row -= step;
        step = -step;
        break;
      }
    }
  }

  const { ec, groups } = BLOCKS_M[version];
  const dataLengths = groups.flatMap(([count, length]) => new Array<number>(count).fill(length));
  const total = dataLengths.reduce((sum, length) => sum + length + ec, 0);
  if (Math.trunc(bits.length / 8) !== total) {
    fail(`${bits.length} data modules, but version ${version} holds ${total} codewords`);
  }
  const codewords: number[] = [];
  for (let i = 0; i < total; i++) {
    codewords.push(parseInt(bits.slice(i * 8, i * 8 + 8).join(""), 2));
  }
  const remainderBits = bits.slice(total * 8);

  // Undo the interleaving: data codewords column by column, then the same for error correction.
  const blocks = dataLengths.map(() => ({ data: [] as number[], ec: [] as number[] }));
  let at = 0;
  for (let i = 0; i < Math.max(...dataLengths); i++) {
    blocks.forEach((block, b) => {
      if (i < dataLengths[b]) block.data.push(codewords[at++]);
    });
  }
  for (let i = 0; i < ec; i++) {
    for (const block of blocks) block.ec.push(codewords[at++]);
  }
  blocks.forEach((block, b) => {
    if (syndromes([...block.data, ...block.ec], ec).some((s) => s !== 0)) {
      fail(`block ${b + 1} has Reed-Solomon errors`);
    }
  });

  // The message: mode, length, bytes, terminator, padding.
  const dataCodewords = blocks.flatMap((block) => block.data);
  const stream = dataCodewords.map((c) => c.toString(2).padStart(8, "0")).join("");
  let cursor = 0;
  const take = (length: number) => {
    const value = parseInt(stream.slice(cursor, cursor + length), 2);
    cursor += length;
    return value;
  };
  if (take(4) !== 0b0100) fail("not byte mode");
  const length = take(version <= 9 ? 8 : 16);
  const bytes: number[] = [];
  for (let i = 0; i < length; i++) bytes.push(take(8));
  const terminator = stream.slice(cursor, cursor + 4);
  if (/1/.test(terminator)) fail("no terminator after the text");
  cursor = Math.min(stream.length, cursor + 4);
  const toByte = (8 - (cursor % 8)) % 8;
  if (/1/.test(stream.slice(cursor, cursor + toByte))) fail("stray bits before the padding");
  cursor += toByte;
  const padding: number[] = [];
  while (cursor < stream.length) padding.push(take(8));

  return {
    version,
    levelBits,
    mask,
    formatCopies,
    versionCopies,
    codewords,
    remainderBits,
    blocks,
    dataCodewords,
    padding,
    bytes,
    text: new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes)),
  };
}

/**
 * Turn SVG path data made of `M x y h w v 1 h -w z` rectangles (what
 * `qrPath` writes) back into a grid of `side` × `side` units, true where a
 * rectangle covers the unit. Throws on anything else in the path.
 */
export function rasterisePath(d: string, side: number): boolean[][] {
  const out = Array.from({ length: side }, () => new Array<boolean>(side).fill(false));
  const rect = /^M(\d+) (\d+)h(\d+)v1h-(\d+)z/;
  let at = 0;
  while (at < d.length) {
    const m = rect.exec(d.slice(at));
    if (!m) throw new Error(`unexpected path data at ${at}: ${d.slice(at, at + 24)}`);
    const [x, y, width, back] = m.slice(1).map(Number);
    if (width !== back || width < 1) throw new Error(`open rectangle at ${at}`);
    for (let i = 0; i < width; i++) {
      if (out[y][x + i]) throw new Error(`module drawn twice at row ${y}, column ${x + i}`);
      out[y][x + i] = true;
    }
    at += m[0].length;
  }
  return out;
}

/** The symbol inside a rasterised drawing: the grid without its `margin`, which must be all light. */
export function stripQuietZone(grid: readonly (readonly boolean[])[], margin: number): boolean[][] {
  const side = grid.length;
  grid.forEach((row, r) =>
    row.forEach((dark, c) => {
      const inZone = r < margin || c < margin || r >= side - margin || c >= side - margin;
      if (inZone && dark) throw new Error(`dark module in the quiet zone at ${r}, ${c}`);
    })
  );
  return grid.slice(margin, side - margin).map((row) => row.slice(margin, side - margin));
}
