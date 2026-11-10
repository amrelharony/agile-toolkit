import { getSectionForTool } from "@/lib/constants/sections";
import { getToolById, type ToolDefinition } from "@/lib/constants/tools";
import {
  VISITOR_LIMITS,
  VISITOR_ROOM_KIND,
  VISITOR_TOOLS,
  visitorRoomsEnabled,
  type VisitorRoomKind,
} from "@/lib/realtime/visitor-rooms";
import { CORE_SCRUM_TOOLS } from "@/lib/seo/core-tools";
import { defaultToolCount, getShelfTools } from "@/lib/tools/catalog";

/** Mirrors `metadataBase` in src/app/layout.tsx. */
const SITE_URL = "https://agile.amrelharony.com";

const link = (label: string, path: string) => `[${label}](${SITE_URL}${path})`;

/** "A", "A or B", "A, B or C". */
function anyOf(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** The names of the tools that run a live room of one of these kinds. */
function roomTools(...kinds: VisitorRoomKind[]): string[] {
  return VISITOR_TOOLS.filter((id) => kinds.includes(VISITOR_ROOM_KIND[id])).map(
    (id) => getToolById(id)?.name ?? id
  );
}

/**
 * The site's limits, each stated exactly. The numbers come from the room rules
 * themselves (lib/realtime/visitor-rooms.ts), and the live-room line is there
 * only when this build has live rooms on, so the file never promises a room
 * the site would refuse.
 */
function limits(): string[] {
  const lines = [
    "No account: every tool here is free and works without signing up or signing in.",
    'Data stays in one browser: what you make in a tool is saved in that browser only, and nothing syncs to another browser or device. To move it, download a backup file from "Saved in this browser" on any tool and restore it in the other browser.',
  ];
  if (visitorRoomsEnabled()) {
    const hours = Math.round(VISITOR_LIMITS.hardTtlMs / 3_600_000);
    lines.push(
      `Live rooms: a team can run ${anyOf(roomTools("poker", "retro"))} live from a shared link, or an anonymous vote in ${anyOf(roomTools("vote"))}. A room holds up to ${VISITOR_LIMITS.maxMembers} people, the host included, and closes after ${hours} hours at most. What people type passes through a realtime provider (Supabase) to everyone with the link, and the site stores none of it.`
    );
  }
  return lines;
}

/** One tool as a list item: its name linked to its page, then what it does. */
function toolLine(tool: ToolDefinition): string {
  const description = /[.!?]$/.test(tool.description) ? tool.description : `${tool.description}.`;
  return `- ${link(tool.name, tool.path)}: ${description}`;
}

/** The core Scrum tools under the section each sits in, in the order a sprint runs. */
function coreTools(): string[] {
  const out: string[] = [];
  let current: string | undefined;
  for (const { id } of CORE_SCRUM_TOOLS) {
    const tool = getToolById(id);
    if (!tool) throw new Error(`llms.txt: unknown core tool "${id}"`);
    const section = getSectionForTool(id)?.label ?? "Tools";
    if (section !== current) {
      out.push("", `### ${section}`, "");
      current = section;
    }
    out.push(toolLine(tool));
  }
  return out;
}

/**
 * /llms.txt: what an assistant needs to describe the site and send someone to
 * the right tool, as plain text in the llms.txt layout (a title, a summary,
 * then sections of links). It says what the site is, states its limits
 * exactly, and links the core Scrum tools. Built from the registry, so it
 * can't name a tool that has gone or a limit the code no longer keeps.
 *
 * The comic and the book are left out on purpose: robots.txt asks AI crawlers
 * to stay out of them.
 */
export function llmsTxt(): string {
  const shelf = getShelfTools().length;
  return [
    "# Agile Toolkit",
    "",
    "> Free tools for Scrum Masters and agile teams, by Amr El Harony: sprint planning, the Daily Scrum, retrospectives, estimation, delivery charts and team health. Each tool opens in the browser and works straight away.",
    "",
    `Site: ${SITE_URL}`,
    "",
    "## Limits",
    "",
    ...limits().map((line) => `- ${line}`),
    "",
    "## Core Scrum tools",
    "",
    'Each page is the working tool. Under "How this works" it also says when to use the method, how to run it step by step, and what to watch for.',
    ...coreTools(),
    "",
    "## Everything else",
    "",
    `- ${link("All tools", "/")}: the ${defaultToolCount()} tools for Scrum Masters and agile teams, by section.`,
    `- ${link("More tools", "/more-tools")}: ${shelf} tools for neighbouring work, such as AI product management, security, reliability and strategy.`,
    `- ${link("Team", "/team")}: the people on a team and the agreements they work by.`,
    `- ${link("Sitemap", "/sitemap.xml")}: every public page.`,
    "",
  ].join("\n");
}
