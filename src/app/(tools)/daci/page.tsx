import type { Metadata } from "next";
import { DaciClient } from "./daci-client";

export const metadata: Metadata = {
  title: "DACI Decision Doc",
  description:
    "Driver / Approver / Contributors / Informed assignment for each decision (Atlassian/Intuit).",
};

export default function Page() {
  return <DaciClient />;
}
