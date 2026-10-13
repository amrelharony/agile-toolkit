#!/usr/bin/env node
/**
 * Copy pdf.js's legacy worker into public/ so it's served same-origin.
 *
 *   npm run pdf:worker
 *
 * src/lib/pdf/load-pdfjs.ts loads the legacy build of pdfjs-dist and points
 * `GlobalWorkerOptions.workerSrc` at /pdf.worker.legacy.min.mjs. pdf.js refuses
 * to run when the API and worker versions differ, so re-run this after every
 * pdfjs-dist upgrade and commit the result — test/pdf/worker-version.test.ts
 * fails until you do. Deliberately not wired into a pre-script: the copy is
 * committed, so builds never depend on it running.
 *
 * The worker lives at the top level of public/ because the middleware matcher
 * already skips top-level files with an extension.
 */

import { copyFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const src = fileURLToPath(new URL("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", root));
const dest = fileURLToPath(new URL("public/pdf.worker.legacy.min.mjs", root));
const { version } = JSON.parse(
  readFileSync(new URL("node_modules/pdfjs-dist/package.json", root), "utf8")
);

copyFileSync(src, dest);
console.log(
  `pdf:worker — copied pdfjs-dist ${version} legacy worker to public/pdf.worker.legacy.min.mjs`
);
