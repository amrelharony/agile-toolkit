import { describe, expect, it } from "vitest";
import { JOBS } from "@/lib/constants/jobs";
import { getToolById } from "@/lib/constants/tools";

describe("home job launcher", () => {
  it("only points at tools that exist", () => {
    for (const job of JOBS) {
      expect(getToolById(job.primaryToolId), `${job.id} primary`).toBeDefined();
      for (const alt of job.alternatives) {
        expect(getToolById(alt.toolId), `${job.id} → ${alt.toolId}`).toBeDefined();
        expect(alt.toolId).not.toBe(job.primaryToolId);
      }
    }
  });

  it("has unique job ids", () => {
    expect(new Set(JOBS.map((j) => j.id)).size).toBe(JOBS.length);
  });
});
