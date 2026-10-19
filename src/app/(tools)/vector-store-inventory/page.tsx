import type { Metadata } from "next";
import { VectorStoreInventoryClient } from "./vector-store-inventory-client";

export const metadata: Metadata = {
  title: "Vector Store Inventory",
  description:
    "Catalog of embedding collections: model, dimension, doc count, refresh cadence and owner.",
};

export default function Page() {
  return <VectorStoreInventoryClient />;
}
