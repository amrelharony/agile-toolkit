import { TestPyramidClient } from "./test-pyramid-client";

export const metadata = {
  title: "Test Pyramid Analyzer",
  description:
    "Visualize unit/integration/e2e split, flag inverted pyramids, and surface a cost-of-quality estimate.",
};

export default function Page() {
  return <TestPyramidClient />;
}
