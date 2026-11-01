/**
 * The anonymous vote-round kit's UI. Tools mount `VoteRoundPanel`; the
 * `/join` page mounts `VoteJoinRoom` (lazily, after consent). The rest is
 * exported for tests and for tools that show a saved round.
 */

export { VoteRoundPanel, unavailableReason, type VoteRoundPanelProps } from "./vote-round-panel";
export { HostVoteRoom, type HostVoteRoomProps, type HostVoteSession } from "./host-vote-room";
export { VoteJoinRoom, IncompleteLinkPanel, type VoteJoinRoomProps } from "./vote-join-room";
export { VoteAnswerForm, submitError, type VoteAnswerFormProps } from "./vote-answer-form";
export { VoteLiveCount, liveCountText, type VoteLiveCountProps } from "./vote-live-count";
export {
  VoteResults,
  questionSummary,
  resultsVerdict,
  type VoteResultsProps,
} from "./vote-results";
export { FacilitatorTally, type FacilitatorTallyProps } from "./facilitator-tally";
export { useSaveRound, type SaveVoteRound, type SaveRoundState } from "./save-round";
