/**
 * FitnessState persistence per docs/SCORING_AND_FITNESS_STATE_SPEC.md §4, §6, §7, §8 (Phase 8).
 * Threshold update (alpha 0.15 / 0.10), race prediction, confidence, trend state.
 */

import type { FatigueState } from "./fatigue.js";

const THRESHOLD_ALPHA_NORMAL = 0.15;
const THRESHOLD_ALPHA_HIGH_FATIGUE = 0.1;
const HIGH_FATIGUE_THRESHOLD = 0.65;

/** Race distances in miles (for time = pace_sec_per_mile * miles). Spec §6. */
const MILES_5K = 3.10686;
const MILES_10K = 6.21371;
const MILES_HALF = 13.10938;
const MILES_MARATHON = 26.21875;

/** From threshold pace (sec/mi): pace_5k = threshold - 3, pace_10k = threshold + 2, etc. Spec §6. */
export function racePacesFromThreshold(thresholdSecPerMile: number): {
  pace_5k: number;
  pace_10k: number;
  pace_hm: number;
  pace_mar: number;
} {
  return {
    pace_5k: thresholdSecPerMile - 3,
    pace_10k: thresholdSecPerMile + 2,
    pace_hm: thresholdSecPerMile + 10,
    pace_mar: thresholdSecPerMile + 20,
  };
}

/** Race times in seconds from paces. Spec §6. */
export function raceTimesFromThreshold(thresholdSecPerMile: number): {
  t5k_sec: number;
  t10k_sec: number;
  thalf_sec: number;
  tmarathon_sec: number;
} {
  const p = racePacesFromThreshold(thresholdSecPerMile);
  return {
    t5k_sec: Math.round(p.pace_5k * MILES_5K),
    t10k_sec: Math.round(p.pace_10k * MILES_10K),
    thalf_sec: Math.round(p.pace_hm * MILES_HALF),
    tmarathon_sec: Math.round(p.pace_mar * MILES_MARATHON),
  };
}

/** Updated threshold: new = old*(1-alpha) + session*alpha. Alpha 0.15, or 0.10 if fatigue > 0.65. Spec §4. */
export function nextThreshold(
  previousThresholdSecPerMile: number | null,
  sessionThresholdSecPerMile: number,
  fatigueIndex: number
): number {
  const alpha =
    fatigueIndex > HIGH_FATIGUE_THRESHOLD ? THRESHOLD_ALPHA_HIGH_FATIGUE : THRESHOLD_ALPHA_NORMAL;
  if (previousThresholdSecPerMile == null || previousThresholdSecPerMile <= 0) {
    return Math.round(sessionThresholdSecPerMile);
  }
  return Math.round(
    previousThresholdSecPerMile * (1 - alpha) + sessionThresholdSecPerMile * alpha
  );
}

/** Execution consistency index: 1 - meanDeviation, clamped 0–1. Smoothed with alpha 0.25. */
export function executionConsistencyFromSession(meanDeviation: number): number {
  return Math.max(0, Math.min(1, 1 - meanDeviation));
}

/** HR stability index: 1 - drift penalty (0–1). Drift 4 bpm = 1, 12 bpm = 0. Smoothed with alpha 0.25. */
export function hrStabilityFromSession(driftBpm: number | null): number {
  if (driftBpm == null) return 1;
  const penalty = Math.max(0, Math.min(1, (driftBpm - 4) / (12 - 4)));
  return 1 - penalty;
}

/** Prediction confidence: weighted mix of sessions_count, execution_consistency, hr_stability, minus fatigue. Spec §7. */
export function predictionConfidence(
  sessionsCount: number,
  executionConsistencyIndex: number,
  hrStabilityIndex: number,
  fatigueIndex: number
): number {
  const base = (sessionsCount / 10) * 0.2 + executionConsistencyIndex * 0.4 + hrStabilityIndex * 0.4;
  const fatiguePenalty = fatigueIndex * 0.3;
  return Math.max(0, Math.min(1, base - fatiguePenalty));
}

export type FitnessTrendState = "improving" | "stable" | "plateauing" | "declining";

/** Spec §8: delta 5k ≥ 5 → improving; -5 < delta < 5 → stable; -15 < delta ≤ -5 → plateauing; delta ≤ -15 → declining. &lt; 3 sessions → stable. */
export function fitnessTrendState(
  sessionsCount: number,
  previousPredicted5kSec: number | null,
  newPredicted5kSec: number
): FitnessTrendState {
  if (sessionsCount < 3 || previousPredicted5kSec == null) return "stable";
  const delta = previousPredicted5kSec - newPredicted5kSec; // positive = new faster = improving
  if (delta >= 5) return "improving";
  if (delta > -5) return "stable";
  if (delta > -15) return "plateauing";
  return "declining";
}

