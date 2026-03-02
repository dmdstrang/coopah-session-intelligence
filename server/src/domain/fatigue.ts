/**
 * Fatigue index and state bands per docs/SCORING_AND_FITNESS_STATE_SPEC.md §5 (Phase 7).
 * Per-session signals, trend smoothing (alpha 0.25), composite, state bands.
 */

const TREND_ALPHA = 0.25;
const FATIGUE_SMOOTH_OLD = 0.75;
const FATIGUE_SMOOTH_NEW = 0.25;

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Normalise drift 0–1 (same scale as intensity: 4 bpm = 0, 12 = 1). */
export function driftNorm(driftBpm: number): number {
  return clamp((driftBpm - 4) / (12 - 4), 0, 1);
}

/** Normalise Z5 0–1 (10% = 0, 25% = 1). */
export function z5Norm(pctZ5Work: number): number {
  return clamp((pctZ5Work - 0.1) / (0.25 - 0.1), 0, 1);
}

/** Execution contribution to fatigue: 1 - (score/40), so 0 = perfect, 1 = zero execution. */
export function execNorm(paceScore: number): number {
  return 1 - clamp(paceScore / 40, 0, 1);
}

/** Per-session fatigue signal (0–1). Composite: 0.35*drift + 0.25*z5 + 0.40*exec. Use 0 for drift/z5 when HR unavailable. */
export function fatigueSignalFromSession(
  paceScore: number,
  driftBpm?: number | null,
  pctZ5Work?: number | null
): number {
  const d = driftBpm != null ? driftNorm(driftBpm) : 0;
  const z = pctZ5Work != null ? z5Norm(pctZ5Work) : 0;
  const e = execNorm(paceScore);
  return 0.35 * d + 0.25 * z + 0.4 * e;
}

/** Return signal and components for user-facing fatigue explanation. */
export function fatigueSignalWithComponents(
  paceScore: number,
  driftBpm?: number | null,
  pctZ5Work?: number | null
): { signal: number; driftNorm: number; z5Norm: number; execNorm: number; driftBpm: number | null; pctZ5Work: number | null } {
  const d = driftBpm != null ? driftNorm(driftBpm) : 0;
  const z = pctZ5Work != null ? z5Norm(pctZ5Work) : 0;
  const e = execNorm(paceScore);
  return {
    signal: 0.35 * d + 0.25 * z + 0.4 * e,
    driftNorm: d,
    z5Norm: z,
    execNorm: e,
    driftBpm: driftBpm ?? null,
    pctZ5Work: pctZ5Work ?? null,
  };
}

/** Exponential smoothing: newTrend = old * (1 - alpha) + current * alpha. */
export function smoothTrend(oldTrend: number, current: number, alpha: number = TREND_ALPHA): number {
  return oldTrend * (1 - alpha) + current * alpha;
}

/** New fatigue index: new = old*0.75 + signal*0.25. Spec §5. */
export function nextFatigueIndex(oldFatigue: number, fatigueSignal: number): number {
  return clamp(
    oldFatigue * FATIGUE_SMOOTH_OLD + fatigueSignal * FATIGUE_SMOOTH_NEW,
    0,
    1
  );
}

export type FatigueState = "Low" | "Stable" | "Building" | "High";

/** State bands: 0–0.30 Low, 0.31–0.55 Stable, 0.56–0.75 Building, 0.76–1.00 High. Spec §5. */
export function fatigueStateFromIndex(fatigueIndex: number): FatigueState {
  if (fatigueIndex <= 0.3) return "Low";
  if (fatigueIndex <= 0.55) return "Stable";
  if (fatigueIndex <= 0.75) return "Building";
  return "High";
}
