import type { Metadata } from "next";
import { PolarityMapClient } from "./polarity-map-client";

export const metadata: Metadata = {
  title: "Polarity Map",
  description:
    "Barry Johnson's tool for managing chronic tensions (centralisation vs autonomy, etc.) instead of solving them.",
};

export default function Page() {
  return <PolarityMapClient />;
}
