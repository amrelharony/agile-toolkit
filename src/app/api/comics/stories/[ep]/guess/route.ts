/**
 * GET /api/comics/stories/N/guess: the story's live guess and "Try it this
 * week" line, plus any draft an import left for the owner to check.
 * PUT /api/comics/stories/N/guess: { guess, tryAction, tryTool? }, each null to
 * clear it. Saving is approving: it writes the live columns and clears the
 * draft. tryTool is only sent when approving a draft that suggested one.
 *
 * Apart from the story's own route and the quiz's, so both keep working before
 * migration 0035 adds these columns: until then this answers 503
 * guess_unavailable, and the portal says why.
 *
 * Like the extras route, it leaves the story's updated_at alone.
 *
 * Errors: 400 invalid_ep | invalid_input (with `field`), 404, 401/403 not the
 * owner, 503 guess_unavailable.
 */

import { checkGuess, readGuess, readGuessDraft, readTryAction } from "@/lib/comics/guess";
import { parseEp } from "@/lib/comics/entry";
import { revalidateComics } from "@/lib/comics/revalidate";
import { answer, ownerRoute, readJson, refuse } from "../../../_owner";

export const dynamic = "force-dynamic";

type Params = { ep: string };
type GuessRow = { guess: unknown; try_action: unknown; extras_draft: unknown };

const COLUMNS = "guess,try_action,extras_draft";

const toBody = (row: GuessRow) => ({
  guess: readGuess(row.guess),
  tryAction: readTryAction(row.try_action),
  draft: readGuessDraft(row.extras_draft),
});

/** Postgres's check_violation: the database refused the value, not the call. */
const CHECK_VIOLATION = "23514";

export const GET = ownerRoute<Params>(async ({ admin, params }) => {
  const ep = parseEp(params.ep);
  if (ep === null) return refuse(400, "invalid_ep");
  const { data, error } = await admin
    .from("comic_stories")
    .select(COLUMNS)
    .eq("ep", ep)
    .maybeSingle<GuessRow>();
  if (error) return refuse(503, "guess_unavailable");
  if (!data) return refuse(404, "not_found");
  return answer(toBody(data));
});

export const PUT = ownerRoute<Params>(async ({ req, admin, params }) => {
  const ep = parseEp(params.ep);
  if (ep === null) return refuse(400, "invalid_ep");
  const read = await readJson(req);
  if (read instanceof Response) return read;
  const checked = checkGuess(read.body);
  if (!checked.ok) return refuse(400, "invalid_input", { field: checked.field });

  const update: Record<string, unknown> = {
    guess: checked.guess,
    try_action: checked.tryAction,
    extras_draft: null,
  };
  if (checked.tryTool !== undefined) update.try_tool = checked.tryTool;

  const { data, error } = await admin
    .from("comic_stories")
    .update(update)
    .eq("ep", ep)
    .select(COLUMNS)
    .maybeSingle<GuessRow>();
  if (error?.code === CHECK_VIOLATION) return refuse(400, "invalid_input", { field: "guess" });
  if (error) return refuse(503, "guess_unavailable");
  if (!data) return refuse(404, "not_found");

  revalidateComics([ep]);
  return answer(toBody(data));
});
