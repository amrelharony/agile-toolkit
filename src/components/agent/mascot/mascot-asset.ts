/**
 * Amr's sprite sheet, served to every visitor.
 *
 * It is `final/spritesheet-extended.png` from the Amr pet pack, converted to
 * WebP at q88 (~490 KB instead of 1.9 MB) and committed under public/mascot with
 * the first 8 hex chars of its SHA-256 in the name, so next.config.mjs can serve
 * /mascot/* with a year-long immutable cache.
 *
 * To replace the sheet: convert it, rename the output to
 * `amr.<new sha256 prefix>.webp`, update this constant and delete the old file
 * (test/agent/mascot-asset.test.ts checks the name matches the bytes). Never add
 * the pack's photo boards, decoded rows or QA files to public/.
 */
export const MASCOT_SPRITE_URL = "/mascot/amr.7d281181.webp";
