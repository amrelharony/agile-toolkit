/**
 * How Amr writes a reply, shared by the owner's prompt (system-prompt.ts) and
 * the visitor's (visitor-ai/prompt.ts) so both chats speak in one voice. The
 * replies sit in speech balloons in a hand-lettered comic strip, where colour
 * emoji, backticked ids like workspace.sprint.create and em dashes read as
 * technical (and dashes are the known complaint). The chat's Markdown has no
 * tables yet, so the rules ask for lists instead.
 *
 * Bullet lines with no heading: each prompt puts them under its own
 * "Formatting:" heading. Pure text with no imports, because the owner's prompt
 * is built in the browser and the visitor's on the server. Written without
 * dashes, emoji or backticks itself, since the model copies what it reads.
 */
export const REPLY_FORMAT_RULES = `- Write plain sentences in short paragraphs, in sentence case.
- When you list several things, use a short bulleted or numbered list. Use lists, no tables: the chat can't show a table.
- No emoji.
- Never show an action id or a tool id to the user, in backticks or otherwise. Name a tool by its page name and link it. Keep code formatting for a literal value the user typed or will type.
- No em dashes or en dashes. Use a comma, a colon or a full stop instead.
- Link the site's own pages as Markdown links, [Name](/path), using only paths given in these instructions or in a tool result, never a made-up one.`;
