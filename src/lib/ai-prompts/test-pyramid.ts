import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { TestPyramid } from "../stores/workspace-types";
import {
  PYRAMID_SHAPE_LABEL,
  RUN_COST_WEIGHTS,
  SHAPE_TOLERANCE,
  TEST_LAYERS,
  TEST_LAYER_LABEL,
  classifyShape,
  layerShares,
  runCost,
  shapeVerdict,
  sharePercents,
  snapshotsOf,
  weightingOf,
} from "../quality/pyramid";
import {
  count,
  minutes,
  runCostText,
  shapeChartText,
  shapePoints,
} from "@/app/(tools)/test-pyramid/view";

/** The document the Test Pyramid page shows: the team's, or the example while it is loaded. */
interface PyramidData {
  doc: TestPyramid | null;
}

/** The snapshot table lists the latest this many. */
const MAX_SNAPSHOTS = 12;

/**
 * The pyramid prompts with the page's reading (lib/quality/pyramid): the
 * shape from all three layers' shares (pyramid, ice-cream cone, hourglass,
 * diamond or even, within a 5-point tolerance), by test count or by run
 * time as the page weighs it, the run cost (the 1 / 5 / 25 index, or the
 * minutes), and the shape over the dated snapshots.
 */
export function generateTestPyramidPrompts(data: PyramidData): PromptDefinition[] {
  const { doc } = data;
  if (!doc) return [];
  const total = doc.unit + doc.integration + doc.e2e;
  if (!(total > 0)) return [];
  const weighting = weightingOf(doc);
  const shares = layerShares(doc, weighting, doc.runtime);
  const shape = classifyShape(shares);
  const verdict = shapeVerdict(shape, shares, weighting);
  const countShares = layerShares(doc);
  const countPct = countShares ? sharePercents(countShares) : null;
  const cost = runCost(doc, weighting, doc.runtime);
  const costText = runCostText(cost);
  const timed = TEST_LAYERS.some((l) => typeof doc.runtime?.[l] === "number");

  const table = formatTable(
    ["Layer", "Tests", "Share of tests", ...(timed ? ["Minutes"] : []), "Run cost"],
    TEST_LAYERS.map((l) => [
      TEST_LAYER_LABEL[l],
      count(doc[l]),
      countPct ? `${countPct[l]}%` : "—",
      ...(timed
        ? [typeof doc.runtime?.[l] === "number" ? minutes(doc.runtime[l] as number) : "—"]
        : []),
      cost
        ? cost.basis === "runtime"
          ? minutes(cost.byLayer[l])
          : `${count(cost.byLayer[l])} (× ${RUN_COST_WEIGHTS[l]})`
        : "—",
    ])
  );
  const basis =
    weighting === "runtime"
      ? "The shape is weighed by run time: each layer's share of the minutes a full run takes."
      : "The shape is weighed by test count.";
  const hint = costText.hint.charAt(0).toLowerCase() + costText.hint.slice(1);
  const costLine = `Run cost: ${costText.value} (${hint}).`;

  const points = shapePoints(snapshotsOf(doc), weighting).slice(-MAX_SNAPSHOTS);
  const history = shapeChartText(points);
  const snapshots =
    points.length === 0
      ? "No snapshots taken yet."
      : `${formatTable(
          history.table.columns,
          history.table.rows.map((r) => r.map(String))
        )}\n\n${history.summary}`;
  const notes = doc.description?.trim()
    ? `\n\n## Notes\n\n${wrapUserContent(sanitizePromptCell(doc.description, 1000))}`
    : "";
  const context = `Shape: ${verdict} ${basis} Shapes compare all three layers' shares; layers within ${Math.round(
    SHAPE_TOLERANCE * 100
  )} points count as level. Total ${count(total)} tests. ${costLine}`;
  const body = `## Layers\n\n${table}\n\n## Shape over time\n\n${snapshots}${notes}`;

  return [
    {
      id: "pyramid-diagnosis",
      title: "Pyramid Health Diagnosis",
      description: "Evaluate the current unit/integration/e2e ratio and call out anti-patterns.",
      prompt:
        buildPreamble("Test Pyramid Analyzer", context) +
        `${body}\n\n## Questions\n\n1. The page reads the suite as ${PYRAMID_SHAPE_LABEL[shape].toLowerCase()}: diagnose what that means for this team, with specifics.\n2. What does the run cost suggest about feedback-loop speed, and which layer dominates it?\n3. Has the shape moved across the snapshots, and in which direction?\n4. Identify the single biggest concern and the single biggest strength.`,
    },
    {
      id: "pyramid-rebalance",
      title: "Rebalancing Strategy",
      description: "Recommend a sequenced plan to move toward a healthier pyramid shape.",
      prompt:
        buildPreamble("Test Pyramid Analyzer", context) +
        `${body}\n\n## Questions\n\n1. Suggest a 2-quarter plan to shift the ratio toward a healthier shape — concrete moves, not generic advice.\n2. Are there e2e tests that should likely be down-shifted to integration or unit? How would you identify them?\n3. What contract/integration testing patterns would close the most coverage at the lowest ongoing cost?`,
    },
  ];
}
