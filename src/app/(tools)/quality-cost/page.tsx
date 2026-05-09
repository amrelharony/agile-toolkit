import { QualityCostClient } from "./quality-cost-client";

export const metadata = {
  title: "Cost of Quality Calculator — Agile Toolkit",
  description:
    "Trade-off calculator across prevention, detection, and failure costs — visualizes COQ distribution and conformance ratio.",
};

export default function Page() {
  return <QualityCostClient />;
}
