/**
 * Session threshold estimation per docs/SCORING_AND_FITNESS_STATE_SPEC.md §3 (Phase 6).
 * Weighted average pace across work reps; +1 sec/mi if drift > 8 bpm or Z5 > 20%.
 */

import { speedToPaceSecPerMile } from "./reconcile-reps.js";
import type { IntensityInputs } from "./scoring.js";

export interface LapForThreshold {
  moving_time: number;
  average_speed: number;
}

/**
 * Session threshold (sec/mile): Σ(pace_i * duration_i) / Σ(duration_i).
 * If drift_bpm > 8 OR pct_z5_work > 0.20: add 1 sec/mile (MVP).
 */
export function computeSessionThreshold(
  laps: LapForThreshold[],
  intensityInputs?: IntensityInputs | null
): number {
  if (laps.length === 0) return 0;
  let weightedSum = 0;
  let totalDuration = 0;
  for (const lap of laps) {
    const pace = lap.average_speed > 0 ? speedToPaceSecPerMile(lap.average_speed) : 0;
    weightedSum += pace * lap.moving_time;
    totalDuration += lap.moving_time;
  }
  if (totalDuration <= 0) return 0;
  let threshold = weightedSum / totalDuration;
  if (intensityInputs && (intensityInputs.drift_bpm > 8 || intensityInputs.pct_z5_work > 0.2)) {
    threshold += 1;
  }
  return Math.round(threshold);
}
