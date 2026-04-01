/**
 * Render a markdown pipe-delimited table.
 */
export function formatTable(
  headers: string[],
  rows: (string | number)[][]
): string {
  const hdr = `| ${headers.map((h) => h.replace(/\|/g, "\\|")).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const esc = (v: string | number) => String(v).replace(/\|/g, "\\|");
  const body = rows
    .map((r) => `| ${r.map((c) => esc(c)).join(" | ")} |`)
    .join("\n");
  return `${hdr}\n${sep}\n${body}`;
}

/**
 * Limit data size for prompt embedding. Returns a slice and metadata.
 */
export function truncateData<T>(
  items: T[],
  maxItems = 20
): { data: T[]; truncated: boolean; totalCount: number } {
  return {
    data: items.slice(0, maxItems),
    totalCount: items.length,
    truncated: items.length > maxItems,
  };
}

/**
 * Format an ISO date string to a short human-readable form.
 */
export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

/**
 * Build the standard prompt preamble that establishes the AI's role.
 */
export function buildPreamble(toolName: string, dataContext: string): string {
  return `You are an expert Agile coach and Scrum Master with deep experience in team performance analysis. Below is real data from a team's ${toolName}. ${dataContext}

Please analyze this data and provide actionable, specific insights.

`;
}
