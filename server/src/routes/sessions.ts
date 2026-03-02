import { Router } from "express";
import { desc, eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { parsedPlans, sessionScores, fitnessSnapshots, goals } from "../db/schema.js";
import { getValidAccessToken } from "./strava.js";
import type { AuthRequest } from "../middleware/auth.js";
import { getActivityLaps, getActivityStreams, getActivity } from "../services/strava.js";
import { reconcileReps, type LapForReconcile } from "../domain/reconcile-reps.js";
import { computeSessionScore, type IntensityInputs, type PlannedWorkRepForScoring } from "../domain/scoring.js";
import { intensityInputsFromStreams } from "../domain/hr-zones.js";
import { speedToPaceSecPerMile } from "../domain/reconcile-reps.js";
import { logScoringCalculations } from "../lib/scoring-logger.js";
import { computeSessionThreshold } from "../domain/threshold.js";
import { fatigueSignalFromSession, fatigueSignalWithComponents } from "../domain/fatigue.js";
import { computeNextFitnessSnapshot } from "../domain/fitness-state.js";
import { generateCoachNarrative } from "../lib/coach-narrative.js";
import { goalPaceSecPerMile, type GoalDistance } from "../domain/goal.js";

export const sessionsRouter = Router();

function getPlannedWorkIntervals(workBlocksJson: string): { durationSeconds: number }[] {
  const raw = JSON.parse(workBlocksJson) as unknown[];
  return raw
    .filter((inv: unknown) => (inv as { type?: string }).type === "work")
    .map((inv: unknown) => ({
      durationSeconds: typeof (inv as { durationSeconds?: number }).durationSeconds === "number"
        ? (inv as { durationSeconds: number }).durationSeconds
        : 0,
    }));
}

function getPlannedWorkForScoring(workBlocksJson: string): PlannedWorkRepForScoring[] {
  const raw = JSON.parse(workBlocksJson) as unknown[];
  return raw
    .filter((inv: unknown) => (inv as { type?: string }).type === "work")
    .map((inv: unknown) => {
      const x = inv as { durationSeconds?: number; targetPaceSecPerMile?: number };
      return {
        durationSeconds: typeof x.durationSeconds === "number" ? x.durationSeconds : 0,
        targetPaceSecPerMile: typeof x.targetPaceSecPerMile === "number" ? x.targetPaceSecPerMile : 360,
      };
    });
}

/** POST /api/sessions/reconcile — match plan work reps to activity laps (fastest N, ±15% duration). */
sessionsRouter.post("/reconcile", async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const body = req.body as {
      parsedPlanId?: number;
      activityId?: string | number;
      plan?: { intervals?: unknown[] };
    };
    const parsedPlanId = body.parsedPlanId;
    const activityId = body.activityId;
    if (parsedPlanId == null || activityId == null) {
      return res.status(400).json({
        error: "Missing parsedPlanId or activityId. Body: { parsedPlanId: number, activityId: string | number, plan?: { intervals } }",
      });
    }

    let plannedWork: { durationSeconds: number }[];
    if (Array.isArray(body.plan?.intervals) && body.plan.intervals.length > 0) {
      plannedWork = plannedWorkFromIntervals(body.plan.intervals);
    } else {
      const [plan] = await db.select().from(parsedPlans).where(and(eq(parsedPlans.id, parsedPlanId), eq(parsedPlans.userId, userId))).limit(1);
      if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      plannedWork = getPlannedWorkIntervals(plan.workBlocks);
    }
    if (plannedWork.length === 0) {
      return res.status(400).json({ error: "Plan has no work intervals" });
    }

    const { accessToken } = await getValidAccessToken(userId);
    const laps = await getActivityLaps(activityId, accessToken);
    const lapsForReconcile: LapForReconcile[] = laps.map((lap) => ({
      id: lap.id,
      lap_index: lap.lap_index,
      moving_time: lap.moving_time,
      elapsed_time: lap.elapsed_time,
      distance: lap.distance,
      average_speed: lap.average_speed,
    }));

    const result = reconcileReps(plannedWork, lapsForReconcile);

    res.json({
      mappingConfidence: result.mappingConfidence,
      requiresManualSelection: result.requiresManualSelection,
      proposedMapping: result.proposedMapping.map((m) => ({
        plannedIndex: m.plannedIndex,
        lapId: m.lapId,
        durationOk: m.durationOk,
        lap: {
          id: m.lap.id,
          lap_index: m.lap.lap_index,
          moving_time: m.lap.moving_time,
          distance: m.lap.distance,
          average_speed: m.lap.average_speed,
        },
      })),
      selectedLapIds: result.selectedLapsInOrder.map((l) => l.id),
    });
  } catch (e) {
    if (e instanceof Error && e.message === "Not connected to Strava") {
      return res.status(401).json({ error: "Not connected to Strava" });
    }
    console.error("Reconcile error:", e);
    res.status(500).json({ error: "Failed to reconcile reps" });
  }
});

