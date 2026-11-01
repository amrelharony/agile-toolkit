import { exampleId } from "@/components/tool-frame/example-data";
import { addDays } from "@/lib/impediments/model";
import { TEST_PYRAMID_ID } from "@/lib/quality/pyramid";
import type { TestPyramid } from "@/lib/stores/workspace-types";

/**
 * A suite that started as an ice-cream cone (mostly browser tests), went
 * through an hourglass while unit tests were written, and is a pyramid
 * now: four dated snapshots over nine months, plus today's counts and run
 * times, so the shape chart, the comparison and "by run time" all open.
 * Held in memory by the page: nothing in it is saved.
 */
export function buildExample(today: string): TestPyramid {
  return {
    id: TEST_PYRAMID_ID,
    unit: 1240,
    integration: 310,
    e2e: 95,
    description: "checkout-service, Jest + Playwright",
    runtime: { unit: 4, integration: 11, e2e: 26 },
    updatedOn: today,
    snapshots: [
      {
        id: exampleId("tps-1"),
        takenOn: addDays(today, -270),
        unit: 60,
        integration: 120,
        e2e: 240,
        note: "Before the testing guild",
      },
      {
        id: exampleId("tps-2"),
        takenOn: addDays(today, -180),
        unit: 300,
        integration: 160,
        e2e: 230,
      },
      {
        id: exampleId("tps-3"),
        takenOn: addDays(today, -90),
        unit: 700,
        integration: 250,
        e2e: 150,
        note: "Moved form checks down to unit tests",
      },
      {
        id: exampleId("tps-4"),
        takenOn: addDays(today, -30),
        unit: 1100,
        integration: 300,
        e2e: 110,
        runtime: { unit: 4, integration: 10, e2e: 31 },
      },
    ],
  };
}
