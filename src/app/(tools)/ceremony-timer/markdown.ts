/** A rotation speaker. Names are unique; the id marks example rows. */
export interface Participant {
  id: string;
  name: string;
}

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A table cell: one line, pipes escaped. */
function cell(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/** 900 → "15:00", 3600 → "1:00:00". */
function clock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * The ceremony's agenda as Markdown, for a meeting invite or the team
 * channel: the time-box, then, with rotation on, the speaking order with each
 * slot's start and length. Slots match the timer: an equal share each, and
 * the last speaker also gets the seconds that don't divide evenly.
 */
export function toMarkdown(
  {
    ceremony,
    totalSeconds,
    rotationMode,
    participants,
  }: {
    /** The preset matching the duration ("Standup"), if any. */
    ceremony?: string;
    totalSeconds: number;
    rotationMode: boolean;
    participants: readonly Participant[];
  },
  now: Date = new Date()
): string {
  const title = `# Ceremony Timer — ${mdDate(now)}`;
  if (totalSeconds <= 0 && participants.length === 0) {
    return `${title}\n\nNo ceremony set up yet.\n`;
  }

  const lines = [
    title,
    "",
    totalSeconds > 0
      ? `**${cell(ceremony) || "Custom"}:** ${clock(totalSeconds)} time-box`
      : "**Time-box:** not set yet",
    "",
  ];
  const n = participants.length;
  if (!rotationMode || n === 0) {
    lines.push("One shared time-box, no speaker rotation.");
    return `${lines.join("\n")}\n`;
  }

  const per = Math.floor(totalSeconds / n);
  lines.push(
    totalSeconds > 0 ? `## Speaking order (${clock(per)} each)` : "## Speaking order",
    "",
    "| # | Speaker | Starts at | Time |",
    "|---:|---|---:|---:|",
    ...participants.map((p, i) => {
      const start = i * per;
      const length = i === n - 1 ? totalSeconds - start : per;
      return totalSeconds > 0
        ? `| ${i + 1} | ${cell(p.name)} | ${clock(start)} | ${clock(length)} |`
        : `| ${i + 1} | ${cell(p.name)} | — | — |`;
    })
  );
  return `${lines.join("\n")}\n`;
}