/** Build planned work from raw intervals array (e.g. from client). */
function plannedWorkFromIntervals(intervals: unknown[]): { durationSeconds: number }[] {
  return intervals
    .filter((inv: unknown) => (inv as { type?: string }).type === "work")
    .map((inv: unknown) => ({
      durationSeconds: typeof (inv as { durationSeconds?: number }).durationSeconds === "number"
        ? (inv as { durationSeconds: number }).durationSeconds
        : 0,
    }));
}

function plannedForScoringFromIntervals(intervals: unknown[]): PlannedWorkRepForScoring[] {
  return intervals
    .filter((inv: unknown) => (inv as { type?: string }).type === "work")
    .map((inv: unknown) => {
      const x = inv as { durationSeconds?: number; targetPaceSecPerMile?: number };
      return {
        durationSeconds: typeof x.durationSeconds === "number" ? x.durationSeconds : 0,
        targetPaceSecPerMile: typeof x.targetPaceSecPerMile === "number" ? x.targetPaceSecPerMile : 360,
      };
    });
}

/** POST /api/sessions/analyse — reconcile then score, persist, return session score. */
sessionsRouter.post("/analyse", async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const body = req.body as {
      parsedPlanId?: number;
      activityId?: string | number;
      selectedLapIds?: number[];
      plan?: { sessionName?: string; intervals?: unknown[] };
    };
    const parsedPlanId = body.parsedPlanId;
    const activityId = body.activityId;
    if (parsedPlanId == null || activityId == null) {
      return res.status(400).json({
        error: "Missing parsedPlanId or activityId. Body: { parsedPlanId: number, activityId: string | number, selectedLapIds?: number[], plan?: { intervals } }",
      });
    }

    let plannedWork: { durationSeconds: number }[];
    let plannedForScoring: PlannedWorkRepForScoring[];
    let sessionNameForCoach: string | undefined;

    if (Array.isArray(body.plan?.intervals) && body.plan.intervals.length > 0) {
      plannedWork = plannedWorkFromIntervals(body.plan.intervals);
      plannedForScoring = plannedForScoringFromIntervals(body.plan.intervals);
      sessionNameForCoach = typeof (body.plan as { sessionName?: string }).sessionName === "string" ? (body.plan as { sessionName: string }).sessionName : undefined;
    } else {
      const [plan] = await db.select().from(parsedPlans).where(and(eq(parsedPlans.id, parsedPlanId), eq(parsedPlans.userId, userId))).limit(1);
      if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      plannedWork = getPlannedWorkIntervals(plan.workBlocks);
      plannedForScoring = getPlannedWorkForScoring(plan.workBlocks);
      sessionNameForCoach = plan.sessionName ?? undefined;
    }

    if (plannedWork.length === 0) {
      return res.status(400).json({ error: "Plan has no work intervals" });
    }

    const { accessToken } = await getValidAccessToken(userId);
    const [laps, activity] = await Promise.all([
      getActivityLaps(activityId, accessToken),
      getActivity(activityId, accessToken),
    ]);
    const lapsForReconcile: LapForReconcile[] = laps.map((lap) => ({
      id: lap.id,
      lap_index: lap.lap_index,
      moving_time: lap.moving_time,
      elapsed_time: lap.elapsed_time,
      distance: lap.distance,
      average_speed: lap.average_speed,
    }));

    let selectedLapIds: number[];
    let selectedLapsInOrder: { moving_time: number; average_speed: number; average_heartrate?: number }[];
    if (Array.isArray(body.selectedLapIds) && body.selectedLapIds.length === plannedWork.length) {
      const byId = new Map(laps.map((l) => [l.id, l]));
      const fullSelected = body.selectedLapIds.map((id) => byId.get(id)).filter(Boolean);
      if (fullSelected.length !== plannedWork.length) {
        return res.status(400).json({ error: "selectedLapIds did not match activity laps" });
      }
      selectedLapIds = body.selectedLapIds;
      selectedLapsInOrder = fullSelected.map((l) => ({
        moving_time: l!.moving_time,
        average_speed: l!.average_speed,
        average_heartrate: l!.average_heartrate,
      }));
    } else {
      const reconciled = reconcileReps(plannedWork, lapsForReconcile);
      if (reconciled.selectedLapsInOrder.length !== plannedWork.length) {
        return res.status(400).json({
          error: "Not enough laps to match plan. Run reconcile first or provide selectedLapIds.",
        });
      }
      selectedLapIds = reconciled.selectedLapsInOrder.map((l) => l.id);
      selectedLapsInOrder = reconciled.selectedLapsInOrder.map((l) => ({
        moving_time: l.moving_time,
        average_speed: l.average_speed,
        average_heartrate: (laps.find((lap) => lap.id === l.id))?.average_heartrate,
      }));
    }

    let intensityInputs: IntensityInputs | null = null;
    let hrStreamForSession: { timeSec: number[]; heartrate: number[] } | undefined;
    let workPeriods: { startSec: number; endSec: number }[] | undefined;
    if (activity.has_heartrate) {
      try {
        const streams = await getActivityStreams(activityId, accessToken);
        const timeStream = streams.find((s) => s.type === "time");
        const hrStream = streams.find((s) => s.type === "heartrate");
        if (timeStream?.data?.length && hrStream?.data?.length) {
          const byId = new Map(laps.map((l) => [l.id, l]));
          const selectedFull = selectedLapIds.map((id) => byId.get(id)).filter(Boolean);
          const lapsInTimeOrder = ([...selectedFull] as { id: number; lap_index: number; elapsed_time: number; average_heartrate?: number }[])
            .sort((a, b) => a.lap_index - b.lap_index);
          intensityInputs = intensityInputsFromStreams(
            timeStream.data,
            hrStream.data,
            lapsInTimeOrder
          );
          // Offset = time (sec) from activity start to first work lap (e.g. after warmup laps)
          const allLapsSorted = [...laps].sort((a, b) => a.lap_index - b.lap_index);
          const firstWorkLapIndex = allLapsSorted.findIndex((l) => l.id === selectedLapIds[0]);
          const offsetSec = firstWorkLapIndex <= 0 ? 0 : allLapsSorted.slice(0, firstWorkLapIndex).reduce((s, l) => s + l.elapsed_time, 0);
          workPeriods = lapsInTimeOrder.map((lap, i) => {
            const startSec = offsetSec + lapsInTimeOrder.slice(0, i).reduce((s, l) => s + l.elapsed_time, 0);
            return { startSec, endSec: startSec + lap.elapsed_time };
          });
          const maxPoints = 350;
          const timeData = timeStream.data;
          const hrData = hrStream.data;
          if (timeData.length === hrData.length && timeData.length > 0) {
            const step = timeData.length <= maxPoints ? 1 : Math.ceil(timeData.length / maxPoints);
            hrStreamForSession = {
              timeSec: timeData.filter((_, i) => i % step === 0),
              heartrate: hrData.filter((_, i) => i % step === 0),
            };
          }
        }
      } catch (_) {
        // no streams or error — score without intensity
      }
    }

    const scoreResult = computeSessionScore(
      plannedForScoring,
      selectedLapsInOrder,
      intensityInputs
    );

    logScoringCalculations(plannedForScoring, selectedLapsInOrder, scoreResult, activityId);

    const sessionThresholdSecPerMile = computeSessionThreshold(selectedLapsInOrder, intensityInputs);

    const perRepDeviation = scoreResult.breakdown?.pace?.perRepDeviation ?? [];
    const workSplits = plannedForScoring.map((p, i) => {
      const lap = selectedLapsInOrder[i];
      const actualPaceSecPerMile =
        lap.average_speed > 0 ? speedToPaceSecPerMile(lap.average_speed) : 0;
      return {
        repIndex: i + 1,
        lapId: selectedLapIds[i],
        plannedDurationSec: p.durationSeconds,
        plannedPaceSecPerMile: p.targetPaceSecPerMile,
        actualDurationSec: lap.moving_time,
        actualPaceSecPerMile: actualPaceSecPerMile,
        deviationPct: perRepDeviation[i] != null ? perRepDeviation[i] * 100 : 0,
      };
    });

    let fitnessStateForResponse: {
      estimatedThresholdSecPerMile: number;
      t5kSec: number;
      t10kSec: number;
      thalfSec: number;
      tmarathonSec: number;
      fatigueIndex: number;
      fatigueState: string;
      executionConsistencyIndex: number;
      hrStabilityIndex: number;
      predictionConfidence: number;
      fitnessTrendState: string;
      sessionsCount: number;
    } | undefined;

    const activityIdNum = typeof activityId === "string" ? parseInt(activityId, 10) : activityId;
    const [insertedScore] = await db
      .insert(sessionScores)
      .values({
        userId,
        parsedPlanId,
        stravaActivityId: activityIdNum,
        paceScore: scoreResult.paceScore,
        volumeScore: scoreResult.volumeScore,
        intensityScore: scoreResult.intensityScore,
        totalScore: scoreResult.totalScore,
        breakdown: JSON.stringify(scoreResult.breakdown),
        sessionThresholdSecPerMile,
        selectedLapIds: Array.isArray(body.selectedLapIds) ? JSON.stringify(body.selectedLapIds) : null,
      })
      .returning();

    const sessionScoreId = insertedScore?.id;
    let previousFatigueIndex: number | null = null;
    if (sessionScoreId != null) {
      const fatigueSignal = fatigueSignalFromSession(
        scoreResult.paceScore,
        intensityInputs?.drift_bpm ?? null,
        intensityInputs?.pct_z5_work ?? null
      );
      const [latestSnapshot] = await db
        .select()
        .from(fitnessSnapshots)
        .innerJoin(sessionScores, eq(fitnessSnapshots.sessionScoreId, sessionScores.id))
        .where(eq(sessionScores.userId, userId))
        .orderBy(desc(fitnessSnapshots.createdAt))
        .limit(1)
        .then((rows) => rows.map((r) => r.fitness_snapshots));
      const previous = latestSnapshot
        ? {
            estimatedThresholdSecPerMile: latestSnapshot.estimatedThresholdSecPerMile,
            trendDrift: (latestSnapshot.trendDrift ?? 0) / 100,
            trendZ5: (latestSnapshot.trendZ5 ?? 0) / 100,
            trendExec: (latestSnapshot.trendExec ?? 0) / 100,
            fatigueIndex: (latestSnapshot.fatigueIndex ?? 0) / 100,
            executionConsistencyIndex: (latestSnapshot.executionConsistencyIndex ?? 0) / 100,
            hrStabilityIndex: (latestSnapshot.hrStabilityIndex ?? 0) / 100,
            sessionsCount: latestSnapshot.sessionsCount,
            t5kSec: latestSnapshot.t5kSec,
          }
        : null;
      previousFatigueIndex = previous?.fatigueIndex ?? null;
      const nextSnapshot = computeNextFitnessSnapshot({
        sessionScoreId,
        sessionThresholdSecPerMile,
        paceScore: scoreResult.paceScore,
        meanDeviation: scoreResult.breakdown.pace.meanDeviation,
        driftBpm: intensityInputs?.drift_bpm ?? null,
        pctZ5Work: intensityInputs?.pct_z5_work ?? null,
        fatigueSignal,
        previous,
      });
      await db.insert(fitnessSnapshots).values({
        sessionScoreId: nextSnapshot.sessionScoreId,
        estimatedThresholdSecPerMile: nextSnapshot.estimatedThresholdSecPerMile,
        t5kSec: nextSnapshot.t5kSec,
        t10kSec: nextSnapshot.t10kSec,
        thalfSec: nextSnapshot.thalfSec,
        tmarathonSec: nextSnapshot.tmarathonSec,
        trendDrift: Math.round(nextSnapshot.trendDrift * 100),
        trendZ5: Math.round(nextSnapshot.trendZ5 * 100),
        trendExec: Math.round(nextSnapshot.trendExec * 100),
        fatigueIndex: Math.round(nextSnapshot.fatigueIndex * 100),
        fatigueState: nextSnapshot.fatigueState,
        executionConsistencyIndex: Math.round(nextSnapshot.executionConsistencyIndex * 100),
        hrStabilityIndex: Math.round(nextSnapshot.hrStabilityIndex * 100),
        predictionConfidence: Math.round(nextSnapshot.predictionConfidence * 100),
        fitnessTrendState: nextSnapshot.fitnessTrendState,
        sessionsCount: nextSnapshot.sessionsCount,
      });
      fitnessStateForResponse = {
        estimatedThresholdSecPerMile: nextSnapshot.estimatedThresholdSecPerMile,
        t5kSec: nextSnapshot.t5kSec,
        t10kSec: nextSnapshot.t10kSec,
        thalfSec: nextSnapshot.thalfSec,
        tmarathonSec: nextSnapshot.tmarathonSec,
        fatigueIndex: nextSnapshot.fatigueIndex,
        fatigueState: nextSnapshot.fatigueState,
        executionConsistencyIndex: nextSnapshot.executionConsistencyIndex,
        hrStabilityIndex: nextSnapshot.hrStabilityIndex,
        predictionConfidence: nextSnapshot.predictionConfidence,
        fitnessTrendState: nextSnapshot.fitnessTrendState,
        sessionsCount: nextSnapshot.sessionsCount,
      };
    }

    const intensityDiagnostics =
      intensityInputs != null
        ? {
            pct_z2_work: intensityInputs.pct_z2_work,
            pct_z3_work: intensityInputs.pct_z3_work,
            pct_z4_work: intensityInputs.pct_z4_work,
            pct_z5_work: intensityInputs.pct_z5_work,
            drift_bpm: intensityInputs.drift_bpm,
          }
        : undefined;

    const [goalRow] = await db
      .select()
      .from(goals)
      .where(eq(goals.userId, userId))
      .orderBy(desc(goals.createdAt))
      .limit(1);
    let raceGoal: { raceName: string; distance: string; goalPaceSecPerMile: number } | null = null;
    if (goalRow && goalRow.distance !== "custom") {
      try {
        const pace = goalPaceSecPerMile(goalRow.distance as GoalDistance, goalRow.goalTimeSec);
        raceGoal = { raceName: goalRow.raceName, distance: goalRow.distance, goalPaceSecPerMile: pace };
      } catch {
        /* skip */
      }
    }
    const coachReview = generateCoachNarrative(
      scoreResult.totalScore,
      scoreResult.paceScore,
      scoreResult.volumeScore,
      scoreResult.intensityScore,
      workSplits,
      intensityDiagnostics ?? null,
      fitnessStateForResponse
        ? {
            fatigueIndex: fitnessStateForResponse.fatigueIndex,
            fatigueState: fitnessStateForResponse.fatigueState,
            fitnessTrendState: fitnessStateForResponse.fitnessTrendState,
            estimatedThresholdSecPerMile: fitnessStateForResponse.estimatedThresholdSecPerMile,
            sessionsCount: fitnessStateForResponse.sessionsCount,
            predictionConfidence: fitnessStateForResponse.predictionConfidence,
          }
        : null,
      { raceGoal, sessionName: sessionNameForCoach, sessionThresholdSecPerMile }
    );

    res.json({
      sessionScoreId: insertedScore?.id ?? null,
      totalScore: scoreResult.totalScore,
      paceScore: scoreResult.paceScore,
      volumeScore: scoreResult.volumeScore,
      intensityScore: scoreResult.intensityScore,
      breakdown: scoreResult.breakdown,
      diagnostics: scoreResult.diagnostics,
      intensityDiagnostics,
      workSplits,
      sessionThresholdSecPerMile,
      fitnessState: fitnessStateForResponse,
      coachReview,
      hrStreamForSession,
      workPeriods,
      fatigueExplanation:
        fitnessStateForResponse != null
          ? (() => {
              const comp = fatigueSignalWithComponents(
                scoreResult.paceScore,
                intensityInputs?.drift_bpm ?? null,
                intensityInputs?.pct_z5_work ?? null
              );
              return {
                signalFromSession: comp.signal,
                previousIndex: previousFatigueIndex ?? 0,
                driftBpm: comp.driftBpm,
                pctZ5Work: comp.pctZ5Work,
                driftNorm: comp.driftNorm,
                z5Norm: comp.z5Norm,
                execNorm: comp.execNorm,
              };
            })()
          : undefined,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "Not connected to Strava") {
      return res.status(401).json({ error: "Not connected to Strava" });
    }
    console.error("Analyse error:", e);
    res.status(500).json({ error: "Failed to analyse session" });
  }
});

