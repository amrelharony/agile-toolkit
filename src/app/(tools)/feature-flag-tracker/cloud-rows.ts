"use client";

/**
 * The cloud read the flags' one-time move plans on. It moved to
 * lib/sync/cloud-blobs so the Definition of Done's move shares it; this
 * re-export keeps use-legacy-flags (and the tests that mock this module)
 * working unchanged.
 */
export { readCloudBlobs } from "@/lib/sync/cloud-blobs";
