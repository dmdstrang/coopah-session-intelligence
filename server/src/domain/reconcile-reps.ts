/**
 * Rep reconciliation: match N planned work reps to N actual Strava laps.
 * Select fastest N laps; validate duration ±15%. Mapping confidence gates manual selection.
 */

export interface PlannedWorkRep {
  durationSeconds: number;
}

export interface LapForReconcile {
  id: number;
  lap_index: number;
  moving_time: number;
  elapsed_time: number;
  distance: number;
  average_speed: number; // m/s
}

const DURATION_TOLERANCE = 0.15; // ±15%
const CONFIDENCE_THRESHOLD = 70; // below this: require manual lap selection

/** Pace in sec/mi from Strava speed in m/s. */
export function speedToPaceSecPerMile(mps: number): number {
  if (mps <= 0) return 9999;
  const metersPerMile = 1609.344;
  return metersPerMile / mps;
}

/**
 * Reconcile planned work reps to activity laps.
 * - Sort laps by pace (fastest first) and take first N.
 * - For each selected lap, check duration within ±15% of corresponding planned rep.
 * - mappingConfidence = (laps within tolerance / N) * 100.
 * - requiresManualSelection = mappingConfidence < threshold.
 */
export function reconcileReps(
  plannedWork: PlannedWorkRep[],
  laps: LapForReconcile[]
): {
  selectedLapsInOrder: LapForReconcile[];
  proposedMapping: { plannedIndex: number; lapId: number; lap: LapForReconcile; durationOk: boolean }[];
  mappingConfidence: number;
  requiresManualSelection: boolean;
} {
  const N = plannedWork.length;
  if (N === 0) {
    return {
      selectedLapsInOrder: [],
      proposedMapping: [],
      mappingConfidence: 100,
      requiresManualSelection: false,
    };
  }

  if (laps.length < N) {
    return {
      selectedLapsInOrder: [],
      proposedMapping: [],
      mappingConfidence: 0,
      requiresManualSelection: true,
    };
  }

  // Sort by pace (fastest first): higher average_speed = faster = lower sec/mi
  const sorted = [...laps].sort((a, b) => b.average_speed - a.average_speed);
  const selected = sorted.slice(0, N);

  const proposedMapping: { plannedIndex: number; lapId: number; lap: LapForReconcile; durationOk: boolean }[] = [];
  let durationOkCount = 0;

  for (let i = 0; i < N; i++) {
    const planned = plannedWork[i];
    const lap = selected[i];
    const plannedDur = planned.durationSeconds;
    const actualDur = lap.moving_time;
    const ratio = plannedDur > 0 ? actualDur / plannedDur : 1;
    const durationOk = ratio >= 1 - DURATION_TOLERANCE && ratio <= 1 + DURATION_TOLERANCE;
    if (durationOk) durationOkCount++;
    proposedMapping.push({ plannedIndex: i, lapId: lap.id, lap, durationOk });
  }

  const mappingConfidence = Math.round((durationOkCount / N) * 100);
  const requiresManualSelection = mappingConfidence < CONFIDENCE_THRESHOLD;

  return {
    selectedLapsInOrder: selected,
    proposedMapping,
    mappingConfidence,
    requiresManualSelection,
  };
}
