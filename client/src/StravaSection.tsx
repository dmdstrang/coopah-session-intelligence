import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
  ReferenceArea,
} from "recharts";
import { parseJson } from "./api";
import { useAuth } from "./Auth";
import type { ConfirmedPlan } from "./App";

interface StravaActivity {
  id: number;
  name: string;
  type: string;
  start_date_local: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  has_heartrate?: boolean;
}

/** Lap from GET /api/strava/activities/:id (session order by lap_index). */
interface ActivityLap {
  id: number;
  lap_index: number;
  moving_time: number;
  distance: number;
  average_speed?: number;
}

interface ReconcileResult {
  mappingConfidence: number;
  requiresManualSelection: boolean;
  proposedMapping: { plannedIndex: number; lapId: number; durationOk: boolean; lap: { moving_time: number; distance: number } }[];
  selectedLapIds: number[];
}

interface WorkSplit {
  repIndex: number;
  lapId: number;
  plannedDurationSec: number;
  plannedPaceSecPerMile: number;
  actualDurationSec: number;
  actualPaceSecPerMile: number;
  deviationPct: number;
}

interface IntensityDiagnostics {
  pct_z2_work: number;
  pct_z3_work: number;
  pct_z4_work: number;
  pct_z5_work: number;
  drift_bpm: number;
}

interface FitnessStateResponse {
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
}

interface SessionListItem {
  id: number;
  stravaActivityId: number;
  totalScore: number;
  paceScore: number;
  volumeScore: number;
  intensityScore: number;
  sessionThresholdSecPerMile: number | null;
  createdAt: number;
}

export interface AnalyseResult {
  sessionScoreId?: number | null;
  totalScore: number;
  paceScore: number;
  volumeScore: number;
  intensityScore: number;
  diagnostics?: {
    volumeRatio: number;
    plannedWorkDurationSec: number;
    actualWorkDurationSec: number;
    executionMeanDeviation: number;
  };
  intensityDiagnostics?: IntensityDiagnostics;
  workSplits?: WorkSplit[];
  sessionThresholdSecPerMile?: number;
  fitnessState?: FitnessStateResponse;
  coachReview?: string;
  /** HR stream for session (downsampled). timeSec = elapsed sec, heartrate = bpm. */
  hrStreamForSession?: { timeSec: number[]; heartrate: number[] };
  /** Work rep windows in seconds (for HR chart overlay). */
  workPeriods?: { startSec: number; endSec: number }[];
  /** How fatigue was calculated (for section 7 explanation). */
  fatigueExplanation?: {
    signalFromSession: number;
    previousIndex: number;
    driftBpm: number | null;
    pctZ5Work: number | null;
    driftNorm: number;
    z5Norm: number;
    execNorm: number;
  };
}

const ACTIVITIES_INITIAL = 10;

