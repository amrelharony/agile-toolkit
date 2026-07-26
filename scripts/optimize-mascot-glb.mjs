#!/usr/bin/env node
/**
 * Shrink the ElharonyClaw mascot GLB by downscaling + transcoding its textures.
 *
 * The Blender export ships a 4096x4096 PNG baseColor map: 13.2 MB of a 16.3 MB
 * file, ~89 MB of GPU memory once uploaded, and 16.7 M pixels for the
 * synchronous `retintSkin` pass (engine/retint-skin.ts) to walk on the main
 * thread. The mascot renders at ~160x280 CSS px, so a 1024x1024 map is already
 * beyond what the screen can resolve.
 *
 *   node scripts/optimize-mascot-glb.mjs                     # in place, 1024/q90
 *   node scripts/optimize-mascot-glb.mjs --size 2048         # keep more detail
 *   node scripts/optimize-mascot-glb.mjs --in a.glb --out b.glb --dry-run
 *
 * Safety rules it enforces (a texture is only transcoded to JPEG when all hold):
 *   - every material referencing it is alphaMode OPAQUE — JPEG has no alpha,
 *     and a BLEND/MASK material would silently lose its cutout;
 *   - it is only used as a baseColor/emissive map — normal, occlusion and
 *     metallicRoughness maps carry data, not colour, and DCT ringing corrupts
 *     them. Those are resized but stay PNG.
 * Everything else in the file (geometry, skin, animations, node graph) is
 * relocated byte-for-byte; only the image bufferViews change size.
 *
 * The resize/encode needs one raster encoder. It uses whichever it finds:
 *   `sharp` (npm i -D sharp) or Python + Pillow (pip install Pillow).
 * Both are driven at Lanczos + JPEG q90 with 4:4:4 chroma — no subsampling,
 * because `retintSkin` thresholds on per-pixel R/G/B differences and 4:2:0
 * would smear the chroma its skin detection keys off.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_GLB = "public/mascot/mascot.glb";

// ── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const input = flag("in", DEFAULT_GLB);
const output = flag("out", input);
const maxSize = Number(flag("size", 1024));
const quality = Number(flag("quality", 90));
const dryRun = argv.includes("--dry-run");

if (!Number.isFinite(maxSize) || maxSize < 16) {
  console.error(`✗ --size must be a number >= 16 (got ${flag("size")})`);
  process.exit(1);
}
if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
  console.error(`✗ --quality must be 1..100 (got ${flag("quality")})`);
  process.exit(1);
}

/** Decimal MB, matching how DevTools and CDN dashboards report transfer size. */
const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;

// ── GLB container ─────────────────────────────────────────────────────────
const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

/** Split a .glb into its JSON chunk (parsed) and its BIN chunk (Buffer). */
function readGlb(buf) {
  if (buf.length < 12 || buf.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error("not a GLB (bad magic)");
  }
  if (buf.readUInt32LE(4) !== 2) throw new Error("only glTF 2.0 is supported");
  let json = null;
  let bin = Buffer.alloc(0);
  for (let off = 12; off + 8 <= buf.length; ) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(body.toString("utf8"));
    else if (type === CHUNK_BIN) bin = body;
    off += 8 + len + (len % 4 === 0 ? 0 : 4 - (len % 4));
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  return { json, bin };
}

/** Re-emit a .glb from a JSON chunk + BIN chunk, padded per spec. */
function writeGlb(json, bin) {
  const pad = (n, to = 4) => (n % to === 0 ? 0 : to - (n % to));
  const jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = Buffer.alloc(pad(jsonBuf.length), 0x20); // spaces
  const binPad = Buffer.alloc(pad(bin.length), 0x00);
  const total =
    12 + 8 + jsonBuf.length + jsonPad.length + (bin.length ? 8 + bin.length + binPad.length : 0);

  const head = Buffer.alloc(12);
  head.writeUInt32LE(GLB_MAGIC, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);

  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonBuf.length + jsonPad.length, 0);
  jsonHead.writeUInt32LE(CHUNK_JSON, 4);

  const parts = [head, jsonHead, jsonBuf, jsonPad];
  if (bin.length) {
    const binHead = Buffer.alloc(8);
    binHead.writeUInt32LE(bin.length + binPad.length, 0);
    binHead.writeUInt32LE(CHUNK_BIN, 4);
    parts.push(binHead, bin, binPad);
  }
  return Buffer.concat(parts, total);
}

/**
 * Repack every bufferView back to back (4-byte aligned, which satisfies every
 * accessor componentType) with `replacements` swapped in by bufferView index.
 * Views keep their order and their internal layout, so accessor byteOffsets
 * and byteStrides stay valid.
 */
