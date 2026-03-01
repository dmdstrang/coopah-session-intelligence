import { useCallback, useEffect, useState } from "react";
import { parseJson } from "./api";
import { useAuth } from "./Auth";

interface SessionListItem {
  id: number;
  stravaActivityId: number;
  totalScore: number;
  paceScore: number;
  volumeScore: number;
  intensityScore: number;
  sessionThresholdSecPerMile: number | null;
  createdAt: number;
  sessionName?: string | null;
}

export function PreviousResults() {
  const auth = useAuth();
  const [sessionsList, setSessionsList] = useState<SessionListItem[]>([]);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [reanalysingId, setReanalysingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    fetchSessions();
  }, [fetchSessions]);

  const handleRemove = async (sessionId: number) => {
    setRemovingId(sessionId);
    setError(null);
    try {
      const res = await auth.apiFetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
      if (res.status === 204 || res.ok) await fetchSessions();
      else {
        const data = await parseJson<{ error?: string }>(res);
        setError(data?.error ?? "Failed to remove session");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove session");
    } finally {
      setRemovingId(null);
    }
  };

  const handleReanalyse = async (sessionId: number) => {
    setReanalysingId(sessionId);
    setError(null);
    try {
      const res = await auth.apiFetch(`/api/sessions/${sessionId}/reanalyse`, { method: "POST" });
      if (!res.ok) {
        const data = await parseJson<{ error?: string }>(res);
        setError(data?.error ?? "Re-run failed");
        return;
      }
      await fetchSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-run failed");
    } finally {
      setReanalysingId(null);
    }
  };

  if (sessionsList.length === 0) return null;

  return (
    <div
      style={{
        marginTop: 24,
        padding: 16,
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}
    >
      <h2 style={{ fontSize: "1rem", marginTop: 0, marginBottom: 8 }}>Previous results</h2>
      <p style={{ margin: "0 0 12px 0", fontSize: 12, color: "var(--text-secondary)" }}>
        Re-run to get updated results with latest scoring, or remove sessions you don’t need.
      </p>
      {error && (
        <p style={{ color: "var(--red)", fontSize: 14, marginBottom: 8 }}>{error}</p>
      )}
      <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 14 }}>
        {sessionsList.slice(0, 20).map((s) => (
          <li
            key={s.id}
            style={{
              marginBottom: 8,
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              borderBottom: "1px solid var(--border)",
              paddingBottom: 8,
            }}
          >
            <span style={{ flex: "1 1 200px" }}>
              <strong>{s.sessionName?.trim() || "Session"}</strong>
              {" · "}
              {new Date(s.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
              {" · "}
              Score <strong>{s.totalScore}</strong>
            </span>
            <span style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={() => handleReanalyse(s.id)}
                disabled={reanalysingId !== null}
                style={{
                  padding: "4px 10px",
                  fontSize: 13,
                  background: "var(--green)",
                  border: "none",
                  borderRadius: 6,
                  color: "var(--bg)",
                  fontWeight: 600,
                  cursor: reanalysingId !== null ? "not-allowed" : "pointer",
                }}
              >
                {reanalysingId === s.id ? "…" : "Re-run"}
              </button>
              <button
                type="button"
                onClick={() => handleRemove(s.id)}
                disabled={removingId !== null}
                style={{
                  padding: "4px 10px",
                  fontSize: 13,
                  background: "var(--bg)",
                  border: "1px solid var(--red)",
                  borderRadius: 6,
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
  );
}
