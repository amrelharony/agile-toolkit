/**
 * "How this works" content for a tool: what the method is for, when to use
 * it, how to run it and what to watch out for. Plain language, short.
 */
export interface ToolGuide {
  toolId: string;
  /** One or two sentences: what this is and what you get out of it. */
  summary: string;
  /** Situations where this is the right tool. */
  whenToUse: string[];
  /** How to run it, in order. */
  steps: string[];
  /** Common pitfalls and practical tips. */
  tips?: string[];
  /** Scales the method uses, with what each value means. */
  scales?: { name: string; values: { value: string; meaning: string }[] }[];
  /** Typical timebox, e.g. "45–90 minutes for a two-week sprint". */
  timebox?: string;
}
