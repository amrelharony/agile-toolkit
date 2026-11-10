/**
 * A QR code encoder, written here so a join link needs no dependency.
 *
 * What it covers of ISO/IEC 18004: byte mode, error-correction level M
 * (about 15% of the code can be damaged or hidden), versions 1 to 10 (21 to
 * 57 modules a side, up to 213 bytes) and the mask with the lowest penalty
 * score. A join link is about 50 to 100 bytes (version 4 to 6), so it fits
 * with room to spare; a longer text gets null and the caller says so.
 *
 * The steps, in the order the standard gives them:
 *   1. the text as bytes, behind a mode and a length (`qrDataCodewords`);
 *   2. the bytes cut into blocks, each with Reed-Solomon codewords
 *      (`qrBlocks`), then interleaved (`qrInterleave`);
 *   3. the fixed patterns (`qrFunctionPatterns`): finders, timing,
 *      alignment, and room for the format and version bits;
 *   4. the codewords laid in a zigzag from the bottom right;
 *   5. each of the eight masks tried and scored (`qrPenalty`), the lowest
 *      kept, and its number written into the format bits (`qrFormatBits`).
 *
 * Coordinates: `modules[row][column]`, row 0 at the top, true for a dark
 * module. No quiet zone here: whoever draws it adds the four light modules
 * a scanner needs round the code (`QR_QUIET_ZONE`).
 *
 * No imports and no browser globals beyond `TextEncoder`, which browsers
 * and Node both have.
 */

export interface QrCode {
  /** 1 to 10. */
  version: number;
  /** Modules per side: 17 + 4 × version. */
  size: number;
  /** The mask applied, 0 to 7. */
  mask: number;
  /** `modules[row][column]`: true is a dark module. No quiet zone. */
  modules: boolean[][];
}

/** One version's layout at error-correction level M. */
export interface QrVersionSpec {
  /** Data and error-correction codewords together. */
  totalCodewords: number;
  /** Error-correction codewords in each block. */
  ecPerBlock: number;
  /** How many blocks the codewords are split into. */
  blocks: number;
  /** Row and column centres of the alignment patterns. */
  align: readonly number[];
}

/**
 * Versions 1 to 10 at level M, from the standard's tables 7, 9 and E.1
 * (index 0 is version 1). `test/qr/encode.test.ts` checks the totals
 * against the modules the fixed patterns leave free.
 */
export const QR_VERSIONS: readonly QrVersionSpec[] = [
  { totalCodewords: 26, ecPerBlock: 10, blocks: 1, align: [] },
  { totalCodewords: 44, ecPerBlock: 16, blocks: 1, align: [6, 18] },
  { totalCodewords: 70, ecPerBlock: 26, blocks: 1, align: [6, 22] },
  { totalCodewords: 100, ecPerBlock: 18, blocks: 2, align: [6, 26] },
  { totalCodewords: 134, ecPerBlock: 24, blocks: 2, align: [6, 30] },
  { totalCodewords: 172, ecPerBlock: 16, blocks: 4, align: [6, 34] },
  { totalCodewords: 196, ecPerBlock: 18, blocks: 4, align: [6, 22, 38] },
  { totalCodewords: 242, ecPerBlock: 22, blocks: 4, align: [6, 24, 42] },
  { totalCodewords: 292, ecPerBlock: 22, blocks: 5, align: [6, 26, 46] },
  { totalCodewords: 346, ecPerBlock: 26, blocks: 5, align: [6, 28, 50] },
];

export const QR_MAX_VERSION = QR_VERSIONS.length;

/** Light modules a scanner needs on every side of the code. */
export const QR_QUIET_ZONE = 4;

/** The two error-correction level bits in the format information: M is 00. */
const LEVEL_M_BITS = 0b00;

/** Byte mode's indicator. */
const MODE_BYTE = 0b0100;

function spec(version: number): QrVersionSpec {
  const found = QR_VERSIONS[version - 1];
  if (!Number.isInteger(version) || !found) throw new RangeError(`QR version ${version}`);
  return found;
}

/** Modules per side. */
export function qrSize(version: number): number {
  spec(version);
  return 17 + 4 * version;
}

/** Data codewords a version holds (the rest are error correction). */
export function qrDataCapacity(version: number): number {
  const v = spec(version);
  return v.totalCodewords - v.ecPerBlock * v.blocks;
}

