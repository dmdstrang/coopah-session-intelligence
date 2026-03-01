import { useCallback, useEffect, useState } from "react";
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

interface AnalyseResult {
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
}

export function StravaSection({
  parsedPlanId = null,
  lastConfirmedPlan = null,
}: {
  parsedPlanId?: number | null;
  lastConfirmedPlan?: ConfirmedPlan | null;
}) {
  const auth = useAuth();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [activities, setActivities] = useState<StravaActivity[]>([]);
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
    (lastConfirmedPlan?.intervals?.filter((i) => i.type === "work").length ?? 0) ||
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
      if (lastConfirmedPlan) body.plan = { sessionName: lastConfirmedPlan.sessionName, intervals: lastConfirmedPlan.intervals };
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
      setAnalyseResult(data);
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
      if (lastConfirmedPlan) reconcileBody.plan = { sessionName: lastConfirmedPlan.sessionName, intervals: lastConfirmedPlan.intervals };
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
        await fetchSessions();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reanalyse failed");
    } finally {
      setReanalysingId(null);
    }
  };

  if (connected === null) {
    return (
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 16,
          marginTop: 24,
        }}
      >
        <p style={{ color: "var(--text-secondary)", margin: 0 }}>
          Checking Strava…
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 16,
        marginTop: 24,
      }}
    >
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
                Last 30 activities — tap one to select for session analysis:
              </p>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                }}
              >
                {activities.map((a) => {
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
                      {analyseResult && (
                        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 16 }}>
                          {/* Block 1: Session Score */}
                          <div style={{ padding: 16, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8 }}>
                            {blockHeading("1. Session quality")}
                            <p style={{ margin: 0, fontSize: 48, fontWeight: 700, color: "var(--text)" }}>{analyseResult.totalScore}</p>
                            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", fontSize: 14, color: "var(--text-secondary)" }}>
                              <span>Execution {analyseResult.paceScore}/40</span>
                              <span>Volume {analyseResult.volumeScore}/20</span>
                              <span>Intensity {analyseResult.intensityScore}/40</span>
                            </div>
                            <div style={{ marginTop: 8, height: 8, borderRadius: 4, overflow: "hidden", display: "flex", background: "var(--border)" }}>
                              <div style={{ width: `${analyseResult.paceScore}%`, background: "var(--green)" }} />
                              <div style={{ width: `${analyseResult.volumeScore}%`, background: "var(--amber)" }} />
                              <div style={{ width: `${analyseResult.intensityScore}%`, background: "#6366f1" }} />
                            </div>
                            <div style={{ marginTop: 12, height: 140 }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                  data={[
                                    { name: "Execution", score: analyseResult.paceScore, fill: "var(--green)" },
                                    { name: "Volume", score: analyseResult.volumeScore, fill: "var(--amber)" },
                                    { name: "Intensity", score: analyseResult.intensityScore, fill: "#6366f1" },
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
                            {analyseResult.diagnostics && (
                              <p style={{ margin: "12px 0 0 0", fontSize: 12, color: "var(--text-secondary)" }}>
                                Volume ratio: {(analyseResult.diagnostics.volumeRatio * 100).toFixed(1)}%. Execution mean deviation: {(analyseResult.diagnostics.executionMeanDeviation * 100).toFixed(2)}% (under 6% = full marks).
                              </p>
                            )}
                            {analyseResult.sessionThresholdSecPerMile != null && analyseResult.sessionThresholdSecPerMile > 0 && (
                              <p style={{ margin: "8px 0 0 0", fontSize: 12, color: "var(--text-secondary)" }}>
                                Session threshold: <strong style={{ color: "var(--text)" }}>{formatPaceSecPerMile(analyseResult.sessionThresholdSecPerMile)}</strong>
                              </p>
                            )}
                          </div>

                          {/* Block 2: Fitness Impact */}
                          {analyseResult.fitnessState && (
                            <div style={{ padding: 16, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8 }}>
                              {blockHeading("2. Fitness impact")}
                              <p style={{ margin: 0, fontSize: 14 }}>
                                Fatigue: <strong>{(analyseResult.fitnessState.fatigueIndex * 100).toFixed(0)}%</strong> — {analyseResult.fitnessState.fatigueState}
                              </p>
                              <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "var(--text-secondary)" }}>
                                Bands: 0–30% Low, 31–55% Stable, 56–75% Building, 76–100% High.
                              </p>
                            </div>
                          )}

                          {/* Block 3: Pace Execution */}
                          {analyseResult.workSplits && analyseResult.workSplits.length > 0 && (
                            <div style={{ padding: 16, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8 }}>
                              {blockHeading("3. Pace execution")}
                              <p style={{ margin: "0 0 8px 0", fontSize: 12, color: "var(--text-secondary)" }}>Pace vs target (min/mi) by rep</p>
                              <div style={{ height: 220, marginBottom: 12 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart
                                    data={analyseResult.workSplits.map((s) => ({
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
                                    {analyseResult.workSplits.map((s) => (
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
                            {analyseResult.hrStreamForSession && analyseResult.hrStreamForSession.timeSec.length > 0 ? (
                              <>
                                <p style={{ margin: "0 0 8px 0", fontSize: 12, color: "var(--text-secondary)" }}>Heart rate across the session</p>
                                <div style={{ height: 200, marginBottom: 12 }}>
                                  <ResponsiveContainer width="100%" height="100%">
                                    <LineChart
                                      data={analyseResult.hrStreamForSession.timeSec.map((t, i) => ({
                                        min: Math.round(t / 60 * 10) / 10,
                                        bpm: analyseResult.hrStreamForSession!.heartrate[i],
                                      }))}
                                      margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
                                    >
                                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                                      <XAxis dataKey="min" tick={{ fontSize: 10, fill: "var(--text-secondary)" }} unit=" min" />
                                      <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} width={32} unit=" bpm" />
                                      <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6 }} formatter={(v: number) => [v, "HR"]} labelFormatter={(min) => `${min} min`} />
                                      <Line type="monotone" dataKey="bpm" stroke="#ef4444" strokeWidth={1.5} dot={false} name="HR" />
                                    </LineChart>
                                  </ResponsiveContainer>
                                </div>
                                <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>
                                  {analyseResult.intensityDiagnostics ? (
                                    <>Work zones: {formatPct(analyseResult.intensityDiagnostics.pct_z2_work)} Z2, {formatPct(analyseResult.intensityDiagnostics.pct_z3_work)} Z3, {formatPct(analyseResult.intensityDiagnostics.pct_z4_work)} Z4, {formatPct(analyseResult.intensityDiagnostics.pct_z5_work)} Z5. Drift first→last rep: {analyseResult.intensityDiagnostics.drift_bpm >= 0 ? "+" : ""}{analyseResult.intensityDiagnostics.drift_bpm.toFixed(0)} bpm.</>
                                  ) : null}
                                </p>
                              </>
                            ) : (
                              <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>
                                {analyseResult.intensityDiagnostics ? (
                                  <>Your work was {formatPct(analyseResult.intensityDiagnostics.pct_z2_work)} Z2, {formatPct(analyseResult.intensityDiagnostics.pct_z3_work)} Z3, {formatPct(analyseResult.intensityDiagnostics.pct_z4_work)} Z4, {formatPct(analyseResult.intensityDiagnostics.pct_z5_work)} Z5. HR drifted {analyseResult.intensityDiagnostics.drift_bpm >= 0 ? "+" : ""}{analyseResult.intensityDiagnostics.drift_bpm.toFixed(0)} bpm first→last rep.</>
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
                          {analyseResult.fitnessState && (
                            <div style={{ padding: 16, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8 }}>
                              {blockHeading("6. Current fitness")}
                              <p style={{ margin: 0, fontSize: 13 }}>
                                Estimated threshold: <strong>{formatPaceSecPerMile(analyseResult.fitnessState.estimatedThresholdSecPerMile)}</strong>
                              </p>
                              <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "var(--text-secondary)" }}>
                                Predicted: 5K {formatTime(analyseResult.fitnessState.t5kSec)} · 10K {formatTime(analyseResult.fitnessState.t10kSec)} · Half {formatTime(analyseResult.fitnessState.thalfSec)} · Marathon {formatTime(analyseResult.fitnessState.tmarathonSec)}
                              </p>
                              <p style={{ margin: "4px 0 0 0", fontSize: 12 }}>
                                Confidence {(analyseResult.fitnessState.predictionConfidence * 100).toFixed(0)}% · Trend: {analyseResult.fitnessState.fitnessTrendState} · {analyseResult.fitnessState.sessionsCount} session{analyseResult.fitnessState.sessionsCount !== 1 ? "s" : ""}
                              </p>
                            </div>
                          )}

                          {/* Block 7: Coach Review */}
                          <div style={{ padding: 16, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8 }}>
                            {blockHeading("7. Coach review")}
                            <p style={{ margin: 0, fontSize: 13, color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                              {analyseResult.coachReview ?? coachReview ?? "Loading…"}
                            </p>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: 0 }}>
                      Confirm a session plan above (screenshots) to match laps and run analysis.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
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
