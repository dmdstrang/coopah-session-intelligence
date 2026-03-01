# Coopah Session Intelligence — Implementation Plan (MVP)

Follow this order. Domain before UI; AI last.

| # | Phase | Status |
|---|--------|--------|
| 1 | **Goal feature** — goals table, CRUD, goalPace + weeksRemaining; goal form, no-goal gate | ✅ Done |
| 2 | **Strava integration** — OAuth, token storage/refresh, last 10 activities, activity + laps + streams | ✅ Done |
| 3 | **Screenshot OCR + parser** — vision/OCR, extract session + work blocks, user confirms plan | ✅ Done |
| 4 | **Rep reconciliation** — fastest N laps, duration ±15%, mapping confidence; manual lap selection if needed | ✅ Done |
| 5 | **Scoring engine** — pace (40) + volume (20) + intensity (40), store session_scores | ✅ Done |
| 6 | **Threshold model** — weighted average + HR adjustment + 0.85/0.15 smoothing | ✅ Done |
| 7 | **Fatigue model** — fatigue_signal formula, state bands, persist in snapshots | ✅ Done |
| 8 | **FitnessState persistence** — append snapshot after each analysis; GET fitness-state, GET sessions | ✅ Done |
| 9 | **UI** — Analysis screen BLOCKs 1–7 (Session Score, Fitness Impact, Pace Execution, HR Profile, Trajectory, Current Fitness, Coach Review) | ✅ Done |
| 10 | **AI narrative** — Coach Review endpoint, display in BLOCK 7 | ✅ Stub |

## Phase 4 — Rep reconciliation

- **Given:** N planned work reps (from confirmed parsed plan).
- **Select:** Fastest N laps from the Strava activity.
- **Validate:** Each selected lap duration within ±15% of planned work duration.
- **Output:** Selected lap IDs in order, mapping confidence (0–100). If confidence below threshold, require manual lap selection in UI.
- **Manual lap matching (to add):** When mapping confidence is low or user wants to override, let user assign which lap ID maps to which planned rep (e.g. dropdown per rep or reorder list); send `selectedLapIds` in analyse body.

**Scoring and FitnessState:** Implement per [docs/SCORING_AND_FITNESS_STATE_SPEC.md](docs/SCORING_AND_FITNESS_STATE_SPEC.md). The previous free-form scoring and FitnessState wording is superseded by that spec; no interpretation — implement as written.

## Phase 5 — Scoring engine (revised)

- **Execution (0–40):** Duration-weighted mean deviation, consistency penalty (duration-weighted std 0–5 pts), fade penalty (first vs second half 0–5 pts). See spec §2.1.
- **Volume (0–20):** Ratio 0.98–1.02 → 20; 0.95–0.98 or 1.02–1.05 → 15; else linear scale between 0.85 and 1.15. See spec §2.2.
- **Intensity (0–40):** Z2/Z3/Z4/Z5 band compliance + Z5/Z2/drift penalties when HR available; HR-unavailable path: Execution→60, Volume→40, Intensity→0, total = scaled. See spec §2.3–2.4.
- Store in `session_scores`.

## Phase 6–10 (summary)

- **6** Threshold: spec §3 (weighted session threshold, +1 sec if drift/z5).
- **7** Fatigue: spec §5 (trend smoothing, composite signal, state bands).
- **8** FitnessState: spec §4, §6, §7, §8 (all stored fields, indices, race prediction, confidence, trend).
- **9** UI: dark theme, Recharts, BLOCKs 1–7 in order.
- **10** AI: Coach Review LLM, BLOCK 7.
