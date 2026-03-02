import { useEffect, useState } from "react";
import { parseJson } from "./api";
import { AuthProvider, useAuth } from "./Auth";
import { LoginForm } from "./LoginForm";
import { GoalForm } from "./GoalForm";
import { GoalDisplay } from "./GoalDisplay";
import { PreviousResults } from "./PreviousResults";
import { ScreenshotSection } from "./ScreenshotSection";
import { StravaSection } from "./StravaSection";
import type { Interval } from "./ScreenshotSection";

export type AppScreen = "home" | "plan" | "strava" | "analysis";

/** Analysis result + activity id, used when showing a session from PreviousResults (Re-run or View). */
export type ViewingAnalysis = { result: import("./StravaSection").AnalyseResult; stravaActivityId: number };

export interface Goal {
  id: number;
  raceName: string;
  distance: string;
  goalTime: string;
  goalPaceSecPerMile: number;
  raceDate: string;
  weeksRemaining: number;
}

export interface ConfirmedPlan {
  sessionName: string;
  intervals: Interval[];
}

const PLAN_STORAGE_KEY = "coopah_session_plan";

function loadStoredPlan(userId: number): { parsedPlanId: number; plan: ConfirmedPlan } | null {
  try {
    const raw = localStorage.getItem(`${PLAN_STORAGE_KEY}_${userId}`);
    if (!raw) return null;
    const data = JSON.parse(raw) as { parsedPlanId?: number; sessionName?: string; intervals?: Interval[] };
    if (typeof data?.parsedPlanId !== "number" || !Array.isArray(data?.intervals)) return null;
    return {
      parsedPlanId: data.parsedPlanId,
      plan: { sessionName: data.sessionName ?? "Session", intervals: data.intervals },
    };
  } catch {
    return null;
  }
}

function saveStoredPlan(userId: number, parsedPlanId: number | null, plan: ConfirmedPlan | null): void {
  const key = `${PLAN_STORAGE_KEY}_${userId}`;
  if (parsedPlanId == null || !plan) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, JSON.stringify({ parsedPlanId, sessionName: plan.sessionName, intervals: plan.intervals }));
}

function BackButton({ onBack }: { onBack: () => void }) {
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
        display: "flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      ← Back
    </button>
  );
}

