/**
 * Log scoring calculations for testing. Call from analyse route.
 * Planned vs actual per rep, totals, volume ratio, execution breakdown.
 */

import { speedToPaceSecPerMile } from "../domain/reconcile-reps.js";
import type { PlannedWorkRepForScoring } from "../domain/scoring.js";
import type { SessionScoreResult } from "../domain/scoring.js";

interface LapForLog {
  moving_time: number;
  average_speed: number;
}

function paceToMinSec(secPerMile: number): string {
  if (secPerMile >= 9999) return "—";
  const m = Math.floor(secPerMile / 60);
  const s = Math.round(secPerMile % 60);
  return `${m}:${s.toString().padStart(2, "0")}/mi`;
}

export function logScoringCalculations(
  planned: PlannedWorkRepForScoring[],
  laps: LapForLog[],
  result: SessionScoreResult,
  activityId: string | number
): void {
  const lines: string[] = [];
  lines.push("");
  lines.push("========== SCORING CALCULATIONS ==========");
  lines.push(`Activity ID: ${activityId}`);
  lines.push("");

  if (planned.length === 0 || laps.length !== planned.length) {
    lines.push("No work reps or count mismatch.");
    lines.push("==========================================");
    console.log(lines.join("\n"));
    return;
  }

  lines.push("--- Planned vs actual (work reps only) ---");
  let plannedTotalSec = 0;
  let actualTotalSec = 0;
  for (let i = 0; i < planned.length; i++) {
    const p = planned[i];
    const l = laps[i];
    const actualPace = l.average_speed > 0 ? speedToPaceSecPerMile(l.average_speed) : 0;
    plannedTotalSec += p.durationSeconds;
    actualTotalSec += l.moving_time > 0 ? l.moving_time : p.durationSeconds;
    const dev = result.breakdown?.pace?.perRepDeviation?.[i];
    lines.push(
      `  Rep ${i + 1}: planned ${p.durationSeconds}s @ ${paceToMinSec(p.targetPaceSecPerMile)}  →  actual ${l.moving_time}s @ ${paceToMinSec(actualPace)}  (deviation: ${dev != null ? (dev * 100).toFixed(2) : "?"}%)`
    );
  }
  lines.push("");
  lines.push(`  Planned total work duration: ${plannedTotalSec}s (${(plannedTotalSec / 60).toFixed(1)} min)`);
  lines.push(`  Actual total work duration:  ${actualTotalSec}s (${(actualTotalSec / 60).toFixed(1)} min)`);
  const ratio = plannedTotalSec > 0 ? actualTotalSec / plannedTotalSec : 0;
  lines.push(`  Volume ratio (actual/planned): ${(ratio * 100).toFixed(1)}%`);
  lines.push(`  Volume score: ${result.volumeScore}/20`);
  lines.push("");

  const diag = result.diagnostics;
  if (diag) {
    lines.push("--- Execution ---");
    lines.push(`  Mean deviation: ${(diag.executionMeanDeviation * 100).toFixed(2)}% (under 6% = full marks)`);
    if (result.breakdown?.pace) {
      lines.push(`  Std deviation:  ${(result.breakdown.pace.stdDeviation * 100).toFixed(2)}%`);
    }
    lines.push(`  Execution score: ${result.paceScore}/40`);
    lines.push("");
  }

  lines.push("--- Total ---");
  lines.push(`  Execution: ${result.paceScore}/40  Volume: ${result.volumeScore}/20  Intensity: ${result.intensityScore}/40`);
  lines.push(`  Total: ${result.totalScore}/100  (HR ${result.hrAvailable ? "included" : "excluded — scaled exec+vol"})`);
  lines.push("==========================================");
  lines.push("");
  console.log(lines.join("\n"));
}
