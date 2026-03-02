/**
 * Session scoring per docs/SCORING_AND_FITNESS_STATE_SPEC.md (MVP Locked).
 * Execution (0–40), Volume (0–20), Intensity (0–40). Deterministic.
 */

import { speedToPaceSecPerMile } from "./reconcile-reps.js";

export interface PlannedWorkRepForScoring {
  durationSeconds: number;
  targetPaceSecPerMile: number;
}

export interface LapForScoring {
  moving_time: number;
  average_speed: number;
  average_heartrate?: number;
}

/** When HR available: work-window zone % and drift for intensity score. */
export interface IntensityInputs {
  pct_z2_work: number;
  pct_z3_work: number;
  pct_z4_work: number;
  pct_z5_work: number;
  drift_bpm: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Execution score (0–40): duration-weighted mean deviation, consistency penalty, fade penalty.
 * Spec §2.1. duration_i uses actual lap duration (moving_time).
 */
function executionScore(
  planned: PlannedWorkRepForScoring[],
  laps: LapForScoring[]
): { score: number; meanDeviation: number; stdDeviation: number; perRepDeviation: number[] } {
  if (planned.length === 0 || laps.length === 0 || planned.length !== laps.length) {
    return { score: 0, meanDeviation: 0, stdDeviation: 0, perRepDeviation: [] };
  }
  const n = planned.length;
  const dev: number[] = [];
  const dur: number[] = [];
  for (let i = 0; i < n; i++) {
    const target = planned[i].targetPaceSecPerMile;
    const speed = laps[i].average_speed;
    const actual = speed > 0 ? speedToPaceSecPerMile(speed) : 0;
    dev.push(target > 0 && actual > 0 ? Math.abs(actual - target) / target : 0);
    dur.push(laps[i].moving_time > 0 ? laps[i].moving_time : planned[i].durationSeconds || 60);
  }
  const totalDur = dur.reduce((a, b) => a + b, 0);
  if (totalDur <= 0) {
    return { score: 0, meanDeviation: 0, stdDeviation: 0, perRepDeviation: dev };
  }
  const meanDev = dev.reduce((s, d, i) => s + d * dur[i], 0) / totalDur;
  const variance =
    dev.reduce((s, d, i) => s + (d - meanDev) ** 2 * dur[i], 0) / totalDur;
  const stdDev = Math.sqrt(variance);

  const execBase = 40 * (1 - clamp(meanDev / 0.06, 0, 1));
  const consistencyPenalty =
    5 * clamp((stdDev - 0.01) / (0.04 - 0.01), 0, 1);
  const half = Math.floor(n / 2);
  const firstHalfDur = dur.slice(0, half).reduce((a, b) => a + b, 0);
  const secondHalfDur = dur.slice(half).reduce((a, b) => a + b, 0);
  const meanDevFirst =
    firstHalfDur > 0
      ? dev.slice(0, half).reduce((s, d, i) => s + d * dur[i], 0) / firstHalfDur
      : meanDev;
  const meanDevSecond =
    secondHalfDur > 0
      ? dev.slice(half).reduce((s, d, i) => s + d * dur[i + half], 0) /
        secondHalfDur
      : meanDev;
  const fade = meanDevSecond - meanDevFirst;
  const fadePenalty = 5 * clamp((fade - 0.01) / (0.04 - 0.01), 0, 1);
  const score = Math.round(clamp(execBase - consistencyPenalty - fadePenalty, 0, 40));
  return {
    score,
    meanDeviation: meanDev,
    stdDeviation: stdDev,
    perRepDeviation: dev,
  };
}

/**
 * Volume score (0–20). Only score down if volume ≤98% or >150% of planned.
 * Band 98% < ratio ≤ 150% → full marks (20). Below 98% or above 150% → linear penalty.
 */
function volumeScore(
  plannedTotalSeconds: number,
  actualTotalSeconds: number
): number {
  if (plannedTotalSeconds <= 0) return 0;
  const ratio = actualTotalSeconds / plannedTotalSeconds;
  // Full marks when above 98% and at or below 150% of planned (e.g. 102% is fine)
  if (ratio > 0.98 && ratio <= 1.5) return 20;
  if (ratio <= 0.98) {
    // Under volume: linear 0.85 → 0, 0.98 → 15
    const s = 15 * clamp((ratio - 0.85) / (0.98 - 0.85), 0, 1);
    return Math.round(clamp(s, 0, 20));
  }
  // Over volume (>150%): linear 1.5 → 20, 2.0+ → 0
  const s = 20 * clamp((2.0 - ratio) / (2.0 - 1.5), 0, 1);
  return Math.round(clamp(s, 0, 20));
}

/**
 * Intensity score (0–40) when HR available. Spec §2.3.
 * Band (Z3+Z4), Z5, Z2, drift penalties; composite weights 0.35, 0.30, 0.25, 0.10.
 */
function intensityScoreFromInputs(inputs: IntensityInputs): number {
  const pct_z3z4 = inputs.pct_z3_work + inputs.pct_z4_work;
  const pBand = 1 - clamp(pct_z3z4 / 0.7, 0, 1);
  const pZ5 = clamp((inputs.pct_z5_work - 0.1) / (0.25 - 0.1), 0, 1);
  const pZ2 = clamp((inputs.pct_z2_work - 0.05) / (0.15 - 0.05), 0, 1);
  const pDrift = clamp((inputs.drift_bpm - 4) / (12 - 4), 0, 1);
  const pTotal = 0.35 * pBand + 0.3 * pZ5 + 0.25 * pDrift + 0.1 * pZ2;
  return Math.round(40 * (1 - clamp(pTotal, 0, 1)));
}

export interface SessionScoreResult {
  paceScore: number;
  volumeScore: number;
  intensityScore: number;
  totalScore: number;
  hrAvailable: boolean;
  breakdown: {
    pace: { meanDeviation: number; stdDeviation: number; perRepDeviation: number[] };
  };
  /** Diagnostics: why volume/execution might be 0 */
  diagnostics?: {
    volumeRatio: number;
    plannedWorkDurationSec: number;
    actualWorkDurationSec: number;
    executionMeanDeviation: number;
  };
}

/**
 * Compute full session score. Spec §2.
 * When intensityInputs is absent (HR unavailable), intensity = 0 and total uses scaled execution (60) + volume (40).
 */
export function computeSessionScore(
  planned: PlannedWorkRepForScoring[],
  laps: LapForScoring[],
  intensityInputs?: IntensityInputs | null
): SessionScoreResult {
  if (planned.length === 0 || laps.length !== planned.length) {
    return {
      paceScore: 0,
      volumeScore: 0,
      intensityScore: 0,
      totalScore: 0,
      hrAvailable: false,
      breakdown: { pace: { meanDeviation: 0, stdDeviation: 0, perRepDeviation: [] } },
      diagnostics: {
        volumeRatio: 0,
        plannedWorkDurationSec: 0,
        actualWorkDurationSec: 0,
        executionMeanDeviation: 0,
      },
    };
  }
  const exec = executionScore(planned, laps);
  const plannedTotal = planned.reduce((s, p) => s + p.durationSeconds, 0);
  const actualTotal = laps.reduce((s, l) => s + Math.max(l.moving_time, 0), 0);
  const vol = volumeScore(plannedTotal, actualTotal);
  const hasHr = intensityInputs != null;
  const int = hasHr ? intensityScoreFromInputs(intensityInputs) : 0;

  let total: number;
  if (hasHr) {
    total = exec.score + vol + int;
  } else {
    const executionScaled = (exec.score / 40) * 60;
    const volumeScaled = (vol / 20) * 40;
    total = executionScaled + volumeScaled;
  }
  total = clamp(Math.round(total), 0, 100);

  const volumeRatio = plannedTotal > 0 ? actualTotal / plannedTotal : 0;

  return {
    paceScore: exec.score,
    volumeScore: vol,
    intensityScore: int,
    totalScore: total,
    hrAvailable: hasHr,
    breakdown: {
      pace: {
        meanDeviation: exec.meanDeviation,
        stdDeviation: exec.stdDeviation,
        perRepDeviation: exec.perRepDeviation,
      },
    },
    diagnostics: {
      volumeRatio,
      plannedWorkDurationSec: plannedTotal,
      actualWorkDurationSec: actualTotal,
      executionMeanDeviation: exec.meanDeviation,
    },
  };
}
