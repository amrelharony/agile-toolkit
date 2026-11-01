/**
 * The 26 episodes of the printed book, as the building posters show them.
 * Copied from the comic's canon (preserved_episode_index in
 * Agile_At_Work_Expanded_Canon.json): the wording belongs to the book, so
 * don't edit it here.
 */
export interface BookEpisode {
  ep: number;
  title: string;
  lesson: string;
  /** Printed on the poster after "Ask your team:". */
  question: string;
  bookPage: number;
}

export const BOOK_EPISODES: readonly BookEpisode[] = [
  {
    ep: 1,
    title: "Everything Is Priority One",
    lesson: "Choose what comes first and say what can wait.",
    question: "What can wait so the first job can finish?",
    bookPage: 9,
  },
  {
    ep: 2,
    title: "Just One Tiny Change",
    lesson: "Before adding another change, agree what it costs and what can wait.",
    question: "Which changes improve the outcome, and which delay useful delivery?",
    bookPage: 15,
  },
  {
    ep: 3,
    title: "We Needed It Yesterday",
    lesson: "Test the work under real working conditions, even when time is short.",
    question: "Which real conditions could invalidate our test?",
    bookPage: 21,
  },
  {
    ep: 4,
    title: "Another Alignment Call",
    lesson: "When the decision is already made, share it instead of scheduling another meeting.",
    question: "Which meeting could become a clear message?",
    bookPage: 29,
  },
  {
    ep: 5,
    title: "Waiting for Approval",
    lesson: "Find who can approve, then agree a follow-up time and next step.",
    question: "Who can approve our blocked work, and when will we follow up?",
    bookPage: 35,
  },
  {
    ep: 6,
    title: "One Moment!",
    lesson: "Leave some capacity free so unexpected work does not have to wait.",
    question: "Where are we planning every minute, and what capacity could we leave free?",
    bookPage: 41,
  },
  {
    ep: 7,
    title: "Nobody Owns It",
    lesson: "Own the outcome; you do not have to do every part yourself.",
    question: "Which job lacks a clear owner, and who will see it through?",
    bookPage: 47,
  },
  {
    ep: 8,
    title: "All Clear!",
    lesson: "Do not call your part finished if it leaves someone else stuck.",
    question: "When we call our part done, whose work could it leave stuck?",
    bookPage: 53,
  },
  {
    ep: 9,
    title: "47 Features. Still Thirsty.",
    lesson: "Check whether your work helped the person who needed it.",
    question:
      "What are we counting, and how would we know it actually helped the person who needed it?",
    bookPage: 57,
  },
  {
    ep: 10,
    title: "Our Biggest Queue Yet!",
    lesson: "Choose a measure that tells you when and how to act.",
    question: "Which measure would trigger a useful action?",
    bookPage: 63,
  },
  {
    ep: 11,
    title: "One Size Fits... Who?",
    lesson: "Let people with different needs try an idea before you commit to it.",
    question: "Which idea are we about to choose, and who should try it first?",
    bookPage: 67,
  },
  {
    ep: 12,
    title: "But You Were Closed!",
    lesson: "Before speaking for everyone, check whose voices you have not heard.",
    question: "Who is missing from our feedback, and how will we reach them?",
    bookPage: 73,
  },
  {
    ep: 13,
    title: "The Pass That Wouldn’t Let Him Pass",
    lesson: "Make “the person can use it” part of your definition of done.",
    question:
      "For our current work, what must the person be able to do before we call it complete?",
    bookPage: 79,
  },
  {
    ep: 14,
    title: "Just for Today",
    lesson: "A temporary fix can help today; delaying the repair can create more work every day.",
    question: "Which small repair are we repeatedly postponing?",
    bookPage: 83,
  },
  {
    ep: 15,
    title: "Not Quite Ready",
    lesson: "Let a real user try the draft while their feedback can still change it.",
    question: "Whose feedback could improve the draft today?",
    bookPage: 91,
  },
  {
    ep: 16,
    title: "Can We Skip the Test?",
    lesson: "Cut the extras before you cut a critical check.",
    question: "Which check is essential, and what optional extra can wait?",
    bookPage: 97,
  },
  {
    ep: 17,
    title: "The Remote Rescue",
    lesson: "Restore the service first. Then change what keeps causing the same problem.",
    question: "Which problem keeps coming back, and what keeps causing it?",
    bookPage: 103,
  },
  {
    ep: 18,
    title: "Who Caused This?",
    lesson: "Own your part in the mistake, then change the process that let it reach the customer.",
    question: "What is our part, and what process change would help next time?",
    bookPage: 107,
  },
  {
    ep: 19,
    title: "We’ll Fix It Next Meeting",
    lesson: "Choose one improvement, make a specific commitment, and follow through.",
    question:
      "Which improvement have we agreed more than once without doing it, and what stopped us?",
    bookPage: 113,
  },
  {
    ep: 20,
    title: "Where Did the Data Go?",
    lesson: "When a request goes missing, trace its route and fix the handoff.",
    question: "Where could a request get lost between channels?",
    bookPage: 119,
  },
  {
    ep: 21,
    title: "Still Relevant?",
    lesson: "Before dismissing an old request, check whether the need still exists.",
    question:
      "Which old request are we about to drop, and how will we check whether the need still exists?",
    bookPage: 125,
  },
  {
    ep: 22,
    title: "But We Agreed!",
    lesson: "Before rejecting a change, ask why it is needed.",
    question: "Which change are we resisting, and have we asked why it is needed?",
    bookPage: 131,
  },
  {
    ep: 23,
    title: "Just Add More People",
    lesson: "Give new helpers clear responsibilities and the authority to act.",
    question: "Which decisions can helpers make themselves?",
    bookPage: 137,
  },
  {
    ep: 24,
    title: "We Paid for the Whole Day",
    lesson: "Choose the next step for its value, whatever you have already spent.",
    question:
      "What are we continuing only because we have already invested in it, and what would we choose if we started today?",
    bookPage: 143,
  },
  {
    ep: 25,
    title: "Ninety Per Cent Done",
    lesson: "When nothing is ready to use, finish one thing before starting more.",
    question: "What have we started but not finished, and which one could we finish first?",
    bookPage: 149,
  },
  {
    ep: 26,
    title: "Any Questions?",
    lesson: "Welcome problems without making the messenger own the whole fix.",
    question: "What makes a problem hard to raise, and how could we make it easier?",
    bookPage: 155,
  },
];

/** A book episode by number, or null outside 1-26. */
export function bookEpisode(ep: number): BookEpisode | null {
  return BOOK_EPISODES[ep - 1] ?? null;
}