function repackBin(json, bin, replacements) {
  const chunks = [];
  let cursor = 0;
  for (const [i, view] of json.bufferViews.entries()) {
    const data =
      replacements.get(i) ??
      bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const padding = cursor % 4 === 0 ? 0 : 4 - (cursor % 4);
    if (padding) {
      chunks.push(Buffer.alloc(padding));
      cursor += padding;
    }
    view.byteOffset = cursor;
    view.byteLength = data.length;
    chunks.push(data);
    cursor += data.length;
  }
  const out = Buffer.concat(chunks, cursor);
  json.buffers[0].byteLength = out.length;
  return out;
}

// ── image inspection ──────────────────────────────────────────────────────
/** Width/height straight out of a PNG IHDR or a JPEG SOFn marker. */
function imageSize(buf) {
  if (buf.readUInt32BE(0) === 0x89504e47) {
    return { format: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let off = 2; off + 9 < buf.length; ) {
      if (buf[off] !== 0xff) break;
      const marker = buf[off + 1];
      const len = buf.readUInt16BE(off + 2);
      // SOF0..SOF15 except the non-frame markers DHT/JPG/DAC.
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return {
          format: "jpeg",
          height: buf.readUInt16BE(off + 5),
          width: buf.readUInt16BE(off + 7),
        };
      }
      off += 2 + len;
    }
    return { format: "jpeg", width: 0, height: 0 };
  }
  return { format: "unknown", width: 0, height: 0 };
}

/** Bytes a texture occupies on the GPU once decoded, incl. the mip chain. */
const gpuBytes = (w, h) => w * h * 4 * (4 / 3);

/**
 * Which glTF material slots each image feeds, and whether every material using
 * it is opaque. Drives the "is JPEG safe here" decision.
 */
function classifyImages(json) {
  const info = (json.images ?? []).map(() => ({ slots: new Set(), allOpaque: true, used: false }));
  const imageOf = (textureIndex) => json.textures?.[textureIndex]?.source;
  const note = (textureIndex, slot, opaque) => {
    const idx = imageOf(textureIndex);
    if (idx === undefined || !info[idx]) return;
    info[idx].used = true;
    info[idx].slots.add(slot);
    if (!opaque) info[idx].allOpaque = false;
  };
  for (const mat of json.materials ?? []) {
    const opaque = (mat.alphaMode ?? "OPAQUE") === "OPAQUE";
    const pbr = mat.pbrMetallicRoughness ?? {};
    if (pbr.baseColorTexture) note(pbr.baseColorTexture.index, "baseColor", opaque);
    if (pbr.metallicRoughnessTexture)
      note(pbr.metallicRoughnessTexture.index, "metallicRoughness", opaque);
    if (mat.normalTexture) note(mat.normalTexture.index, "normal", opaque);
    if (mat.occlusionTexture) note(mat.occlusionTexture.index, "occlusion", opaque);
    if (mat.emissiveTexture) note(mat.emissiveTexture.index, "emissive", opaque);
  }
  return info;
}

const COLOUR_SLOTS = new Set(["baseColor", "emissive"]);

// ── encoders ──────────────────────────────────────────────────────────────
/** `sharp`, if this repo happens to have it installed. */
async function sharpEncoder() {
  let sharp;
  try {
    ({ default: sharp } = await import("sharp"));
  } catch {
    return null;
  }
  return {
    name: "sharp",
    async run(buf, { width, height, format }) {
      const pipeline = sharp(buf, { limitInputPixels: false }).resize(width, height, {
        kernel: "lanczos3",
        fit: "fill",
      });
      return format === "jpeg"
        ? pipeline.jpeg({ quality, chromaSubsampling: "4:4:4", mozjpeg: false }).toBuffer()
        : pipeline.png({ compressionLevel: 9 }).toBuffer();
    },
  };
}

