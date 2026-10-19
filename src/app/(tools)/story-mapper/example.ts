import { exampleId } from "@/components/tool-frame/example-data";
import type { StoryMapSlice, StoryMapStep } from "@/lib/stores/workspace-types";

/**
 * The example map: an online shop's buying journey. A first visit opens on
 * it, Reset brings it back, and so does "Load an example" on an empty map.
 * The walking skeleton is one thin story per step, end to end (buy a single
 * item with no cart yet); the MVP slice adds what shoppers miss first.
 *
 * Every id is fixed, so server and client render the same DOM (R5), and
 * starts with `example-`, so "Clear example" removes exactly these rows.
 */
export function buildExampleSteps(): StoryMapStep[] {
  return [
    { id: exampleId("step-discover"), name: "Discover" },
    { id: exampleId("step-learn"), name: "Learn" },
    { id: exampleId("step-use"), name: "Use" },
  ];
}

export function buildExampleSlices(steps: StoryMapStep[]): StoryMapSlice[] {
  const [discover, learn, use] = steps;
  return [
    {
      id: exampleId("slice-skeleton"),
      name: "Walking Skeleton",
      cards: {
        [discover.id]: [
          {
            id: exampleId("card-browse"),
            title: "Browse product catalog",
            description: "Users can view available products in a list.",
            color: "#00f0ff",
          },
        ],
        [learn.id]: [
          {
            id: exampleId("card-details"),
            title: "Read product details",
            description: "Users can click a product to see full details.",
            color: "#a78bfa",
          },
        ],
        [use.id]: [
          {
            id: exampleId("card-buy-now"),
            title: "Buy a single item",
            description: "Pay by card for one product, straight from its page. No cart yet.",
            color: "#34d399",
          },
        ],
      },
    },
    {
      id: exampleId("slice-mvp"),
      name: "MVP",
      cards: {
        [discover.id]: [
          {
            id: exampleId("card-search"),
            title: "Search by keyword",
            description: "Find a product by name or category.",
            color: "#00f0ff",
          },
        ],
        [learn.id]: [
          {
            id: exampleId("card-reviews"),
            title: "See ratings and reviews",
            description: "Star rating and the latest reviews on every product page.",
            color: "#a78bfa",
          },
        ],
        [use.id]: [
          {
            id: exampleId("card-cart"),
            title: "Add to cart",
            description: "Users can add items to a shopping cart.",
            color: "#34d399",
          },
          {
            id: exampleId("card-saved-card"),
            title: "Pay with a saved card",
            description: "Returning shoppers check out without retyping card details.",
            color: "#fb923c",
          },
        ],
      },
    },
  ];
}
