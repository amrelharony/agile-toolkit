import { QualityCostClient } from "./quality-cost-client";

export const metadata = {
  title: "Cost of Quality Calculator",
  description:
    "Prevention, detection, and failure costs logged quarter by quarter — the failure share of quality spend, its trend, and an hours × rate helper.",
};

export default function Page() {
  return <QualityCostClient />;
}
