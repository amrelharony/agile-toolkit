/**
 * GET /api/comics/stories/N/extras: the story's quiz and own tool.
 * PUT /api/comics/stories/N/extras: { quiz, tryTool }, each null to clear it.
 *
 * Apart from the story's own route, so a story still saves before migration
 * 0033 adds these columns: until then this route answers 503
 * extras_unavailable, and the portal says why.
 *
 * It leaves the story's updated_at alone: the story editor compares that with
 * the draft it keeps, and a quiz saved here isn't a change to the story's fields.
 *
 * Errors: 400 invalid_ep | invalid_input (with `field`), 404, 401/403 not the
 * owner, 503 extras_unavailable.
 */

import { checkExtras, pickableTool, readQuiz } from "@/lib/comics/extras";
import { parseEp } from "@/lib/comics/entry";
import { revalidateComics } from "@/lib/comics/revalidate";
import { answer, ownerRoute, readJson, refuse } from "../../../_owner";

export const dynamic = "force-dynamic";

type Params = { ep: string };
type ExtrasRow = { quiz: unknown; try_tool: string | null };

/** What the portal edits: a tool shelved since it was picked reads as none. */
const toExtras = (row: ExtrasRow) => ({
  quiz: readQuiz(row.quiz),
  tryTool: row.try_tool && pickableTool(row.try_tool) ? row.try_tool : null,
});

/** Postgres's check_violation: the database refused the value, not the call. */
const CHECK_VIOLATION = "23514";

export const GET = ownerRoute<Params>(async ({ admin, params }) => {
  const ep = parseEp(params.ep);
  if (ep === null) return refuse(400, "invalid_ep");
  const { data, error } = await admin
    .from("comic_stories")
    .select("quiz,try_tool")
    .eq("ep", ep)
    .maybeSingle<ExtrasRow>();
  if (error) return refuse(503, "extras_unavailable");
  if (!data) return refuse(404, "not_found");
  return answer({ extras: toExtras(data) });
});

export const PUT = ownerRoute<Params>(async ({ req, admin, params }) => {
  const ep = parseEp(params.ep);
  if (ep === null) return refuse(400, "invalid_ep");
  const read = await readJson(req);
  if (read instanceof Response) return read;
  const checked = checkExtras(read.body);
  if (!checked.ok) return refuse(400, "invalid_input", { field: checked.field });

  const { quiz, tryTool } = checked.extras;
  const { data, error } = await admin
    .from("comic_stories")
    .update({ quiz, try_tool: tryTool })
    .eq("ep", ep)
    .select("quiz,try_tool")
    .maybeSingle<ExtrasRow>();
  if (error?.code === CHECK_VIOLATION) return refuse(400, "invalid_input", { field: "quiz" });
  if (error) return refuse(503, "extras_unavailable");
  if (!data) return refuse(404, "not_found");

  revalidateComics([ep]);
  return answer({ extras: toExtras(data) });
});
