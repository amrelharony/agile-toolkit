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

/**
 * The colleague these answers sit closest to: the one picked most, and on a tie
 * the one picked first. Null until there's an answer to go on.
 */
export function closestColleague(
  questions: readonly ColleagueQuestion[],
  picks: ColleaguePicks
): string | null {
  const counts = new Map<string, number>();
  for (const question of questions) {
    const answer = question.answers.find((a) => a.id === picks[question.id]);
    for (const name of answer?.colleagues ?? []) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best: string | null = null;
  // A Map keeps first-seen order, so only a higher count can replace the leader.
  counts.forEach((count, name) => {
    if (best === null || count > (counts.get(best) ?? 0)) best = name;
  });
  return best;
}