/** Bits of the length field in byte mode. */
function countBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

/** The longest text, in bytes, that fits a version. */
export function qrByteCapacity(version: number): number {
  return Math.floor((qrDataCapacity(version) * 8 - 4 - countBits(version)) / 8);
}

/** The longest text this encoder takes, in UTF-8 bytes. */
export const QR_MAX_BYTES = qrByteCapacity(QR_MAX_VERSION);

/** The smallest version that holds `byteLength` bytes, or null when none does. */
export function qrVersionFor(byteLength: number): number | null {
  for (let version = 1; version <= QR_MAX_VERSION; version++) {
    if (byteLength <= qrByteCapacity(version)) return version;
  }
  return null;
}

// ── Reed-Solomon over GF(256) ────────────────────────────────────────

/** Multiply in GF(2^8) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1. */
function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/**
 * The generator polynomial for `degree` error-correction codewords:
 * (x - 2^0)(x - 2^1)…(x - 2^(degree-1)). Coefficients from the highest
 * power down, without the leading 1.
 */
export function qrGenerator(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** The error-correction codewords for one block: the remainder of data ÷ generator. */
export function qrErrorCorrection(data: readonly number[], degree: number): number[] {
  const generator = qrGenerator(degree);
  const result = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    for (let i = 0; i < degree; i++) result[i] ^= gfMultiply(generator[i], factor);
  }
  return result;
}

// ── Codewords ────────────────────────────────────────────────────────

/**
 * The data codewords for `bytes` in byte mode: the mode, the length, the
 * bytes, a terminator, then the standard's two pad bytes in turn until the
 * version is full.
 */
export function qrDataCodewords(bytes: Uint8Array, version: number): number[] {
  const capacity = qrDataCapacity(version);
  if (bytes.length > qrByteCapacity(version)) {
    throw new RangeError(`${bytes.length} bytes do not fit QR version ${version}`);
  }
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(MODE_BYTE, 4);
  push(bytes.length, countBits(version));
  for (let i = 0; i < bytes.length; i++) push(bytes[i], 8);
  // The terminator: up to four zero bits, fewer when the data ends sooner.
  push(0, Math.min(4, capacity * 8 - bits.length));
  // Zero bits to the next whole byte.
  push(0, (8 - (bits.length % 8)) % 8);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  for (let pad = 0xec; codewords.length < capacity; pad ^= 0xec ^ 0x11) codewords.push(pad);
  return codewords;
}

export interface QrBlock {
  data: number[];
  ec: number[];
}

/**
 * Cut the data codewords into the version's blocks and give each its
 * error-correction codewords. When they don't divide evenly, the later
 * blocks hold one more data codeword.
 */
export function qrBlocks(data: readonly number[], version: number): QrBlock[] {
  const { blocks, ecPerBlock } = spec(version);
  const capacity = qrDataCapacity(version);
  if (data.length !== capacity) {
    throw new RangeError(`QR version ${version} takes ${capacity} data codewords`);
  }
  const shortLength = Math.floor(capacity / blocks);
  const longBlocks = capacity % blocks;
  const out: QrBlock[] = [];
  let at = 0;
  for (let b = 0; b < blocks; b++) {
    const length = shortLength + (b >= blocks - longBlocks ? 1 : 0);
    const slice = data.slice(at, at + length);
    at += length;
    out.push({ data: slice, ec: qrErrorCorrection(slice, ecPerBlock) });
  }
  return out;
}

/**
 * The order the codewords go into the symbol: the first data codeword of
 * every block, then the second of every block and so on, then the
 * error-correction codewords the same way.
 */
export function qrInterleave(blocks: readonly QrBlock[]): number[] {
  const out: number[] = [];
  const longest = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < longest; i++) {
    for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  }
  const ecLength = blocks[0]?.ec.length ?? 0;
  for (let i = 0; i < ecLength; i++) {
    for (const block of blocks) out.push(block.ec[i]);
  }
  return out;
}

// ── Format and version information ───────────────────────────────────

/**
 * The 15 format bits for level M and `mask`: 5 data bits, 10 BCH(15,5)
 * check bits, XORed with the standard's fixed pattern so they are never
 * all zero.
 */
