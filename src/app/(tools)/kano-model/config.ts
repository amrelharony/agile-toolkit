import { Heart } from "lucide-react";
import type { MethodToolConfig } from "@/components/prioritization/method-tool";
import { KANO_ACTIONS } from "@/lib/history/event-actions";
import { buildExample } from "./example";
import { KanoInputs } from "./inputs";

/**
 * The tool for the shared method shell's pieces (its add, save, delete and
 * example actions). A feature needs answers to save: one person's pair, or
 * survey counts; the category is derived from them.
 */
export const KANO_CONFIG: MethodToolConfig = {
  methodId: "kano",
  toolId: "kano-model",
  title: "Kano Model Builder",
  description:
    "Ask customers two questions about each feature (how they'd feel with it, and without it): the Kano evaluation table sorts it into Must-be, Performance, Attractive, Indifferent, Reverse or Questionable, with Better and Worse scores.",
  icon: Heart,
  noun: { one: "feature", many: "features" },
  titleLabel: "Feature title",
  titlePlaceholder: "e.g. Single sign-on with Okta",
  submitLabel: "Add",
  listLabel: "Features by Kano category",
  emptyText:
    "No features yet. Add one above with one person's answers or survey counts, or load an example to see a finished survey.",
  history: {
    ITEM_ADDED: KANO_ACTIONS.ITEM_ADDED,
    ITEM_UPDATED: KANO_ACTIONS.ITEM_UPDATED,
    ITEM_REMOVED: KANO_ACTIONS.ITEM_REMOVED,
  },
  Inputs: KanoInputs,
  buildExample: () => buildExample(),
};
