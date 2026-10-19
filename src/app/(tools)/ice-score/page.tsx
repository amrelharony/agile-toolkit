import type { Metadata } from "next";
import { IceScoreClient } from "./ice-score-client";

export const metadata: Metadata = {
  title: "ICE Score Card",
  description:
    "Lightweight Impact × Confidence × Ease score for fast prioritisation of growth experiments.",
};

export default function Page() {
  return <IceScoreClient />;
}