export function qrFormatBits(mask: number): number {
  const data = (LEVEL_M_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** The 18 version bits (versions 7 and up): 6 data bits and 12 BCH(18,6) check bits. */
export function qrVersionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

// ── The symbol ───────────────────────────────────────────────────────

function grid(size: number): boolean[][] {
  return Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
}

export interface QrFunctionPatterns {
  /** The fixed patterns drawn; every other module is light. */
  modules: boolean[][];
  /** True where a module belongs to a fixed pattern or to the format or version bits. */
  reserved: boolean[][];
}

/** Where the 15 format bits go, twice: bit `i` at `[row, column]`. */
function formatPositions(size: number): [number, number][][] {
  const first: [number, number][] = [];
  const second: [number, number][] = [];
  // First copy, round the top-left finder.
  for (let i = 0; i <= 5; i++) first.push([i, 8]);
  first.push([7, 8], [8, 8], [8, 7]);
  for (let i = 9; i < 15; i++) first.push([8, 14 - i]);
  // Second copy, split between the top-right and bottom-left finders.
  for (let i = 0; i < 8; i++) second.push([8, size - 1 - i]);
  for (let i = 8; i < 15; i++) second.push([size - 15 + i, 8]);
  return [first, second];
}

/** Where the 18 version bits go, twice: bit `i` at `[row, column]`. */
function versionPositions(size: number): [number, number][][] {
  const bottomLeft: [number, number][] = [];
  const topRight: [number, number][] = [];
  for (let i = 0; i < 18; i++) {
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    bottomLeft.push([a, b]);
    topRight.push([b, a]);
  }
  return [bottomLeft, topRight];
}

/**
 * The parts of a symbol that don't depend on its data: three finder
 * patterns with their separators, the two timing lines, the alignment
 * patterns, the one module that is always dark, the version bits (7 and
 * up) and the room kept for the format bits.
 */
export function qrFunctionPatterns(version: number): QrFunctionPatterns {
  const size = qrSize(version);
  const modules = grid(size);
  const reserved = grid(size);
  const set = (row: number, column: number, dark: boolean) => {
    modules[row][column] = dark;
    reserved[row][column] = true;
  };

  // Timing: alternate along row 6 and column 6, starting dark.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // Finders: a 7 × 7 ring round a 3 × 3 block, inside a light separator.
  for (const [row, column] of [
    [3, 3],
    [3, size - 4],
    [size - 4, 3],
  ]) {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        const r = row + dr;
        const c = column + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const ring = Math.max(Math.abs(dr), Math.abs(dc));
        set(r, c, ring !== 2 && ring !== 4);
      }
    }
  }

  // Alignment: 5 × 5, at every pair of centres except the three finder corners.
  const { align } = spec(version);
  const last = align.length - 1;
  for (let i = 0; i <= last; i++) {
    for (let j = 0; j <= last; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          set(align[i] + dr, align[j] + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // Format bits: kept free here, written once the mask is chosen.
  for (const copy of formatPositions(size)) {
    for (const [row, column] of copy) set(row, column, false);
  }
  // The module beside the bottom-left finder that is always dark.
  set(size - 8, 8, true);

  if (version >= 7) {
    const bits = qrVersionBits(version);
    for (const copy of versionPositions(size)) {
      copy.forEach(([row, column], i) => set(row, column, ((bits >>> i) & 1) === 1));
    }
  }

  return { modules, reserved };
}

/** Whether mask `mask` flips the module at `row`, `column`. */
export function qrMaskBit(mask: number, row: number, column: number): boolean {
  switch (mask) {
    case 0:
      return (row + column) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return column % 3 === 0;
    case 3:
      return (row + column) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
    case 5:
      return ((row * column) % 2) + ((row * column) % 3) === 0;
    case 6:
      return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0;
    case 7:
      return (((row + column) % 2) + ((row * column) % 3)) % 2 === 0;
    default:
      throw new RangeError(`QR mask ${mask}`);
  }
}

const FINDER_LIKE = [
  [true, false, true, true, true, false, true, false, false, false, false],
  [false, false, false, false, true, false, true, true, true, false, true],
];

/** Rules 1 and 3 along one row or column. */
function linePenalty(line: readonly boolean[]): number {
  let penalty = 0;
  // Rule 1: five or more in a row of one colour.
  let run = 1;
  for (let i = 1; i <= line.length; i++) {
    if (i < line.length && line[i] === line[i - 1]) {
      run++;
      continue;
    }
    if (run >= 5) penalty += 3 + (run - 5);
    run = 1;
  }
  // Rule 3: dark-light-dark-dark-dark-light-dark with four light modules on
  // either side, which a scanner could take for a finder.
  for (let i = 0; i + 11 <= line.length; i++) {
    for (const pattern of FINDER_LIKE) {
      let same = true;
      for (let j = 0; j < 11 && same; j++) same = line[i + j] === pattern[j];
      if (same) penalty += 40;
    }
  }
  return penalty;
}

/**
 * How hard a masked symbol is to scan, by the standard's four rules: long
 * runs, 2 × 2 blocks, finder look-alikes, and an uneven share of dark
 * modules. Lower is better.
 */
export function qrPenalty(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  let penalty = 0;
  let dark = 0;
  for (let i = 0; i < size; i++) {
    penalty += linePenalty(modules[i]);
    penalty += linePenalty(modules.map((row) => row[i]));
    for (let j = 0; j < size; j++) if (modules[i][j]) dark++;
  }
  // Rule 2: every 2 × 2 block of one colour.
  for (let r = 0; r + 1 < size; r++) {
    for (let c = 0; c + 1 < size; c++) {
      const colour = modules[r][c];
      if (
        colour === modules[r][c + 1] &&
        colour === modules[r + 1][c] &&
        colour === modules[r + 1][c + 1]
      ) {
        penalty += 3;
      }
    }
  }
  // Rule 4: 10 for every 5% the dark share is away from half.
  const total = size * size;
  penalty += Math.max(0, Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return penalty;
}

/** A symbol with `codewords` laid in, `mask` applied and its format bits written. */
function buildSymbol(version: number, codewords: readonly number[], mask: number): boolean[][] {
  const size = qrSize(version);
  const { modules, reserved } = qrFunctionPatterns(version);

  // The zigzag: pairs of columns from the right edge, up then down, right
  // module first, stepping over the timing column. Modules left over after
  // the last codeword (the remainder bits) are zero bits, masked like the rest.
  let bit = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const column of [right, right - 1]) {
        if (reserved[row][column]) continue;
        const value =
          bit < codewords.length * 8 && ((codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1;
        bit++;
        modules[row][column] = value !== qrMaskBit(mask, row, column);
      }
    }
    upward = !upward;
  }

  const format = qrFormatBits(mask);
  for (const copy of formatPositions(size)) {
    copy.forEach(([row, column], i) => {
      modules[row][column] = ((format >>> i) & 1) === 1;
    });
  }
  return modules;
}

export interface EncodeQrOptions {
  /** Use this mask instead of the one with the lowest penalty (tests). */
  mask?: number;
}

/**
 * The QR code for `text`: the smallest version that holds its UTF-8 bytes,
 * at level M, with the mask that scores best. Null when the text is empty
 * or longer than `QR_MAX_BYTES` bytes.
 */
export function encodeQr(text: string, options: EncodeQrOptions = {}): QrCode | null {
  if (typeof text !== "string" || text.length === 0) return null;
  const bytes = new TextEncoder().encode(text);
  const version = qrVersionFor(bytes.length);
  if (version === null) return null;

  const codewords = qrInterleave(qrBlocks(qrDataCodewords(bytes, version), version));
  const size = qrSize(version);

  if (options.mask !== undefined) {
    qrMaskBit(options.mask, 0, 0); // throws for anything but 0 to 7
    return {
      version,
      size,
      mask: options.mask,
      modules: buildSymbol(version, codewords, options.mask),
    };
  }

  let best: QrCode | null = null;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const modules = buildSymbol(version, codewords, mask);
    const penalty = qrPenalty(modules);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      best = { version, size, mask, modules };
    }
  }
  return best;
}

/**
 * The dark modules as SVG path data: one closed rectangle per run of dark
 * modules in a row, one unit per module, moved in by `margin` units for the
 * quiet zone. Draw it on a light square of `qr.size + 2 × margin` units.
 */
export function qrPath(qr: Pick<QrCode, "modules">, margin: number = QR_QUIET_ZONE): string {
  let d = "";
  qr.modules.forEach((row, r) => {
    let start = -1;
    for (let c = 0; c <= row.length; c++) {
      const dark = c < row.length && row[c];
      if (dark && start < 0) start = c;
      if (!dark && start >= 0) {
        const width = c - start;
        d += `M${start + margin} ${r + margin}h${width}v1h-${width}z`;
        start = -1;
      }
    }
  });
  return d;
}
