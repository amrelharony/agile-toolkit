import type { Metadata } from "next";
import { HealthCheckClient } from "./health-check-client";

export const metadata: Metadata = { title: "Squad Health Check" };

export default function HealthCheckPage() {
  return <HealthCheckClient />;
}
