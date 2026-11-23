import { llmsTxt } from "@/lib/seo/llms";

/**
 * /llms.txt — what the site is, its limits and its core tools, in plain text
 * for an assistant to read (lib/seo/llms.ts). Built once with the site: it
 * reads only the tool registry and build-time settings, never a request. Like
 * robots.txt it is a top-level file, so the middleware doesn't run on it.
 */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(llmsTxt(), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
