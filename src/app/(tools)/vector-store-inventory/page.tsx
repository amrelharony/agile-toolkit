import type { Metadata } from "next";
import { VectorStoreInventoryClient } from "./vector-store-inventory-client";

export const metadata: Metadata = {
  title: "Vector Store Inventory — Agile Toolkit",
  description:
    "Catalog of embedding collections: model, dimension, doc count, refresh cadence, owner, downstream consumers.",
};

export default function Page() {
  return <VectorStoreInventoryClient />;
}