/** GET /api/sessions/fitness-state — latest fitness snapshot (Phase 8). */
sessionsRouter.get("/fitness-state", async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const rows = await db
      .select()
      .from(fitnessSnapshots)
      .innerJoin(sessionScores, eq(fitnessSnapshots.sessionScoreId, sessionScores.id))
      .where(eq(sessionScores.userId, userId))
      .orderBy(desc(fitnessSnapshots.createdAt))
      .limit(1);
    const latest = rows[0]?.fitness_snapshots;
    if (!latest) {
      return res.json(null);
    }
    res.json({
      estimatedThresholdSecPerMile: latest.estimatedThresholdSecPerMile,
      t5kSec: latest.t5kSec,
      t10kSec: latest.t10kSec,
      thalfSec: latest.thalfSec,
      tmarathonSec: latest.tmarathonSec,
      fatigueIndex: (latest.fatigueIndex ?? 0) / 100,
      fatigueState: latest.fatigueState,
      executionConsistencyIndex: (latest.executionConsistencyIndex ?? 0) / 100,
      hrStabilityIndex: (latest.hrStabilityIndex ?? 0) / 100,
      predictionConfidence: (latest.predictionConfidence ?? 0) / 100,
      fitnessTrendState: latest.fitnessTrendState,
      sessionsCount: latest.sessionsCount,
      createdAt: latest.createdAt,
    });
  } catch (e) {
    console.error("Fitness state error:", e);
    res.status(500).json({ error: "Failed to load fitness state" });
  }
});

