import type { Metadata } from "next";
import { BuyAFeatureClient } from "./buy-a-feature-client";

export const metadata: Metadata = {
  title: "Buy-a-Feature Game — Agile Toolkit",
  description:
    "Innovation game where stakeholders spend fake currency to 'buy' features — surfaces tradeoff conversations.",
};

export default function Page() {
  return <BuyAFeatureClient />;
}
