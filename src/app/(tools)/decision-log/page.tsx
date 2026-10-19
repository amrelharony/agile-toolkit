import { DecisionLogClient } from "./decision-log-client";

export const metadata = {
  title: "Decision Log (ADR)",
  description:
    "Architecture Decision Records with context, decision, consequences, and status timeline.",
};

export default function Page() {
  return <DecisionLogClient />;
}
