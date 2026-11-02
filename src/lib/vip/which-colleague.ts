/**
 * The rules of Which Colleague Are You?, with no question text, so client code
 * can import them. The wording stays in which-colleague-questions.ts, and scores
 * stay in the page's memory: nothing here stores or sends anything.
 */

export interface ColleagueAnswer {
  id: string;
  text: string;
  /** Names from the cast this answer points towards. */
  colleagues: string[];
}

export interface ColleagueQuestion {
  id: string;
  prompt: string;
  answers: ColleagueAnswer[];
}

export interface WhichColleagueGame {
  intro: string;
  /** Leads into the colleague's name on the result. */
  resultLead: string;
  /** Under the result: it's about a habit, not the person. */
  dignityNote: string;
  /** The question a result leaves the team with. */
  discussion: string;
  questions: ColleagueQuestion[];
}

/** Question id → the id of the answer picked. */
export type ColleaguePicks = Readonly<Record<string, string>>;

/** FNV-1a: a small, stable number for a tie, so the same answers give the same result. */
function hashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The colleague these answers sit closest to: the one picked most. Most games end
 * in a tie, and no question should count for more than another, so a tie goes to
 * one of the leaders by a hash of the answers: the first question gets no say over
 * the others, and the same answers always land on the same colleague. Null until
 * there's an answer to go on.
 */
export function closestColleague(
  questions: readonly ColleagueQuestion[],
  picks: ColleaguePicks
): string | null {
  const counts = new Map<string, number>();
  let top = 0;
  let path = "";
  for (const question of questions) {
    const answer = question.answers.find((a) => a.id === picks[question.id]);
    if (!answer) continue;
    path += `${question.id}=${answer.id};`;
    for (const name of answer.colleagues) {
      const count = (counts.get(name) ?? 0) + 1;
      counts.set(name, count);
      if (count > top) top = count;
    }
  }
  const leaders: string[] = [];
  counts.forEach((count, name) => {
    if (count === top) leaders.push(name);
  });
  if (leaders.length === 0) return null;
  return leaders.length === 1 ? leaders[0] : leaders[hashOf(path) % leaders.length];
}
