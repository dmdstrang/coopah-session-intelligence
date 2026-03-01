# Deterministic Scoring & FitnessState Model — MVP Locked Spec

This document is the single source of truth for session scoring and FitnessState. It replaces all previous scoring and FitnessState wording. Implement as written; no interpretation required.

---

## 1. Core Definitions

**Work Reps:** Only laps mapped to planned "Rep X" blocks. Exclude: warm up, cool down, recovery laps, any unmapped laps. All scoring and modelling use work reps only.

---

## 2. Session Scoring (0–100)

**Default weights:** Execution (Pace) → 40, Volume (Work Duration) → 20, Intensity (HR Control) → 40.

**If HR unavailable:** Execution → 60, Volume → 40, Intensity → 0.

### 2.1 Execution Score (0–40)

**Inputs per rep i:** actual_pace_i (sec/mile), target_pace_i (sec/mile), duration_i (sec).

- **Step 1 — Deviation per rep:** `dev_i = abs(actual_pace_i - target_pace_i) / target_pace_i`
- **Step 2 — Duration-weighted mean deviation:** `mean_dev = Σ(dev_i * duration_i) / Σ(duration_i)`
- **Step 3 — Base execution score (6% = zero):** `exec_base = 40 * (1 - clamp(mean_dev / 0.06, 0, 1))`
- **Step 4 — Consistency penalty (duration-weighted std):** `std_dev = sqrt(Σ((dev_i - mean_dev)^2 * duration_i) / Σ(duration_i))`. If std_dev ≤ 0.01 → 0; if std_dev ≥ 0.04 → 5 pts. `consistency_penalty = 5 * clamp((std_dev - 0.01) / (0.04 - 0.01), 0, 1)`
- **Step 5 — Fade penalty:** First half vs second half (by rep order). `fade = mean_dev_second_half - mean_dev_first_half`. If fade ≤ 0.01 → 0; if fade ≥ 0.04 → 5 pts. `fade_penalty = 5 * clamp((fade - 0.01) / (0.04 - 0.01), 0, 1)`
- **Final:** `execution_score = clamp(exec_base - consistency_penalty - fade_penalty, 0, 40)`

### 2.2 Volume Score (0–20)

`ratio = total_work_duration_actual / total_work_duration_planned`

- 0.98–1.02 → 20
- 0.95–0.98 or 1.02–1.05 → 15
- If ratio < 0.95: `volume_score = 15 * clamp((ratio - 0.85) / (0.95 - 0.85), 0, 1)`
- If ratio > 1.05: `volume_score = 15 * clamp((1.15 - ratio) / (1.15 - 1.05), 0, 1)`
- Then `volume_score = clamp(volume_score, 0, 20)`. No bonus for exceeding volume.

### 2.3 Intensity Score (0–40)

Only if HR available. **Work windows only:** pct_z2_work, pct_z3_work, pct_z4_work, pct_z5_work; drift_bpm = avg_hr_last_rep - avg_hr_first_rep.

- **Band (Z3+Z4 ≥ 70%):** `p_band = 1 - clamp(pct_z3z4 / 0.70, 0, 1)`
- **Z5:** No penalty ≤10%, full ≥25%. `p_z5 = clamp((pct_z5_work - 0.10) / (0.25 - 0.10), 0, 1)`
- **Z2:** No penalty ≤5%, full ≥15%. `p_z2 = clamp((pct_z2_work - 0.05) / (0.15 - 0.05), 0, 1)`
- **Drift:** No penalty ≤4 bpm, full ≥12 bpm. `p_drift = clamp((drift_bpm - 4) / (12 - 4), 0, 1)`
- **Composite:** `p_total = 0.35*p_band + 0.30*p_z5 + 0.25*p_drift + 0.10*p_z2`
- **Final:** `intensity_score = 40 * (1 - clamp(p_total, 0, 1))`

### 2.4 Final Total Score

**If HR available:** `total_score = execution_score + volume_score + intensity_score`

**If HR missing:** `execution_scaled = (execution_score / 40) * 60`, `volume_scaled = (volume_score / 20) * 40`, `total_score = execution_scaled + volume_scaled`

---

## 3. Threshold Estimation (Phase 6)

Weighted across work reps: `session_threshold = Σ(pace_i * duration_i) / Σ(duration_i)`. If drift_bpm > 8 OR pct_z5_work > 0.20: session_threshold += 1 sec/mile (MVP).

---

## 4. Persistent FitnessState (Phase 8)

Stored fields: estimated_threshold_pace_sec_per_mile, estimated_race_times_sec (t5k, t10k, thalf, tmarathon), fatigue_index, fatigue_state, execution_consistency_index, hr_stability_index, prediction_confidence, fitness_trend_state, sessions_count. Threshold update with alpha 0.15 (0.10 if fatigue > 0.65). Execution consistency and HR stability indices with smoothing. See full spec for formulas.

---

## 5. Fatigue Index (Phase 7)

Per-session signals with trend smoothing (alpha 0.25). Composite: 0.35*trend_drift + 0.25*trend_z5 + 0.40*trend_exec. `new_fatigue = old_fatigue*0.75 + fatigue_signal*0.25`. State bands: 0–0.30 Low, 0.31–0.55 Stable, 0.56–0.75 Building, 0.76–1.00 High.

---

## 6. Race Prediction (Phase 8)

From threshold: pace_5k = threshold - 3, pace_10k = threshold + 2, pace_hm = threshold + 10, pace_mar = threshold + 20. Convert to times (miles): t5k = pace_5k * 3.10686, etc.

---

## 7. Prediction Confidence (Phase 8)

Weighted mix of sessions_count, execution_consistency_index, hr_stability_index, minus fatigue penalty.

---

## 8. Fitness Trend State (Phase 8)

Compare previous vs new predicted 5K: delta ≥ 5 → improving; -5 < delta < 5 → stable; -15 < delta ≤ -5 → plateauing; delta ≤ -15 → declining. If fewer than 3 sessions → stable.

---

## 9. Session Visualisations (UI)

For the **current session** analysis view:

1. **Pace vs target** — Chart showing planned (target) pace and actual pace per work rep (e.g. grouped bar or dual series). X-axis: rep number; Y-axis: pace (e.g. min/mi or sec/mi). Makes it easy to see which reps were on target and which drifted.

2. **Heart rate across the session** — Chart showing heart rate (bpm) over elapsed time for the activity. Uses the activity’s HR stream (when available). X-axis: time (e.g. minutes from start); Y-axis: HR (bpm). Optionally shade or annotate work windows. If no HR data, show a short message instead.
