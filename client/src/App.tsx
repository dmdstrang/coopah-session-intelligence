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

function AppContent() {
  const auth = useAuth();
  const [goal, setGoal] = useState<Goal | null>(null);
  const [parsedPlanId, setParsedPlanId] = useState<number | null>(null);
  const [lastConfirmedPlan, setLastConfirmedPlan] = useState<ConfirmedPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingGoal, setEditingGoal] = useState(false);

  // Restore session plan after redirect (e.g. from Strava OAuth) so it isn’t lost
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
        setError("Server didn’t respond. Start the backend with: npm run dev");
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

  const handleGoalSaved = (g: Goal) => {
    setGoal(g);
    setError(null);
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
    <div>
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
      {error && (
        <p style={{ color: "var(--red)", marginBottom: 16 }}>{error}</p>
      )}
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
      {goal && <PreviousResults />}
      {goal ? (
        <>
          <ScreenshotSection
            onPlanConfirmed={(id, plan) => {
              setParsedPlanId(id);
              if (plan) setLastConfirmedPlan(plan);
              if (!id) setLastConfirmedPlan(null);
              if (auth.user) saveStoredPlan(auth.user.id, id ?? null, plan ?? null);
            }}
            initialParsedPlanId={parsedPlanId}
          />
        </>
      ) : (
        <p style={{ color: "var(--text-secondary)", marginTop: 24 }}>
          Set a race goal above to continue. Analysis is blocked until you have a
          goal.
        </p>
      )}
      <StravaSection parsedPlanId={parsedPlanId} lastConfirmedPlan={lastConfirmedPlan} />
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
