/**
 * The anonymous vote-round kit's UI. Tools mount `VoteRoundPanel`; the
 * `/join` page mounts `VoteJoinRoom` (lazily, after consent). The rest is
 * exported for tests and for tools that show a saved round. Each kind of
 * round has its own form, results and count entry: scale (`Vote*`,
 * `FacilitatorTally`), pair (`Pair*`, `FacilitatorPair`) and allocation
 * (`Allocation*`, `FacilitatorAllocation`).
 */

export {
  VoteRoundPanel,
  unavailableReason,
  liveOnlyReason,
  type VoteRoundPanelProps,
  type ScaleVoteRoundPanelProps,
  type PairVoteRoundPanelProps,
  type AllocationVoteRoundPanelProps,
  type ChoiceVoteRoundPanelProps,
  type RankVoteRoundPanelProps,
  type NumberVoteRoundPanelProps,
} from "./vote-round-panel";
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
export { PairAnswerForm, type PairAnswerFormProps } from "./pair-answer-form";
export {
  PairResults,
  pairSummary,
  pairResultsVerdict,
  type PairResultsProps,
} from "./pair-results";
export { FacilitatorPair, type FacilitatorPairProps } from "./facilitator-pair";
export {
  AllocationAnswerForm,
  leftToGiveText,
  type AllocationAnswerFormProps,
} from "./allocation-answer-form";
export {
  AllocationResults,
  allocationVerdict,
  allocationChartSummary,
  allocationItemSummary,
  type AllocationResultsProps,
} from "./allocation-results";
export { FacilitatorAllocation, type FacilitatorAllocationProps } from "./facilitator-allocation";
export {
  ChoiceAnswerForm,
  choiceInstruction,
  dotsLeftText,
  type ChoiceAnswerFormProps,
} from "./choice-answer-form";
export { ChoiceResults, choiceSummary, type ChoiceResultsProps } from "./choice-results";
export { RankAnswerForm, ordinal, type RankAnswerFormProps } from "./rank-answer-form";
export { RankResults, rankSummary, type RankResultsProps } from "./rank-results";
export {
  NumberAnswerForm,
  numberRangeText,
  readNumberBox,
  type NumberAnswerFormProps,
} from "./number-answer-form";
export { NumberResults, numberSummary, type NumberResultsProps } from "./number-results";
export { SavedRoundResults, kindSpreadNote, resultKeepable, roundMarkdown } from "./round-views";
export {
  useSaveRound,
  type SaveRound,
  type SaveVoteRound,
  type SavePairRound,
  type SaveAllocationRound,
  type SaveChoiceRound,
  type SaveRankRound,
  type SaveNumberRound,
  type SaveRoundState,
} from "./save-round";