/** POST /api/sessions/coach-review — AI narrative for session (Phase 10 stub). */
sessionsRouter.post("/coach-review", async (req, res) => {
  try {
    const body = req.body as { sessionScoreId?: number };
    if (body.sessionScoreId == null) {
      return res.status(400).json({ error: "Missing sessionScoreId" });
    }
    // Stub: real implementation will call LLM with score, work splits, fitness state.
    res.json({
      narrative:
        "Coach review will summarise your session quality, pace execution, and HR control, and suggest focus for next time. Connect an AI provider to enable.",
    });
  } catch (e) {
    console.error("Coach review error:", e);
    res.status(500).json({ error: "Failed to generate coach review" });
  }
});

/** GET /api/sessions — list session scores for trajectory (Phase 8). Includes sessionName from plan. */
sessionsRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const rows = await db
      .select({
        id: sessionScores.id,
        stravaActivityId: sessionScores.stravaActivityId,
        totalScore: sessionScores.totalScore,
        paceScore: sessionScores.paceScore,
        volumeScore: sessionScores.volumeScore,
        intensityScore: sessionScores.intensityScore,
        sessionThresholdSecPerMile: sessionScores.sessionThresholdSecPerMile,
        createdAt: sessionScores.createdAt,
        sessionName: parsedPlans.sessionName,
      })
      .from(sessionScores)
      .innerJoin(parsedPlans, eq(sessionScores.parsedPlanId, parsedPlans.id))
      .where(eq(sessionScores.userId, userId))
      .orderBy(desc(sessionScores.createdAt))
      .limit(100);
    res.json(rows);
  } catch (e) {
    console.error("Sessions list error:", e);
    res.status(500).json({ error: "Failed to load sessions" });
  }
});

