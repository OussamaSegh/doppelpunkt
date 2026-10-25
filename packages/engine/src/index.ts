export {
  normalize, tokenize, wordKey, sentenceKey, gswFold, levenshtein, expandUmlauts, foldEszett, unifyQuotes,
  type NormalizeOptions, type Token,
} from './normalize';
export { diffWords, diffTokens, lcsPairs, lcsRatio, type DiffToken } from './diff';
export {
  grade, needsAiGrading, compareText, looksEnglish, CASE_SCORE, ALMOST_SCORE, SPEAK_PASS,
  type GradeResult, type Answer,
} from './grade';
export {
  gradeSpeech, pronunciationIssues, PRONUNCIATION_RULES, SPEECH_NEAR_CREDIT,
  type PronunciationHint, type PronunciationIssue,
} from './speech';
export { numberKey } from './numbers';
export { minimalPairQuiz, drillUnitId, DRILL_UNIT_PREFIX, type MinimalPairItem } from './drills';
export { newCard, review, dueCards, ratingFromScore, configureScheduler, type CardState, type Rating } from './srs';
export {
  estimateSkills, errorProfile, unitProgress, streak, longestStreak, weeklyMinutes, dayKey,
  RECENCY_HALF_LIFE_DAYS, MASTERY_THRESHOLD,
  type Attempt, type SkillEstimate,
} from './progress';
export { placementItems, placeLearner, PLACEMENT_TYPES, PASS_SCORE, MASTERED_SCORE, type PlacementItem } from './placement';
