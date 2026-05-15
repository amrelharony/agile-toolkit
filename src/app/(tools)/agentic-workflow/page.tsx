import type { Metadata } from "next";
import { AgenticWorkflowClient } from "./agentic-workflow-client";

export const metadata: Metadata = {
  title: "Agentic Workflow Designer — Agile Toolkit",
  description:
    "Visual node list of agent steps, tools, fallbacks, and human-in-the-loop checkpoints.",
};

export default function Page() {
  return <AgenticWorkflowClient />;
}