/** DELETE /api/sessions/:id — remove a session score and its fitness snapshot. */
sessionsRouter.delete("/:id", async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid session id" });
    }
    const [score] = await db.select().from(sessionScores).where(and(eq(sessionScores.id, id), eq(sessionScores.userId, userId))).limit(1);
    if (!score) {
      return res.status(404).json({ error: "Session not found" });
    }
    await db.delete(fitnessSnapshots).where(eq(fitnessSnapshots.sessionScoreId, id));
    await db.delete(sessionScores).where(eq(sessionScores.id, id));
    res.status(204).send();
  } catch (e) {
    console.error("Delete session error:", e);
    res.status(500).json({ error: "Failed to remove session" });
  }
});

/** POST /api/sessions/:id/reanalyse — rerun scoring for a stored session (e.g. after analysis updates). */
sessionsRouter.post("/:id/reanalyse", async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid session id" });
    }
    const [existing] = await db.select().from(sessionScores).where(and(eq(sessionScores.id, id), eq(sessionScores.userId, userId))).limit(1);
    if (!existing) {
      return res.status(404).json({ error: "Session not found" });
    }
    const activityId = existing.stravaActivityId;
    const parsedPlanId = existing.parsedPlanId;
    let selectedLapIds: number[] | null = null;
    if (existing.selectedLapIds) {
      try {
        const parsed = JSON.parse(existing.selectedLapIds) as unknown;
        selectedLapIds = Array.isArray(parsed) ? (parsed as number[]) : null;
      } catch {
        // ignore
      }
    }

    const [plan] = await db.select().from(parsedPlans).where(and(eq(parsedPlans.id, parsedPlanId), eq(parsedPlans.userId, userId))).limit(1);
    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }
    const plannedWork = getPlannedWorkIntervals(plan.workBlocks);
    const plannedForScoring = getPlannedWorkForScoring(plan.workBlocks);
    if (plannedWork.length === 0) {
      return res.status(400).json({ error: "Plan has no work intervals" });
    }

    const { accessToken } = await getValidAccessToken(userId);
    const [laps, activity] = await Promise.all([
      getActivityLaps(activityId, accessToken),
      getActivity(activityId, accessToken),
    ]);
    const lapsForReconcile: LapForReconcile[] = laps.map((lap) => ({
      id: lap.id,
      lap_index: lap.lap_index,
      moving_time: lap.moving_time,
      elapsed_time: lap.elapsed_time,
      distance: lap.distance,
      average_speed: lap.average_speed,
    }));

    let selectedLapsInOrder: { moving_time: number; average_speed: number; average_heartrate?: number }[];
    let lapIdsForStreams: number[];
    if (Array.isArray(selectedLapIds) && selectedLapIds.length === plannedWork.length) {
      const byId = new Map(laps.map((l) => [l.id, l]));
      const fullSelected = selectedLapIds.map((lid) => byId.get(lid)).filter(Boolean);
      if (fullSelected.length !== plannedWork.length) {
        return res.status(400).json({ error: "Stored selectedLapIds did not match activity laps" });
      }
      lapIdsForStreams = selectedLapIds;
      selectedLapsInOrder = fullSelected.map((l) => ({
        moving_time: l!.moving_time,
        average_speed: l!.average_speed,
        average_heartrate: l!.average_heartrate,
      }));
    } else {
      const reconciled = reconcileReps(plannedWork, lapsForReconcile);
      if (reconciled.selectedLapsInOrder.length !== plannedWork.length) {
        return res.status(400).json({
          error: "Not enough laps to match plan; cannot reanalyse without stored lap selection.",
        });
      }
      lapIdsForStreams = reconciled.selectedLapsInOrder.map((l) => l.id);
      selectedLapsInOrder = reconciled.selectedLapsInOrder.map((l) => ({
        moving_time: l.moving_time,
        average_speed: l.average_speed,
        average_heartrate: laps.find((lap) => lap.id === l.id)?.average_heartrate,
      }));
    }

    let intensityInputs: IntensityInputs | null = null;
    let hrStreamForSession: { timeSec: number[]; heartrate: number[] } | undefined;
    let workPeriods: { startSec: number; endSec: number }[] | undefined;
    if (activity.has_heartrate) {
      try {
        const streams = await getActivityStreams(activityId, accessToken);
        const timeStream = streams.find((s) => s.type === "time");
        const hrStream = streams.find((s) => s.type === "heartrate");
        if (timeStream?.data?.length && hrStream?.data?.length) {
          const byId = new Map(laps.map((l) => [l.id, l]));
          const selectedFull = lapIdsForStreams.map((sid) => byId.get(sid)).filter(Boolean);
          const lapsInTimeOrder = ([...selectedFull] as { id: number; lap_index: number; elapsed_time: number; average_heartrate?: number }[]).sort((a, b) => a.lap_index - b.lap_index);
          intensityInputs = intensityInputsFromStreams(timeStream.data, hrStream.data, lapsInTimeOrder);
          const allLapsSorted = [...laps].sort((a, b) => a.lap_index - b.lap_index);
          const firstWorkLapIndex = allLapsSorted.findIndex((l) => l.id === lapIdsForStreams[0]);
          const offsetSec = firstWorkLapIndex <= 0 ? 0 : allLapsSorted.slice(0, firstWorkLapIndex).reduce((s, l) => s + l.elapsed_time, 0);
          workPeriods = lapsInTimeOrder.map((lap, i) => {
            const startSec = offsetSec + lapsInTimeOrder.slice(0, i).reduce((s, l) => s + l.elapsed_time, 0);
            return { startSec, endSec: startSec + lap.elapsed_time };
          });
          const maxPoints = 350;
          const timeData = timeStream.data;
          const hrData = hrStream.data;
          if (timeData.length === hrData.length && timeData.length > 0) {
            const step = timeData.length <= maxPoints ? 1 : Math.ceil(timeData.length / maxPoints);
            hrStreamForSession = {
              timeSec: timeData.filter((_: number, i: number) => i % step === 0) as number[],
              heartrate: hrData.filter((_: number, i: number) => i % step === 0) as number[],
            };
          }
        }
      } catch {
        // no HR
      }
    }

    const sessionThresholdSecPerMile = computeSessionThreshold(selectedLapsInOrder, intensityInputs);
    const scoreResult = computeSessionScore(plannedForScoring, selectedLapsInOrder, intensityInputs);
    const perRepDeviationRe = scoreResult.breakdown?.pace?.perRepDeviation ?? [];
    const workSplits = selectedLapsInOrder.map((lap, i) => {
      const planned = plannedForScoring[i];
      const paceSecPerMile = lap.average_speed > 0 ? speedToPaceSecPerMile(lap.average_speed) : 0;
      const target = planned?.targetPaceSecPerMile ?? 360;
      return {
        repIndex: i + 1,
        lapId: lapIdsForStreams[i],
        plannedDurationSec: planned?.durationSeconds ?? 0,
        actualDurationSec: lap.moving_time,
        plannedPaceSecPerMile: target,
        actualPaceSecPerMile: paceSecPerMile,
        deviationPct: (perRepDeviationRe[i] ?? 0) * 100,
      };
    });
    logScoringCalculations(plannedForScoring, selectedLapsInOrder, scoreResult, activityId);

    await db
      .update(sessionScores)
      .set({
        paceScore: scoreResult.paceScore,
        volumeScore: scoreResult.volumeScore,
        intensityScore: scoreResult.intensityScore,
        totalScore: scoreResult.totalScore,
        breakdown: JSON.stringify(scoreResult.breakdown),
        sessionThresholdSecPerMile,
      })
      .where(eq(sessionScores.id, id));

    const fatigueSignal = fatigueSignalFromSession(
      scoreResult.paceScore,
      intensityInputs?.drift_bpm ?? null,
      intensityInputs?.pct_z5_work ?? null
    );
    const [latestSnapshotRow] = await db
      .select()
      .from(fitnessSnapshots)
      .innerJoin(sessionScores, eq(fitnessSnapshots.sessionScoreId, sessionScores.id))
      .where(eq(sessionScores.userId, userId))
      .orderBy(desc(fitnessSnapshots.createdAt))
      .limit(1);
    const latestSnapshot = latestSnapshotRow?.fitness_snapshots;
    const previous = latestSnapshot
      ? {
          estimatedThresholdSecPerMile: latestSnapshot.estimatedThresholdSecPerMile,
          trendDrift: (latestSnapshot.trendDrift ?? 0) / 100,
          trendZ5: (latestSnapshot.trendZ5 ?? 0) / 100,
          trendExec: (latestSnapshot.trendExec ?? 0) / 100,
          fatigueIndex: (latestSnapshot.fatigueIndex ?? 0) / 100,
          executionConsistencyIndex: (latestSnapshot.executionConsistencyIndex ?? 0) / 100,
          hrStabilityIndex: (latestSnapshot.hrStabilityIndex ?? 0) / 100,
          sessionsCount: latestSnapshot.sessionsCount,
          t5kSec: latestSnapshot.t5kSec,
        }
      : null;
    const nextSnapshot = computeNextFitnessSnapshot({
      sessionScoreId: id,
      sessionThresholdSecPerMile,
      paceScore: scoreResult.paceScore,
      meanDeviation: scoreResult.breakdown.pace.meanDeviation,
      driftBpm: intensityInputs?.drift_bpm ?? null,
      pctZ5Work: intensityInputs?.pct_z5_work ?? null,
      fatigueSignal,
      previous,
    });
    await db.delete(fitnessSnapshots).where(eq(fitnessSnapshots.sessionScoreId, id));
    await db.insert(fitnessSnapshots).values({
      sessionScoreId: nextSnapshot.sessionScoreId,
      estimatedThresholdSecPerMile: nextSnapshot.estimatedThresholdSecPerMile,
      t5kSec: nextSnapshot.t5kSec,
      t10kSec: nextSnapshot.t10kSec,
      thalfSec: nextSnapshot.thalfSec,
      tmarathonSec: nextSnapshot.tmarathonSec,
      trendDrift: Math.round(nextSnapshot.trendDrift * 100),
      trendZ5: Math.round(nextSnapshot.trendZ5 * 100),
      trendExec: Math.round(nextSnapshot.trendExec * 100),
      fatigueIndex: Math.round(nextSnapshot.fatigueIndex * 100),
      fatigueState: nextSnapshot.fatigueState,
      executionConsistencyIndex: Math.round(nextSnapshot.executionConsistencyIndex * 100),
      hrStabilityIndex: Math.round(nextSnapshot.hrStabilityIndex * 100),
      predictionConfidence: Math.round(nextSnapshot.predictionConfidence * 100),
      fitnessTrendState: nextSnapshot.fitnessTrendState,
      sessionsCount: nextSnapshot.sessionsCount,
    });

    const fitnessStateForResponse = {
      estimatedThresholdSecPerMile: nextSnapshot.estimatedThresholdSecPerMile,
      t5kSec: nextSnapshot.t5kSec,
      t10kSec: nextSnapshot.t10kSec,
      thalfSec: nextSnapshot.thalfSec,
      tmarathonSec: nextSnapshot.tmarathonSec,
      fatigueIndex: nextSnapshot.fatigueIndex,
      fatigueState: nextSnapshot.fatigueState,
      executionConsistencyIndex: nextSnapshot.executionConsistencyIndex,
      hrStabilityIndex: nextSnapshot.hrStabilityIndex,
      predictionConfidence: nextSnapshot.predictionConfidence,
      fitnessTrendState: nextSnapshot.fitnessTrendState,
      sessionsCount: nextSnapshot.sessionsCount,
    };
    const intensityDiagnostics =
      intensityInputs != null
        ? {
            pct_z2_work: intensityInputs.pct_z2_work,
            pct_z3_work: intensityInputs.pct_z3_work,
            pct_z4_work: intensityInputs.pct_z4_work,
            pct_z5_work: intensityInputs.pct_z5_work,
            drift_bpm: intensityInputs.drift_bpm,
          }
        : undefined;
    const coachWorkSplits = workSplits.map((w) => ({
      repIndex: w.repIndex,
      plannedDurationSec: w.plannedDurationSec,
      plannedPaceSecPerMile: w.plannedPaceSecPerMile,
      actualDurationSec: w.actualDurationSec,
      actualPaceSecPerMile: w.actualPaceSecPerMile,
      deviationPct: w.deviationPct,
    }));
    const [goalRowRe] = await db
      .select()
      .from(goals)
      .where(eq(goals.userId, userId))
      .orderBy(desc(goals.createdAt))
      .limit(1);
    let raceGoalRe: { raceName: string; distance: string; goalPaceSecPerMile: number } | null = null;
    if (goalRowRe && goalRowRe.distance !== "custom") {
      try {
        raceGoalRe = {
          raceName: goalRowRe.raceName,
          distance: goalRowRe.distance,
          goalPaceSecPerMile: goalPaceSecPerMile(goalRowRe.distance as GoalDistance, goalRowRe.goalTimeSec),
        };
      } catch {
        /* skip */
      }
    }
    const coachReview = generateCoachNarrative(
      scoreResult.totalScore,
      scoreResult.paceScore,
      scoreResult.volumeScore,
      scoreResult.intensityScore,
      coachWorkSplits,
      intensityDiagnostics ?? null,
      {
        fatigueIndex: fitnessStateForResponse.fatigueIndex,
        fatigueState: fitnessStateForResponse.fatigueState,
        fitnessTrendState: fitnessStateForResponse.fitnessTrendState,
        estimatedThresholdSecPerMile: fitnessStateForResponse.estimatedThresholdSecPerMile,
        sessionsCount: fitnessStateForResponse.sessionsCount,
        predictionConfidence: fitnessStateForResponse.predictionConfidence,
      },
      { raceGoal: raceGoalRe, sessionName: plan.sessionName ?? undefined, sessionThresholdSecPerMile }
    );

    const previousFatigueRe = latestSnapshot != null && latestSnapshot.fatigueIndex != null ? (latestSnapshot.fatigueIndex as number) / 100 : 0;
    const fatigueCompRe = fatigueSignalWithComponents(
      scoreResult.paceScore,
      intensityDiagnostics?.drift_bpm ?? null,
      intensityDiagnostics?.pct_z5_work ?? null
    );
    res.json({
      sessionScoreId: id,
      totalScore: scoreResult.totalScore,
      paceScore: scoreResult.paceScore,
      volumeScore: scoreResult.volumeScore,
      intensityScore: scoreResult.intensityScore,
      breakdown: scoreResult.breakdown,
      diagnostics: scoreResult.diagnostics,
      intensityDiagnostics,
      workSplits,
      sessionThresholdSecPerMile,
      fitnessState: fitnessStateForResponse,
      coachReview,
      hrStreamForSession,
      workPeriods,
      fatigueExplanation: {
        signalFromSession: fatigueCompRe.signal,
        previousIndex: previousFatigueRe,
        driftBpm: fatigueCompRe.driftBpm,
        pctZ5Work: fatigueCompRe.pctZ5Work,
        driftNorm: fatigueCompRe.driftNorm,
        z5Norm: fatigueCompRe.z5Norm,
        execNorm: fatigueCompRe.execNorm,
      },
    });
  } catch (e) {
    if (e instanceof Error && e.message === "Not connected to Strava") {
      return res.status(401).json({ error: "Not connected to Strava" });
    }
    console.error("Reanalyse error:", e);
    res.status(500).json({ error: "Failed to reanalyse session" });
  }
});