export function StravaSection({
  parsedPlanId = null,
  lastConfirmedPlan = null,
  draftPlan = null,
  viewingAnalysis = null,
  onConsumeViewingAnalysis,
  mode,
  onBack,
  onScoreComplete,
}: {
  parsedPlanId?: number | null;
  lastConfirmedPlan?: ConfirmedPlan | null;
  draftPlan?: ConfirmedPlan | null;
  viewingAnalysis?: { result: AnalyseResult; stravaActivityId: number } | null;
  onConsumeViewingAnalysis?: () => void;
  mode?: "strava" | "analysis";
  onBack?: () => void;
  onScoreComplete?: (result: AnalyseResult, stravaActivityId: number) => void;
}) {
  // Use current draft (e.g. 5 work intervals) so rep count and API use latest plan even before re-confirm
  const effectivePlan = draftPlan ?? lastConfirmedPlan;
  const auth = useAuth();
  const analysisBlockRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [activities, setActivities] = useState<StravaActivity[]>([]);
  const [showAllActivities, setShowAllActivities] = useState(false);
  const [selectedActivityId, setSelectedActivityId] = useState<number | null>(null);
  const [activityLaps, setActivityLaps] = useState<ActivityLap[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<ReconcileResult | null>(null);
  const [manualLapIds, setManualLapIds] = useState<number[] | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analyseResult, setAnalyseResult] = useState<AnalyseResult | null>(null);
  const [sessionsList, setSessionsList] = useState<SessionListItem[]>([]);
  const [coachReview, setCoachReview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [reanalysingId, setReanalysingId] = useState<number | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await auth.apiFetch("/api/strava/status");
      const data = await parseJson<{ connected: boolean }>(res);
      setConnected(data?.connected ?? false);
      setError(null);
    } catch {
      setConnected(false);
      setError("Could not check Strava status");
    }
  };

  const fetchActivities = async () => {
    setLoadingActivities(true);
    setError(null);
    try {
      const res = await auth.apiFetch("/api/strava/activities");
      if (!res.ok) {
        if (res.status === 401) {
          setConnected(false);
          return;
        }
        throw new Error("Failed to load activities");
      }
      const data = await parseJson<StravaActivity[]>(res);
      setActivities(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load activities");
    } finally {
      setLoadingActivities(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const strava = params.get("strava");
    if (strava === "connected" || strava === "denied" || strava === "error") {
      window.history.replaceState({}, "", window.location.pathname);
      fetchStatus();
    }
  }, []);

  useEffect(() => {
    if (connected) fetchActivities();
  }, [connected]);

  useEffect(() => {
    if (!selectedActivityId || !connected) {
      setActivityLaps([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await auth.apiFetch(`/api/strava/activities/${selectedActivityId}`);
        if (!res.ok || cancelled) return;
        const data = await parseJson<{ laps?: ActivityLap[] }>(res);
        if (!cancelled && Array.isArray(data?.laps)) setActivityLaps(data.laps);
        else if (!cancelled) setActivityLaps([]);
      } catch {
        if (!cancelled) setActivityLaps([]);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedActivityId, connected]);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await auth.apiFetch("/api/sessions");
      if (!res.ok) return;
      const data = await parseJson<SessionListItem[]>(res);
      setSessionsList(Array.isArray(data) ? data : []);
    } catch {
      setSessionsList([]);
    }
  }, [auth]);

  useEffect(() => {
    if (connected) fetchSessions();
  }, [connected, fetchSessions]);

  useEffect(() => {
    if (analyseResult) fetchSessions();
  }, [analyseResult?.sessionScoreId]);

  useEffect(() => {
    if (analyseResult?.sessionScoreId == null) {
      setCoachReview(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await auth.apiFetch("/api/sessions/coach-review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionScoreId: analyseResult.sessionScoreId }),
        });
        if (!res.ok || cancelled) return;
        const data = await parseJson<{ narrative?: string }>(res);
        if (!cancelled && data?.narrative) setCoachReview(data.narrative);
      } catch {
        if (!cancelled) setCoachReview(null);
      }
    })();
    return () => { cancelled = true; };
  }, [analyseResult?.sessionScoreId]);

  const workRepCount =
    (effectivePlan?.intervals?.filter((i) => i.type === "work").length ?? 0) ||
    reconcileResult?.proposedMapping?.length ||
    0;

  const handleAnalyse = async () => {
    if (parsedPlanId == null || selectedActivityId == null) return;
    setAnalysing(true);
    setError(null);
    try {
      const body: {
        parsedPlanId: number;
        activityId: number;
        selectedLapIds?: number[];
        plan?: { sessionName?: string; intervals?: unknown[] };
      } = { parsedPlanId, activityId: selectedActivityId };
      if (effectivePlan) body.plan = { sessionName: effectivePlan.sessionName, intervals: effectivePlan.intervals };
      const lapIds = manualLapIds?.length === workRepCount ? manualLapIds : reconcileResult?.selectedLapIds;
      if (lapIds?.length) body.selectedLapIds = lapIds;
      const res = await auth.apiFetch("/api/sessions/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await parseJson<AnalyseResult & { error?: string }>(res);
      if (!res.ok) {
        setError(data?.error ?? "Analysis failed");
        return;
      }
      setAnalyseResult(data ?? null);
      if (data && selectedActivityId != null) onScoreComplete?.(data, selectedActivityId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalysing(false);
    }
  };

  const handleReconcile = async () => {
    if (parsedPlanId == null || selectedActivityId == null) return;
    setReconciling(true);
    setError(null);
    setReconcileResult(null);
    setAnalyseResult(null);
    try {
      const reconcileBody: { parsedPlanId: number; activityId: number; plan?: { sessionName?: string; intervals?: unknown[] } } = {
        parsedPlanId,
        activityId: selectedActivityId,
      };
      if (effectivePlan) reconcileBody.plan = { sessionName: effectivePlan.sessionName, intervals: effectivePlan.intervals };
      const res = await auth.apiFetch("/api/sessions/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reconcileBody),
      });
      const data = await parseJson<ReconcileResult & { error?: string }>(res);
      if (!res.ok) {
        setError(data?.error ?? "Reconcile failed");
        return;
      }
      setReconcileResult(data);
      setManualLapIds(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reconcile failed");
    } finally {
      setReconciling(false);
    }
  };

  const handleConnect = async () => {
    setError(null);
    try {
      const res = await auth.apiFetch("/api/strava/auth-url");
      const data = await parseJson<{ url?: string; error?: string }>(res);
      if (data?.url) {
        window.location.href = data.url;
      } else {
        setError(data?.error ?? "Could not get Strava login URL");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect to Strava");
    }
  };

  const handleRemoveSession = async (sessionId: number) => {
    setRemovingId(sessionId);
    setError(null);
    try {
      const res = await auth.apiFetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
      if (res.status === 204 || res.ok) {
        await fetchSessions();
        if (analyseResult?.sessionScoreId === sessionId) {
          setAnalyseResult(null);
          setCoachReview(null);
        }
      } else {
        const data = await parseJson<{ error?: string }>(res);
        setError(data?.error ?? "Failed to remove session");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove session");
    } finally {
      setRemovingId(null);
    }
  };

  // When parent (e.g. PreviousResults) passes a result to show, display it and scroll to analysis
  useEffect(() => {
    if (!viewingAnalysis) return;
    setAnalyseResult(viewingAnalysis.result);
    setCoachReview(viewingAnalysis.result.coachReview ?? null);
    setSelectedActivityId(viewingAnalysis.stravaActivityId);
    onConsumeViewingAnalysis?.();
    const t = setTimeout(() => analysisBlockRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    return () => clearTimeout(t);
  }, [viewingAnalysis, onConsumeViewingAnalysis]);

  const handleReanalyseSession = async (sessionId: number) => {
    setReanalysingId(sessionId);
    setError(null);
    try {
      const res = await auth.apiFetch(`/api/sessions/${sessionId}/reanalyse`, { method: "POST" });
      if (!res.ok) {
        const data = await parseJson<{ error?: string }>(res);
        setError(data?.error ?? "Reanalyse failed");
        return;
      }
      const data = await parseJson<AnalyseResult>(res);
      if (data) {
        setAnalyseResult(data);
        setCoachReview(data.coachReview ?? null);
        const session = sessionsList.find((s) => s.id === sessionId);
        if (session) setSelectedActivityId(session.stravaActivityId);
        await fetchSessions();
        setTimeout(() => analysisBlockRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reanalyse failed");
    } finally {
      setReanalysingId(null);
    }
  };

  const effectiveAnalyseResult = analyseResult ?? viewingAnalysis?.result;

  function BackButtonInline() {
    if (!onBack) return null;
    return (
      <button
        type="button"
        onClick={onBack}
        style={{
          marginBottom: 12,
          padding: "6px 0",
          background: "none",
          border: "none",
          color: "var(--text-secondary)",
          cursor: "pointer",
          fontSize: 14,
        }}
      >
        ← Back
      </button>
    );
  }

  // Don't block on loading: show connect UI so new users always see the button (status may be slow or fail)

  const activitiesToShow = showAllActivities ? activities : activities.slice(0, ACTIVITIES_INITIAL);
  const hasMoreActivities = activities.length > ACTIVITIES_INITIAL;

  return (
    <div style={{ background: mode === "analysis" ? "transparent" : "var(--card)", border: mode === "analysis" ? "none" : "1px solid var(--border)", borderRadius: 8, padding: mode === "analysis" ? 0 : 16, marginTop: (mode === "strava" || mode === "analysis") ? 0 : 24 }}>
      {(mode === "strava" || mode === "analysis") && onBack && <BackButtonInline />}
      {mode === "analysis" && !effectiveAnalyseResult && (
        <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>No analysis to show. Score a session or open one from Previous results.</p>
      )}
      {mode !== "analysis" && (
        <>
          <h2 style={{ fontSize: "1rem", marginTop: 0, marginBottom: 12 }}>
            Strava
          </h2>
          {error && (
            <p style={{ color: "var(--red)", marginBottom: 12, fontSize: 14 }}>
              {error}
            </p>
          )}
          {!connected ? (
        <div>
          <p style={{ color: "var(--text-secondary)", marginBottom: 12, fontSize: 14 }}>
            Connect your Strava account to select activities for session
            analysis.
          </p>
          <button
            type="button"
            onClick={handleConnect}
            style={{
              padding: "10px 20px",
              background: "#FC4C02",
              border: "none",
              borderRadius: 6,
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Connect to Strava
          </button>
        </div>
      ) : (
        <div>
          <p style={{ color: "var(--green)", marginBottom: 12, fontSize: 14 }}>
            Connected to Strava
          </p>
          {loadingActivities ? (
            <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
              Loading activities…
            </p>
          ) : activities.length === 0 ? (
            <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
              No recent activities, or they couldn’t be loaded.
            </p>
          ) : (
            <div>
              <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 8 }}>
                Tap one to select for session analysis:
              </p>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                }}
              >
                {activitiesToShow.map((a) => {
                  const isSelected = selectedActivityId === a.id;
                  return (
                    <li
                      key={a.id}
                      style={{
                        borderBottom: "1px solid var(--border)",
                        fontSize: 14,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedActivityId(isSelected ? null : a.id);
                          setReconcileResult(null);
                          setManualLapIds(null);
                          setAnalyseResult(null);
                        }}
                        style={{
                          width: "100%",
                          padding: "10px 0",
                          textAlign: "left",
                          background: isSelected ? "var(--border)" : "transparent",
                          border: "none",
                          borderLeft: isSelected ? "3px solid var(--green)" : "3px solid transparent",
                          color: "inherit",
                          cursor: "pointer",
                          fontSize: 14,
                        }}
                      >
                        <span style={{ fontWeight: 500 }}>{a.name}</span>
                        <span style={{ color: "var(--text-secondary)", marginLeft: 8 }}>
                          {a.type} · {(a.distance / 1000).toFixed(2)} km ·{" "}
                          {formatDuration(a.moving_time)}
                          {a.has_heartrate ? " · HR" : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {hasMoreActivities && !showAllActivities && (
                <button
                  type="button"
                  onClick={() => setShowAllActivities(true)}
                  style={{
                    width: "100%",
                    padding: "10px 0",
                    marginTop: 4,
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    color: "var(--text-secondary)",
                    cursor: "pointer",
                    fontSize: 14,
                  }}
                >
                  See more ({activities.length - ACTIVITIES_INITIAL} more)
                </button>
              )}
              {selectedActivityId && (
                <div style={{ marginTop: 12 }}>
                  <p style={{ color: "var(--green)", fontSize: 14, marginBottom: 8 }}>
                    Selected for analysis.
                  </p>
                  {parsedPlanId != null ? (
                    <>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={handleReconcile}
                          disabled={reconciling}
                          style={{
                            padding: "8px 16px",
                            background: "var(--green)",
                            border: "none",
                            borderRadius: 6,
                            color: "var(--bg)",
                            fontWeight: 600,
                            cursor: reconciling ? "not-allowed" : "pointer",
                            fontSize: 14,
                          }}
                        >
                          {reconciling ? "Matching laps…" : "Match laps"}
                        </button>
                      </div>
                      {reconcileResult && (
                        <>
                          <div
                            style={{
                              marginTop: 12,
                              padding: 12,
                              background: "var(--bg)",
                              border: "1px solid var(--border)",
                              borderRadius: 6,
                              fontSize: 14,
                            }}
                          >
                            <p style={{ margin: "0 0 8px 0" }}>
                              Mapping confidence: <strong>{reconcileResult.mappingConfidence}%</strong>
                              {reconcileResult.requiresManualSelection && (
                                <span style={{ color: "var(--amber)", marginLeft: 8 }}>
                                  — manual lap selection recommended
                                </span>
                              )}
                            </p>
                            <p style={{ color: "var(--text-secondary)", margin: 0, fontSize: 13 }}>
                              Matched {reconcileResult.proposedMapping.length} work rep(s) to fastest laps.
                              {reconcileResult.proposedMapping.some((m) => !m.durationOk) && (
                                <> Some lap durations outside ±15% of plan.</>
                              )}
                            </p>
                            {activityLaps.length > 0 && workRepCount > 0 && (
                              <div style={{ marginTop: 12 }}>
                                <p style={{ margin: "0 0 8px 0", fontWeight: 600, fontSize: 13 }}>
                                  Assign laps to reps (session order)
                                </p>
                                <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>
                                  Rep 1 = first work interval, Rep 2 = second, etc. Pick the lap that matches each rep.
                                </p>
                                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                                  {Array.from({ length: workRepCount }, (_, i) => {
                                    const current = (manualLapIds ?? reconcileResult.selectedLapIds)?.[i];
                                    return (
                                      <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                                        <span style={{ minWidth: 48 }}>Rep {i + 1}</span>
                                        <select
                                          value={current != null ? String(current) : ""}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            if (val === "") return;
                                            const id = Number(val);
                                            if (Number.isNaN(id)) return;
                                            setManualLapIds((prev) => {
                                              const arr = prev ?? reconcileResult?.selectedLapIds ?? [];
                                              const next = [...arr];
                                              next[i] = id;
                                              return next;
                                            });
                                          }}
                                          style={{
                                            flex: 1,
                                            maxWidth: 280,
                                            padding: "6px 8px",
                                            background: "var(--bg)",
                                            border: "1px solid var(--border)",
                                            borderRadius: 4,
                                            color: "var(--text)",
                                            fontSize: 13,
                                          }}
                                        >
                                          <option value="">—</option>
                                          {activityLaps.map((lap) => {
                                            const paceSecPerMile = lap.distance > 0 && lap.moving_time > 0
                                              ? (lap.moving_time / (lap.distance / 1609.344))
                                              : 0;
                                            const label = `Lap ${lap.lap_index + 1} — ${formatDuration(lap.moving_time)}, ${paceSecPerMile > 0 ? formatPaceSecPerMile(paceSecPerMile) : "—"}/mi`;
                                            return (
                                              <option key={lap.id} value={String(lap.id)}>
                                                {label}
                                              </option>
                                            );
                                          })}
                                        </select>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                          <div style={{ marginTop: 12 }}>
                            <button
                              type="button"
                              onClick={handleAnalyse}
                              disabled={analysing}
                              style={{
                                padding: "8px 16px",
                                background: "var(--green)",
                                border: "none",
                                borderRadius: 6,
                                color: "var(--bg)",
                                fontWeight: 600,
                                cursor: analysing ? "not-allowed" : "pointer",
                                fontSize: 14,
                              }}
                            >
                              {analysing ? "Scoring…" : "Score session"}
                            </button>
                          </div>
                        </>
                      )}
                    </>
                  ) : null}
                </div>
              )}
                </div>
              )}
                </div>
              )}
        </>
      )}
                      {effectiveAnalyseResult && (mode !== "strava") ? (
                        <div ref={analysisBlockRef} style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 16 }}>
                          {/* Block 1: Session Score */}
                          <div style={{ padding: 16, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8 }}>
                            {blockHeading("1. Session quality")}
                            <p style={{ margin: 0, fontSize: 48, fontWeight: 700, color: "var(--text)" }}>{effectiveAnalyseResult.totalScore}</p>
                            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", fontSize: 14, color: "var(--text-secondary)" }}>
                              <span>Execution {effectiveAnalyseResult.paceScore}/40</span>
                              <span>Volume {effectiveAnalyseResult.volumeScore}/20</span>
                              <span>Intensity {effectiveAnalyseResult.intensityScore}/40</span>
                            </div>
                            <div style={{ marginTop: 8, height: 8, borderRadius: 4, overflow: "hidden", display: "flex", background: "var(--border)" }}>
                              <div style={{ width: `${effectiveAnalyseResult.paceScore}%`, background: "var(--green)" }} />
                              <div style={{ width: `${effectiveAnalyseResult.volumeScore}%`, background: "var(--amber)" }} />
                              <div style={{ width: `${effectiveAnalyseResult.intensityScore}%`, background: "#6366f1" }} />
                            </div>
                            <div style={{ marginTop: 12, height: 140 }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                  data={[
                                    { name: "Execution", score: effectiveAnalyseResult.paceScore, fill: "var(--green)" },
                                    { name: "Volume", score: effectiveAnalyseResult.volumeScore, fill: "var(--amber)" },
                                    { name: "Intensity", score: effectiveAnalyseResult.intensityScore, fill: "#6366f1" },
                                  ]}
                                  margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
                                >
                                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                                  <YAxis domain={[0, 40]} tick={{ fontSize: 11, fill: "var(--text-secondary)" }} width={24} />
                                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6 }} />
                                  <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                                    {[0, 1, 2].map((i) => (
                                      <Cell key={i} fill={["var(--green)", "var(--amber)", "#6366f1"][i]} />
                                    ))}
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                            {effectiveAnalyseResult.diagnostics && (
                              <p style={{ margin: "12px 0 0 0", fontSize: 12, color: "var(--text-secondary)" }}>
                                Volume ratio: {(effectiveAnalyseResult.diagnostics.volumeRatio * 100).toFixed(1)}%. Execution mean deviation: {(effectiveAnalyseResult.diagnostics.executionMeanDeviation * 100).toFixed(2)}% (under 6% = full marks).
                              </p>
                            )}
                            {effectiveAnalyseResult.sessionThresholdSecPerMile != null && effectiveAnalyseResult.sessionThresholdSecPerMile > 0 && (
                              <p style={{ margin: "8px 0 0 0", fontSize: 12, color: "var(--text-secondary)" }}>
                                Session threshold: <strong style={{ color: "var(--text)" }}>{formatPaceSecPerMile(effectiveAnalyseResult.sessionThresholdSecPerMile)}</strong>
                              </p>
                            )}
                            <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                              <p style={{ margin: "0 0 8px 0", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>How your score was calculated</p>
                              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                                <li><strong style={{ color: "var(--green)" }}>Execution ({effectiveAnalyseResult.paceScore}/40)</strong> — Pace vs target: duration-weighted average deviation (under 6% = full marks), minus penalties for inconsistent reps and fading in the second half.</li>
                                <li><strong style={{ color: "var(--amber)" }}>Volume ({effectiveAnalyseResult.volumeScore}/20)</strong> — Actual work duration vs planned. 98–102% = full marks; outside that band the score scales down.</li>
                                <li><strong style={{ color: "#6366f1" }}>Intensity ({effectiveAnalyseResult.intensityScore}/40)</strong> — HR during work: reward for Z3+Z4 ≥70%, penalties for too much Z5, too much Z2, or HR drift first→last rep. No HR data = 0 for this part.</li>
                              </ul>
                            </div>
                          </div>

                          {/* Block 2: Coach Review */}
                          <div style={{ padding: 16, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8 }}>
                            {blockHeading("2. Coach review")}
                            <p style={{ margin: 0, fontSize: 13, color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                              {effectiveAnalyseResult.coachReview ?? coachReview ?? "Loading…"}
                            </p>
                          </div>

                          {/* Block 3: Pace Execution */}
                          {effectiveAnalyseResult.workSplits && effectiveAnalyseResult.workSplits.length > 0 && (
                            <div style={{ padding: 16, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8 }}>
                              {blockHeading("3. Pace execution")}
                              <p style={{ margin: "0 0 8px 0", fontSize: 12, color: "var(--text-secondary)" }}>Pace vs target (min/mi) by rep</p>
                              <div style={{ height: 220, marginBottom: 12 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart
                                    data={effectiveAnalyseResult.workSplits.map((s) => ({
                                      rep: `Rep ${s.repIndex}`,
                                      target: s.plannedPaceSecPerMile / 60,
                                      actual: s.actualPaceSecPerMile / 60,
                                    }))}
                                    margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
                                  >
                                    <XAxis dataKey="rep" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                                    <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} width={36} unit=" min/mi" />
                                    <Tooltip
                                      contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6 }}
                                      formatter={(value: number) => [value.toFixed(2) + " min/mi", ""]}
                                      labelFormatter={(label) => label}
                                    />
                                    <Bar dataKey="target" name="Target pace" fill="var(--text-secondary)" radius={[4, 4, 0, 0]} barSize={24} />
                                    <Bar dataKey="actual" name="Actual pace" fill="var(--green)" radius={[4, 4, 0, 0]} barSize={24} />
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                              <div style={{ overflowX: "auto", fontSize: 12 }}>
                                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                  <thead>
                                    <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                                      <th style={{ textAlign: "left", padding: "4px 8px 4px 0" }}>Rep</th>
                                      <th style={{ textAlign: "left", padding: "4px 8px" }}>Planned</th>
                                      <th style={{ textAlign: "left", padding: "4px 8px" }}>Actual</th>
                                      <th style={{ textAlign: "right", padding: "4px 0 4px 8px" }}>Deviation</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {effectiveAnalyseResult.workSplits.map((s) => (
                                      <tr key={s.repIndex} style={{ borderBottom: "1px solid var(--border)" }}>
                                        <td style={{ padding: "6px 8px 6px 0" }}>Rep {s.repIndex}</td>
                                        <td style={{ padding: "6px 8px" }}>{formatDuration(s.plannedDurationSec)} @ {formatPaceSecPerMile(s.plannedPaceSecPerMile)}</td>
                                        <td style={{ padding: "6px 8px" }}>{formatDuration(s.actualDurationSec)} @ {formatPaceSecPerMile(s.actualPaceSecPerMile)}</td>
                                        <td style={{ padding: "6px 0 6px 8px", textAlign: "right" }}>{s.deviationPct.toFixed(2)}%</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Block 4: HR Profile */}
                          <div style={{ padding: 16, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8 }}>
                            {blockHeading("4. HR profile")}
                            {effectiveAnalyseResult.hrStreamForSession && effectiveAnalyseResult.hrStreamForSession.timeSec.length > 0 ? (
                              <>
                                <p style={{ margin: "0 0 8px 0", fontSize: 12, color: "var(--text-secondary)" }}>Heart rate across the session (shaded = work intervals)</p>
                                <div style={{ height: 200, marginBottom: 12 }}>
                                  <ResponsiveContainer width="100%" height="100%">
                                    <LineChart
                                      data={effectiveAnalyseResult.hrStreamForSession.timeSec.map((t, i) => ({
                                        min: Math.round(t / 60 * 10) / 10,
                                        bpm: effectiveAnalyseResult.hrStreamForSession!.heartrate[i],
                                      }))}
                                      margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
                                    >
                                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                                      {effectiveAnalyseResult.workPeriods?.map((wp, i) => (
                                        <ReferenceArea
                                          key={i}
                                          x1={Math.round((wp.startSec / 60) * 10) / 10}
                                          x2={Math.round((wp.endSec / 60) * 10) / 10}
                                          fill="var(--green)"
                                          fillOpacity={0.25}
                                        />
                                      ))}
                                      <XAxis dataKey="min" tick={{ fontSize: 10, fill: "var(--text-secondary)" }} unit=" min" />
                                      <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} width={32} unit=" bpm" />
                                      <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6 }} formatter={(v: number) => [v, "HR"]} labelFormatter={(min) => `${min} min`} />
                                      <Line type="monotone" dataKey="bpm" stroke="#ef4444" strokeWidth={1.5} dot={false} name="HR" />
                                    </LineChart>
                                  </ResponsiveContainer>
                                </div>
                                <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>
                                  {effectiveAnalyseResult.intensityDiagnostics ? (
                                    <>Work zones: {formatPct(effectiveAnalyseResult.intensityDiagnostics.pct_z2_work)} Z2, {formatPct(effectiveAnalyseResult.intensityDiagnostics.pct_z3_work)} Z3, {formatPct(effectiveAnalyseResult.intensityDiagnostics.pct_z4_work)} Z4, {formatPct(effectiveAnalyseResult.intensityDiagnostics.pct_z5_work)} Z5. Drift first→last rep: {effectiveAnalyseResult.intensityDiagnostics.drift_bpm >= 0 ? "+" : ""}{effectiveAnalyseResult.intensityDiagnostics.drift_bpm.toFixed(0)} bpm.</>
                                  ) : null}
                                </p>
                              </>
                            ) : (
                              <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>
                                {effectiveAnalyseResult.intensityDiagnostics ? (
                                  <>Your work was {formatPct(effectiveAnalyseResult.intensityDiagnostics.pct_z2_work)} Z2, {formatPct(effectiveAnalyseResult.intensityDiagnostics.pct_z3_work)} Z3, {formatPct(effectiveAnalyseResult.intensityDiagnostics.pct_z4_work)} Z4, {formatPct(effectiveAnalyseResult.intensityDiagnostics.pct_z5_work)} Z5. HR drifted {effectiveAnalyseResult.intensityDiagnostics.drift_bpm >= 0 ? "+" : ""}{effectiveAnalyseResult.intensityDiagnostics.drift_bpm.toFixed(0)} bpm first→last rep.</>
                                ) : (
                                  <>No HR data for this activity. Intensity score not included.</>
                                )}
                              </p>
                            )}
                          </div>

                          {/* Block 5: Trajectory */}
                          {sessionsList.length > 0 && (
                            <div style={{ padding: 16, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8 }}>
                              {blockHeading("5. Trajectory")}
                              <div style={{ height: 200, marginBottom: 8 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                  <LineChart
                                    data={[...sessionsList.slice(0, 15)].reverse().map((s) => ({
                                      score: s.totalScore,
                                      date: new Date(s.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                                    }))}
                                    margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
                                  >
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text-secondary)" }} />
                                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--text-secondary)" }} width={28} />
                                    <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6 }} />
                                    <Line type="monotone" dataKey="score" stroke="var(--green)" strokeWidth={2} dot={{ fill: "var(--green)", r: 3 }} name="Score" />
                                  </LineChart>
                                </ResponsiveContainer>
                              </div>
                              <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>Recent sessions (newest right):</p>
                              <ul style={{ margin: "8px 0 0 0", paddingLeft: 20, fontSize: 13, listStyle: "none" }}>
                                {sessionsList.slice(0, 10).map((s) => (
                                  <li key={s.id} style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                    <span>Score <strong>{s.totalScore}</strong> — {new Date(s.createdAt).toLocaleDateString()}</span>
                                    <span style={{ display: "flex", gap: 6 }}>
                                      <button
                                        type="button"
                                        onClick={() => handleReanalyseSession(s.id)}
                                        disabled={reanalysingId !== null}
                                        style={{
                                          padding: "4px 8px",
                                          fontSize: 12,
                                          background: "var(--bg)",
                                          border: "1px solid var(--border)",
                                          borderRadius: 4,
                                          color: "var(--text)",
                                          cursor: reanalysingId !== null ? "not-allowed" : "pointer",
                                        }}
                                      >
                                        {reanalysingId === s.id ? "…" : "Re-run"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveSession(s.id)}
                                        disabled={removingId !== null}
                                        style={{
                                          padding: "4px 8px",
                                          fontSize: 12,
                                          background: "var(--bg)",
                                          border: "1px solid var(--red)",
                                          borderRadius: 4,
                                          color: "var(--red)",
                                          cursor: removingId !== null ? "not-allowed" : "pointer",
                                        }}
                                      >
                                        {removingId === s.id ? "…" : "Remove"}
                                      </button>
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Block 6: Current Fitness */}
                          {effectiveAnalyseResult.fitnessState && (
                            <div style={{ padding: 16, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8 }}>
                              {blockHeading("6. Current fitness")}
                              <p style={{ margin: "0 0 12px 0", fontSize: 13 }}>
                                Threshold: <strong>{formatPaceSecPerMile(effectiveAnalyseResult.fitnessState.estimatedThresholdSecPerMile)}</strong>
                                <span style={{ marginLeft: 12, color: "var(--text-secondary)", fontWeight: 400 }}>
                                  {(effectiveAnalyseResult.fitnessState.predictionConfidence * 100).toFixed(0)}% confidence · {effectiveAnalyseResult.fitnessState.sessionsCount} session{effectiveAnalyseResult.fitnessState.sessionsCount !== 1 ? "s" : ""} · {effectiveAnalyseResult.fitnessState.fitnessTrendState}
                                </span>
                              </p>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 12 }}>
                                {[
                                  { label: "5K", sec: effectiveAnalyseResult.fitnessState.t5kSec },
                                  { label: "10K", sec: effectiveAnalyseResult.fitnessState.t10kSec },
                                  { label: "Half", sec: effectiveAnalyseResult.fitnessState.thalfSec },
                                  { label: "Marathon", sec: effectiveAnalyseResult.fitnessState.tmarathonSec },
                                ].map(({ label, sec }) => (
                                  <div
                                    key={label}
                                    style={{
                                      padding: "16px 12px",
                                      background: "var(--card)",
                                      border: "1px solid var(--border)",
                                      borderRadius: 8,
                                      textAlign: "center",
                                    }}
                                  >
                                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>{label}</div>
                                    <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{formatTime(sec)}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Block 7: Fitness Impact — fatigue with personalised explanation */}
                          {effectiveAnalyseResult.fitnessState && (
                            <div style={{ padding: 16, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8 }}>
                              {blockHeading("7. Fitness impact")}
                              <p style={{ margin: 0, fontSize: 14 }}>
                                Fatigue: <strong>{(effectiveAnalyseResult.fitnessState.fatigueIndex * 100).toFixed(0)}%</strong> — {effectiveAnalyseResult.fitnessState.fatigueState}
                              </p>
                              <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "var(--text-secondary)" }}>
                                Bands: 0–30% Low, 31–55% Stable, 56–75% Building, 76–100% High.
                              </p>
                              {effectiveAnalyseResult.fatigueExplanation && (
                                <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                                  <p style={{ margin: "0 0 8px 0", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>How your fatigue was calculated</p>
                                  <p style={{ margin: 0, fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
                                    This session contributed <strong>{((effectiveAnalyseResult.fatigueExplanation.signalFromSession) * 100).toFixed(0)}%</strong> to your fatigue signal, from three parts (blended 35% / 25% / 40%):
                                  </p>
                                  <ul style={{ margin: "8px 0 0 0", paddingLeft: 20, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                                    <li><strong>HR drift</strong> — first rep vs last rep: {effectiveAnalyseResult.fatigueExplanation.driftBpm != null ? `${effectiveAnalyseResult.fatigueExplanation.driftBpm >= 0 ? "+" : ""}${effectiveAnalyseResult.fatigueExplanation.driftBpm.toFixed(0)} bpm` : "no HR"} ({(effectiveAnalyseResult.fatigueExplanation.driftNorm * 100).toFixed(0)}% of this session’s signal).</li>
                                    <li><strong>Time in Z5</strong> — {effectiveAnalyseResult.fatigueExplanation.pctZ5Work != null ? `${(effectiveAnalyseResult.fatigueExplanation.pctZ5Work * 100).toFixed(1)}%` : "no HR"} of work above threshold ({(effectiveAnalyseResult.fatigueExplanation.z5Norm * 100).toFixed(0)}% of signal).</li>
                                    <li><strong>Execution shortfall</strong> — pace score {effectiveAnalyseResult.paceScore}/40 ({(effectiveAnalyseResult.fatigueExplanation.execNorm * 100).toFixed(0)}% of signal).</li>
                                  </ul>
                                  <p style={{ margin: "8px 0 0 0", fontSize: 12, color: "var(--text-secondary)" }}>
                                    Your running fatigue index is smoothed: 75% previous ({(effectiveAnalyseResult.fatigueExplanation.previousIndex * 100).toFixed(0)}%) + 25% this session → <strong>{(effectiveAnalyseResult.fitnessState.fatigueIndex * 100).toFixed(0)}%</strong>.
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : mode !== "analysis" ? (
                    <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: 0 }}>
                      Confirm a session plan above (screenshots) to match laps and run analysis.
                    </p>
                  ) : null}
    </div>
  );
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatPaceSecPerMile(secPerMile: number): string {
  if (secPerMile <= 0 || secPerMile >= 9999) return "—";
  const m = Math.floor(secPerMile / 60);
  const s = Math.floor(secPerMile % 60);
  return `${m}:${s.toString().padStart(2, "0")}/mi`;
}

function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${(m % 60).toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function blockHeading(title: string) {
  return (
    <p style={{ margin: "0 0 8px 0", fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>
      {title}
    </p>
  );
}
