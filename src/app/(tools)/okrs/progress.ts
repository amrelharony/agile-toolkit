/**
 * The OKR progress formula lives in lib/okrs/progress, shared with Sprint
 * Goal, the agent actions, the AI prompt and the Canvas import. These names
 * stay for the page's imports; `objectiveHealth` is `objectiveProgress`.
 * The progress-over-time chart reads lib/okrs progressTrend, as
 * tool.okrs.list_state does.
 */

export { krProgress, objectiveProgress as objectiveHealth } from "@/lib/okrs/progress";