export interface FitnessSnapshotInput {
  sessionScoreId: number;
  sessionThresholdSecPerMile: number;
  paceScore: number;
  meanDeviation: number;
  driftBpm: number | null;
  pctZ5Work: number | null;
  fatigueSignal: number;
  /** Previous snapshot (null for first session). */
  previous: {
    estimatedThresholdSecPerMile: number;
    trendDrift: number;
    trendZ5: number;
    trendExec: number;
    fatigueIndex: number;
    executionConsistencyIndex: number;
    hrStabilityIndex: number;
    sessionsCount: number;
    t5kSec: number;
  } | null;
}

export interface FitnessSnapshotRow {
  sessionScoreId: number;
  estimatedThresholdSecPerMile: number;
  t5kSec: number;
  t10kSec: number;
  thalfSec: number;
  tmarathonSec: number;
  trendDrift: number;
  trendZ5: number;
  trendExec: number;
  fatigueIndex: number;
  fatigueState: FatigueState;
  executionConsistencyIndex: number;
  hrStabilityIndex: number;
  predictionConfidence: number;
  fitnessTrendState: FitnessTrendState;
  sessionsCount: number;
}

const SMOOTH_ALPHA = 0.25;

export function computeNextFitnessSnapshot(input: FitnessSnapshotInput): FitnessSnapshotRow {
  const prev = input.previous;
  const sessionsCount = prev ? prev.sessionsCount + 1 : 1;

  const trendDrift =
    prev != null
      ? smooth(prev.trendDrift, input.driftBpm != null ? driftNorm(input.driftBpm) : 0)
      : input.driftBpm != null
        ? driftNorm(input.driftBpm)
        : 0;
  const trendZ5 =
    prev != null
      ? smooth(prev.trendZ5, input.pctZ5Work != null ? z5Norm(input.pctZ5Work) : 0)
      : input.pctZ5Work != null
        ? z5Norm(input.pctZ5Work)
        : 0;
  const trendExec =
    prev != null ? smooth(prev.trendExec, execNorm(input.paceScore)) : execNorm(input.paceScore);

  const oldFatigue = prev != null ? prev.fatigueIndex : 0;
  const fatigueIndex = nextFatigue(oldFatigue, input.fatigueSignal);
  const fatigueState = fatigueStateFromIndex(fatigueIndex);

  const estimatedThresholdSecPerMile = nextThreshold(
    prev?.estimatedThresholdSecPerMile ?? null,
    input.sessionThresholdSecPerMile,
    fatigueIndex
  );

  const raceTimes = raceTimesFromThreshold(estimatedThresholdSecPerMile);

  const executionConsistencyIndex =
    prev != null
      ? smooth(prev.executionConsistencyIndex, executionConsistencyFromSession(input.meanDeviation))
      : executionConsistencyFromSession(input.meanDeviation);

  const hrStabilityRaw = hrStabilityFromSession(input.driftBpm);
  const hrStabilityIndex =
    prev != null ? smooth(prev.hrStabilityIndex, hrStabilityRaw) : hrStabilityRaw;

  const confidence = predictionConfidence(
    sessionsCount,
    executionConsistencyIndex,
    hrStabilityIndex,
    fatigueIndex
  );

  const trendState = fitnessTrendState(
    sessionsCount,
    prev?.t5kSec ?? null,
    raceTimes.t5k_sec
  );

  return {
    sessionScoreId: input.sessionScoreId,
    estimatedThresholdSecPerMile,
    t5kSec: raceTimes.t5k_sec,
    t10kSec: raceTimes.t10k_sec,
    thalfSec: raceTimes.thalf_sec,
    tmarathonSec: raceTimes.tmarathon_sec,
    trendDrift,
    trendZ5,
    trendExec,
    fatigueIndex,
    fatigueState,
    executionConsistencyIndex,
    hrStabilityIndex,
    predictionConfidence: confidence,
    fitnessTrendState: trendState,
    sessionsCount,
  };
}

function smooth(prev: number, current: number): number {
  return prev * (1 - SMOOTH_ALPHA) + current * SMOOTH_ALPHA;
}

function driftNorm(bpm: number): number {
  return Math.max(0, Math.min(1, (bpm - 4) / (12 - 4)));
}

function z5Norm(pct: number): number {
  return Math.max(0, Math.min(1, (pct - 0.1) / (0.25 - 0.1)));
}

function execNorm(paceScore: number): number {
  return 1 - Math.max(0, Math.min(1, paceScore / 40));
}

function nextFatigue(oldFatigue: number, signal: number): number {
  return Math.max(0, Math.min(1, oldFatigue * 0.75 + signal * 0.25));
}

function fatigueStateFromIndex(f: number): FatigueState {
  if (f <= 0.3) return "Low";
  if (f <= 0.55) return "Stable";
  if (f <= 0.75) return "Building";
  return "High";
}
