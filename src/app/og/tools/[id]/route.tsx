import { ImageResponse } from "next/og";
import { getToolById } from "@/lib/constants/tools";
import { getSectionForTool } from "@/lib/constants/sections";
import { TOOL_ART } from "@/lib/ink/drawings/tools";
import { COMIC_PAGE, COMIC_PALETTE } from "@/lib/ink/palette";
import { drawingDataUri } from "@/lib/ink/svg-string";
import { TOOL_SHARE_SIZE } from "@/lib/seo/tool-share";

/**
 * Each tool's link-preview card (1200 × 630): its ink drawing on the comic's
 * paper, with its name lettered in Shantell Sans. An unknown id is a 404.
 *
 * Edge, not Node: the Node build of next/og joins its own file URLs with
 * path.join, which breaks them on Windows, so prerendering these failed every
 * local build there. On the edge a card is drawn on its first request and then
 * served from the CDN: ImageResponse marks it immutable for a year.
 */
export const runtime = "edge";

const font = fetch(
  new URL("../../../../lib/og/fonts/ShantellSans-SemiBold.ttf", import.meta.url)
).then((res) => res.arrayBuffer());

/**
 * The title's size: one line for a short name, at most two for the longest
 * (33 characters), so the card never overflows. A long title leaves less room
 * for the description.
 */
function titleSize(name: string): number {
  if (name.length <= 14) return 80;
  if (name.length <= 22) return 66;
  return 54;
}

function descriptionLength(name: string): number {
  return name.length > 22 ? 96 : 128;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const tool = getToolById(params.id);
  const art = tool && TOOL_ART[tool.id];
  if (!tool || !art) return new Response("Not found", { status: 404 });
  const section = getSectionForTool(tool.id);
  const ink = COMIC_PALETTE.ink;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: COMIC_PAGE.bg,
        padding: 44,
        fontFamily: "Shantell Sans",
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: 40,
          padding: "48px 56px",
          background: COMIC_PALETTE.paper,
          border: `6px solid ${COMIC_PAGE.border}`,
          borderRadius: "26px 20px 30px 18px",
          boxShadow: `12px 12px 0 ${COMIC_PAGE.border}`,
        }}
      >
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 18 }}>
          {section && (
            <div style={{ fontSize: 30, color: COMIC_PALETTE.accent }}>{section.label}</div>
          )}
          <div style={{ fontSize: titleSize(tool.name), lineHeight: 1.05, color: ink }}>
            {tool.name}
          </div>
          <div style={{ fontSize: 27, lineHeight: 1.35, color: COMIC_PALETTE.sub }}>
            {clip(tool.description, descriptionLength(tool.name))}
          </div>
          <div style={{ fontSize: 26, color: COMIC_PALETTE.sub, marginTop: 10 }}>
            Agile Toolkit · free, no sign-up
          </div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- rendered by the image renderer, not a page */}
        <img src={drawingDataUri(art, COMIC_PALETTE, 400)} width={400} height={400} alt="" />
      </div>
    </div>,
    {
      ...TOOL_SHARE_SIZE,
      fonts: [{ name: "Shantell Sans", data: await font, weight: 600, style: "normal" }],
    }
  );
}