function AppContent() {
  const auth = useAuth();
  const [goal, setGoal] = useState<Goal | null>(null);
  const [parsedPlanId, setParsedPlanId] = useState<number | null>(null);
  const [lastConfirmedPlan, setLastConfirmedPlan] = useState<ConfirmedPlan | null>(null);
  const [draftPlan, setDraftPlan] = useState<ConfirmedPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingGoal, setEditingGoal] = useState(false);
  const [screen, setScreen] = useState<AppScreen>("home");
  const [viewingAnalysis, setViewingAnalysis] = useState<ViewingAnalysis | null>(null);
  const [stravaConnected, setStravaConnected] = useState<boolean | null>(null);

  // Restore session plan after redirect (e.g. from Strava OAuth) so it isn't lost
  useEffect(() => {
    if (!auth.user) return;
    const stored = loadStoredPlan(auth.user.id);
    if (stored) {
      setParsedPlanId(stored.parsedPlanId);
      setLastConfirmedPlan(stored.plan);
    }
  }, [auth.user?.id]);

  const fetchGoal = async () => {
    setLoading(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await auth.apiFetch("/api/goal", { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error("Failed to load goal");
      const data = await parseJson<Goal | null>(res);
      setGoal(data ?? null);
    } catch (e) {
      setGoal(null);
      if (e instanceof Error && e.name === "AbortError") {
        setError("Server didn't respond. Start the backend with: npm run dev");
      } else {
        setError(e instanceof Error ? e.message : "Error loading goal");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (auth.user) fetchGoal();
    else setLoading(false);
  }, [auth.user?.id]);

  const fetchStravaStatus = async () => {
    try {
      const res = await auth.apiFetch("/api/strava/status");
      const data = await parseJson<{ connected: boolean }>(res);
      setStravaConnected(data?.connected ?? false);
    } catch {
      setStravaConnected(false);
    }
  };

  useEffect(() => {
    if (auth.user && screen === "home") fetchStravaStatus();
  }, [auth.user?.id, screen]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const strava = params.get("strava");
    if (strava === "connected" || strava === "denied" || strava === "error") {
      window.history.replaceState({}, "", window.location.pathname);
      fetchStravaStatus();
    }
  }, []);

  const handleGoalSaved = (g: Goal) => {
    setGoal(g);
    setError(null);
  };

  const goHome = () => setScreen("home");

  const handleShowAnalysis = (result: ViewingAnalysis["result"], stravaActivityId: number) => {
    setViewingAnalysis({ result, stravaActivityId });
    setScreen("analysis");
  };

  if (auth.loading) {
    return (
      <div style={{ color: "var(--text-secondary)", padding: "24px 0" }}>
        Loading…
      </div>
    );
  }

  if (!auth.user) {
    return <LoginForm />;
  }

  if (loading) {
    return (
      <div style={{ color: "var(--text-secondary)", padding: "24px 0" }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", paddingBottom: 24 }}>
      {/* Header: only on home or when not full-screen flow */}
      {(screen === "home" || screen === "plan") && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
          <h1 style={{ fontSize: "1.25rem", margin: 0 }}>
            Coopah Session Intelligence
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>
              {auth.user.displayName || auth.user.email}
            </span>
            <button
              type="button"
              onClick={() => auth.logout()}
              style={{
                padding: "6px 12px",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text-secondary)",
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              Log out
            </button>
          </div>
        </div>
      )}

      {error && (
        <p style={{ color: "var(--red)", marginBottom: 16 }}>{error}</p>
      )}

      {/* Screen 1: Home */}
      {screen === "home" && (
        <>
          {goal && !editingGoal ? (
            <GoalDisplay goal={goal} onEdit={() => setEditingGoal(true)} />
          ) : (
            <GoalForm
              initialGoal={goal}
              onSaved={handleGoalSaved}
              onError={setError}
              onCancel={() => setEditingGoal(false)}
            />
          )}
          {goal && (
            <>
              <div style={{ marginTop: 24, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: 16 }}>
                <h2 style={{ fontSize: "1rem", marginTop: 0, marginBottom: 8 }}>Strava</h2>
                {stravaConnected === null ? (
                  <p style={{ margin: 0, fontSize: 14, color: "var(--text-secondary)" }}>Checking…</p>
                ) : stravaConnected ? (
                  <p style={{ margin: 0, fontSize: 14, color: "var(--green)" }}>Connected to Strava</p>
                ) : (
                  <>
                    <p style={{ margin: "0 0 12px 0", fontSize: 14, color: "var(--text-secondary)" }}>
                      Connect your Strava account to score sessions.
                    </p>
                    <button
                      type="button"
                      onClick={() => setScreen("strava")}
                      style={{
                        padding: "10px 20px",
                        background: "#FC4C02",
                        border: "none",
                        borderRadius: 6,
                        color: "#fff",
                        fontWeight: 600,
                        cursor: "pointer",
                        fontSize: 14,
                      }}
                    >
                      Connect to Strava
                    </button>
                  </>
                )}
              </div>
              <PreviousResults onShowAnalysis={handleShowAnalysis} />
              <div style={{ marginTop: 24 }}>
                <button
                  type="button"
                  onClick={() => setScreen("plan")}
                  style={{
                    width: "100%",
                    padding: "18px 24px",
                    background: "var(--green)",
                    border: "none",
                    borderRadius: 12,
                    color: "var(--bg)",
                    fontWeight: 700,
                    fontSize: 18,
                    cursor: "pointer",
                  }}
                >
                  Score my session
                </button>
              </div>
            </>
          )}
          {!goal && (
            <p style={{ color: "var(--text-secondary)", marginTop: 24 }}>
              Set a race goal above to continue.
            </p>
          )}
        </>
      )}

      {/* Screen 2: Add plan (manual or screenshot) */}
      {screen === "plan" && (
        <>
          <BackButton onBack={goHome} />
          <ScreenshotSection
            onPlanConfirmed={(id, plan) => {
              setParsedPlanId(id);
              if (plan) setLastConfirmedPlan(plan);
              if (!id) setLastConfirmedPlan(null);
              if (auth.user) saveStoredPlan(auth.user.id, id ?? null, plan ?? null);
            }}
            onDraftChange={setDraftPlan}
            initialParsedPlanId={parsedPlanId}
            onGoToSelectActivity={() => setScreen("strava")}
            hasConfirmedPlan={parsedPlanId != null}
          />
        </>
      )}

      {/* Screen 3: Select Strava activity */}
      {screen === "strava" && (
        <StravaSection
          parsedPlanId={parsedPlanId}
          lastConfirmedPlan={lastConfirmedPlan}
          draftPlan={draftPlan}
          viewingAnalysis={null}
          onConsumeViewingAnalysis={() => {}}
          mode="strava"
          onBack={goHome}
          onScoreComplete={(result, stravaActivityId) => {
            setViewingAnalysis({ result, stravaActivityId });
            setScreen("analysis");
          }}
        />
      )}

      {/* Screen 4: Analysis (scrollable) */}
      {screen === "analysis" && (
        <StravaSection
          parsedPlanId={parsedPlanId}
          lastConfirmedPlan={lastConfirmedPlan}
          draftPlan={draftPlan}
          viewingAnalysis={viewingAnalysis}
          onConsumeViewingAnalysis={() => setViewingAnalysis(null)}
          mode="analysis"
          onBack={goHome}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
