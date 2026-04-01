import type { Metadata } from "next";
import { HealthDashboardClient } from "./health-dashboard-client";

export const metadata: Metadata = { title: "Agile Health Dashboard" };

export default function HealthDashboardPage() {
  return <HealthDashboardClient />;
}
