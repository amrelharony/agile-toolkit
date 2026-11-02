#!/usr/bin/env node
/**
 * Regenerates src/lib/vip/cast.generated.ts from the canon, which isn't in the
 * repo. Extract it from the bible zip with Python, then pass the file here:
 *
 *   python -I -c "import zipfile,sys; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read('Agile_At_Work_Expanded_Canon.json'))" Agile_At_Work_Bible_and_Characters.zip > canon.json
 *   node scripts/generate-cast.mjs canon.json
 *   npx prettier --write src/lib/vip/cast.generated.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickCast, renderCastModule } from "./cast-whitelist.mjs";

const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/generate-cast.mjs <canon.json>");
  process.exit(1);
}

const cards = pickCast(JSON.parse(readFileSync(source, "utf8")));
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "src", "lib", "vip", "cast.generated.ts");
writeFileSync(out, renderCastModule(cards));
console.log(`wrote ${cards.length} cards to ${path.relative(root, out)}`);
