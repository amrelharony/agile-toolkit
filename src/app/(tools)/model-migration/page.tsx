import type { Metadata } from "next";
import { ModelMigrationClient } from "./model-migration-client";

export const metadata: Metadata = {
  title: "Model Upgrade Migration Tracker",
  description:
    "Checklist + parity-test log for model upgrades: eval delta, cost delta, behaviour diff.",
};

export default function Page() {
  return <ModelMigrationClient />;
}
