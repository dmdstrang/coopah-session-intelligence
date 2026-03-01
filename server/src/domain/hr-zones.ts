/**
 * Compute work-window HR zone % and drift for intensity scoring.
 * Spec §2.3. Zones as % of max HR: Z2 60–70%, Z3 70–80%, Z4 80–90%, Z5 >90%.
 */

import type { IntensityInputs } from "./scoring.js";

const DEFAULT_MAX_HR = 190;

/** Zone bounds as fraction of max HR. */
const Z2_LO = 0.6;
const Z2_HI = 0.7;
const Z3_LO = 0.7;
const Z3_HI = 0.8;
const Z4_LO = 0.8;
const Z4_HI = 0.9;
// Z5: > 0.9

export interface WorkWindow {
  startSec: number;
  endSec: number;
}

/**
 * Compute pct_z2_work, pct_z3_work, pct_z4_work, pct_z5_work from time and heartrate streams
 * over the given work windows. time and heartrate must be same-length arrays (sample-aligned).
 */
export function computeZonePctInWorkWindows(
  timeSec: number[],
  heartrate: number[],
  windows: WorkWindow[],
  maxHr: number = DEFAULT_MAX_HR
): { pct_z2: number; pct_z3: number; pct_z4: number; pct_z5: number } {
  if (timeSec.length === 0 || timeSec.length !== heartrate.length) {
    return { pct_z2: 0, pct_z3: 0, pct_z4: 0, pct_z5: 0 };
  }
  let countZ2 = 0,
    countZ3 = 0,
    countZ4 = 0,
    countZ5 = 0,
    total = 0;
  for (let i = 0; i < timeSec.length; i++) {
    const t = timeSec[i];
    const inWindow = windows.some((w) => t >= w.startSec && t < w.endSec);
    if (!inWindow) continue;
    const hr = heartrate[i];
    if (typeof hr !== "number" || hr <= 0) continue;
    total++;
    const pct = hr / maxHr;
    if (pct >= Z4_HI) countZ5++;
    else if (pct >= Z4_LO) countZ4++;
    else if (pct >= Z3_LO) countZ3++;
    else if (pct >= Z2_LO) countZ2++;
  }
  if (total === 0) return { pct_z2: 0, pct_z3: 0, pct_z4: 0, pct_z5: 0 };
  return {
    pct_z2: countZ2 / total,
    pct_z3: countZ3 / total,
    pct_z4: countZ4 / total,
    pct_z5: countZ5 / total,
  };
}

/**
 * Build work windows from laps in order (by lap_index). Each lap's elapsed_time is its duration;
 * start of lap i = sum of elapsed_time of all previous laps.
 */
export function workWindowsFromLaps(
  lapsOrderedByIndex: { elapsed_time: number }[]
): WorkWindow[] {
  let start = 0;
  return lapsOrderedByIndex.map((lap) => {
    const end = start + lap.elapsed_time;
    const w: WorkWindow = { startSec: start, endSec: end };
    start = end;
    return w;
  });
}

/**
 * Drift in bpm: avg HR last rep - avg HR first rep. Uses lap-level average_heartrate.
 */
export function driftBpmFromLapAverages(
  lapsInOrder: { average_heartrate?: number }[]
): number {
  const hrs = lapsInOrder
    .map((l) => l.average_heartrate)
    .filter((h): h is number => typeof h === "number" && h > 0);
  if (hrs.length < 2) return 0;
  return hrs[hrs.length - 1] - hrs[0];
}

/**
 * Build IntensityInputs from streams and work laps (in activity order).
 * timeStream and heartrateStream are Strava stream arrays (same length, sample-aligned).
 */
export function intensityInputsFromStreams(
  timeStream: number[],
  heartrateStream: number[],
  workLapsInOrder: { elapsed_time: number; average_heartrate?: number }[],
  maxHr: number = DEFAULT_MAX_HR
): IntensityInputs {
  const windows = workWindowsFromLaps(workLapsInOrder);
  const zones = computeZonePctInWorkWindows(
    timeStream,
    heartrateStream,
    windows,
    maxHr
  );
  const drift_bpm = driftBpmFromLapAverages(workLapsInOrder);
  return {
    pct_z2_work: zones.pct_z2,
    pct_z3_work: zones.pct_z3,
    pct_z4_work: zones.pct_z4,
    pct_z5_work: zones.pct_z5,
    drift_bpm,
  };
}
