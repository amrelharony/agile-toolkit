import { TestPyramidClient } from "./test-pyramid-client";

export const metadata = {
  title: "Test Pyramid Analyzer",
  description:
    "Visualize the unit/integration/e2e split, name its shape (pyramid, ice-cream cone, hourglass, diamond), weigh it by test count or run time, and track it across dated snapshots.",
};

export default function Page() {
  return <TestPyramidClient />;
}