/** Python + Pillow, via temp files (binary stdio is unreliable on Windows). */
async function pillowEncoder() {
  const probe = "import PIL;print(PIL.__version__)";
  for (const exe of ["python", "python3", "py"]) {
    const ok = await run(exe, ["-c", probe]).catch(() => null);
    if (!ok) continue;
    return {
      name: `Pillow ${ok.trim()} (${exe})`,
      async run(buf, { width, height, format }) {
        const dir = await mkdtemp(join(tmpdir(), "glb-tex-"));
        const src = join(dir, "in.bin");
        const dst = join(dir, `out.${format}`);
        try {
          await writeFile(src, buf);
          const script = [
            "import sys",
            "from PIL import Image",
            "Image.MAX_IMAGE_PIXELS = None",
            "src, dst, w, h, fmt, q = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5], int(sys.argv[6])",
            "im = Image.open(src)",
            "im = im.resize((w, h), Image.LANCZOS)",
            "if fmt == 'jpeg':",
            "    im.convert('RGB').save(dst, 'JPEG', quality=q, subsampling=0, optimize=True)",
            "else:",
            "    im.save(dst, 'PNG', optimize=True)",
          ].join("\n");
          await run(exe, [
            "-c",
            script,
            src,
            dst,
            String(width),
            String(height),
            format,
            String(quality),
          ]);
          return await readFile(dst);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
    };
  }
  return null;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(err || `${cmd} exited ${code}`))
    );
  });
}

// ── main ──────────────────────────────────────────────────────────────────
const before = statSync(input).size;
const { json, bin } = readGlb(readFileSync(input));
const images = json.images ?? [];
if (!images.length) {
  console.log("Nothing to do — the GLB has no embedded images.");
  process.exit(0);
}

const encoder = (await sharpEncoder()) ?? (await pillowEncoder());
if (!encoder && !dryRun) {
  console.error(
    "✗ No raster encoder found. Install one and re-run:\n" +
      "    npm i -D sharp        (Node, fastest)\n" +
      "    pip install Pillow    (Python)"
  );
  process.exit(1);
}

const classes = classifyImages(json);
const replacements = new Map();
const rows = [];
let gpuBefore = 0;
let gpuAfter = 0;

for (const [i, image] of images.entries()) {
  if (image.bufferView === undefined) {
    rows.push({ name: image.name ?? `image_${i}`, note: "external URI — skipped" });
    continue;
  }
  const view = json.bufferViews[image.bufferView];
  const data = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  const { format, width, height } = imageSize(data);
  const cls = classes[i] ?? { slots: new Set(), allOpaque: true, used: false };

  const scale = Math.min(1, maxSize / Math.max(width || 1, height || 1));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));
  const colourOnly = cls.used && [...cls.slots].every((s) => COLOUR_SLOTS.has(s));
  const toJpeg = colourOnly && cls.allOpaque;
  const outFormat = toJpeg ? "jpeg" : "png";
  const unchanged = scale === 1 && format === outFormat;

  gpuBefore += gpuBytes(width, height);
  gpuAfter += gpuBytes(targetW, targetH);

  const reason = !cls.used
    ? "unreferenced"
    : !colourOnly
      ? `data map (${[...cls.slots].join("+")}) — kept PNG`
      : !cls.allOpaque
        ? "non-opaque material — kept PNG"
        : "";

  if (unchanged || dryRun) {
    rows.push({
      name: image.name ?? `image_${i}`,
      from: `${width}x${height} ${format} ${mb(data.length)}`,
      to: unchanged ? "unchanged" : `${targetW}x${targetH} ${outFormat}`,
      note: reason,
    });
    continue;
  }

  const encoded = await encoder.run(Buffer.from(data), {
    width: targetW,
    height: targetH,
    format: outFormat,
  });
  replacements.set(image.bufferView, encoded);
  image.mimeType = outFormat === "jpeg" ? "image/jpeg" : "image/png";
  rows.push({
    name: image.name ?? `image_${i}`,
    from: `${width}x${height} ${format} ${mb(data.length)}`,
    to: `${targetW}x${targetH} ${outFormat} ${mb(encoded.length)}`,
    note: reason,
  });
}

console.log(`${input}  ${mb(before)}`);
if (encoder) console.log(`encoder: ${encoder.name}   target: ${maxSize}px, JPEG q${quality} 4:4:4`);
for (const r of rows) {
  console.log(
    `  ${r.name}: ${r.from ?? ""}${r.to ? ` → ${r.to}` : ""}${r.note ? `  (${r.note})` : ""}`
  );
}
console.log(`  GPU texture memory: ${mb(gpuBefore)} → ${mb(gpuAfter)}`);

if (dryRun) {
  console.log("\n--dry-run — nothing written.");
  process.exit(0);
}
if (!replacements.size) {
  console.log("\nAlready optimized — nothing written.");
  process.exit(0);
}

const glb = writeGlb(json, repackBin(json, bin, replacements));
writeFileSync(output, glb);
console.log(
  `\n✓ ${output}  ${mb(before)} → ${mb(glb.length)}  (${(100 - (glb.length / before) * 100).toFixed(1)}% smaller)`
);
