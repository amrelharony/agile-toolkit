/**
 * The mascot model served to every visitor.
 *
 * It is the optimised build (`npm run optimize:mascot`: 1024 px JPEG
 * textures, ~2.7 MB instead of the 16.3 MB Blender export) committed under
 * public/mascot with the first 8 hex chars of its SHA-256 in the name, so
 * next.config.mjs can serve /mascot/* with a year-long immutable cache.
 *
 * To replace the model: run the optimiser, rename the output to
 * `mascot.<new sha256 prefix>.glb`, update this constant and delete the old
 * file (test/agent/mascot-asset.test.ts checks the name matches the bytes).
 */
export const MASCOT_GLB_URL = "/mascot/mascot.297dffcf.glb";
