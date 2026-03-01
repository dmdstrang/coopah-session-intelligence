import { useState } from "react";
import { parseJson } from "./api";
import { useAuth } from "./Auth";
import type { Goal } from "./App";

const DISTANCES = ["5k", "10k", "half", "marathon", "custom"] as const;

interface GoalFormProps {
  initialGoal: Goal | null;
  onSaved: (goal: Goal) => void;
  onError: (msg: string | null) => void;
  onCancel?: () => void;
}

export function GoalForm({ initialGoal, onSaved, onError, onCancel }: GoalFormProps) {
  const auth = useAuth();
  const [raceName, setRaceName] = useState(initialGoal?.raceName ?? "");
  const [distance, setDistance] = useState(initialGoal?.distance ?? "10k");
  const [goalTime, setGoalTime] = useState(initialGoal?.goalTime ?? "00:40:00");
  const [raceDate, setRaceDate] = useState(
    initialGoal?.raceDate ?? new Date().toISOString().slice(0, 10)
  );
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    onError(null);
    setSaving(true);
    try {
      const res = await auth.apiFetch("/api/goal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raceName: raceName.trim(),
          distance,
          goalTime,
          raceDate,
        }),
      });
      const data = await parseJson<Goal | { error?: string }>(res);
      if (!res.ok) throw new Error((data && "error" in data ? data.error : null) ?? "Failed to save goal");
      if (data && "id" in data) onSaved(data as Goal);
      else onError("Server returned no data");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save goal");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 16,
        marginBottom: 24,
      }}
    >
      <h2 style={{ fontSize: "1rem", marginTop: 0, marginBottom: 16 }}>
        Race goal
      </h2>
      <label style={{ display: "block", marginBottom: 8 }}>
        <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>
          Race name
        </span>
        <input
          type="text"
          value={raceName}
          onChange={(e) => setRaceName(e.target.value)}
          placeholder="e.g. Spring 10K"
          required
          style={{
            display: "block",
            width: "100%",
            marginTop: 4,
            padding: "8px 12px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
          }}
        />
      </label>
      <label style={{ display: "block", marginBottom: 8 }}>
        <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>
          Distance
        </span>
        <select
          value={distance}
          onChange={(e) => setDistance(e.target.value)}
          style={{
            display: "block",
            width: "100%",
            marginTop: 4,
            padding: "8px 12px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
          }}
        >
          {DISTANCES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: "block", marginBottom: 8 }}>
        <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>
          Goal time (HH:MM:SS)
        </span>
        <input
          type="text"
          value={goalTime}
          onChange={(e) => setGoalTime(e.target.value)}
          placeholder="00:40:00"
          required
          style={{
            display: "block",
            width: "100%",
            marginTop: 4,
            padding: "8px 12px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
          }}
        />
      </label>
      <label style={{ display: "block", marginBottom: 16 }}>
        <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>
          Race date
        </span>
        <input
          type="date"
          value={raceDate}
          onChange={(e) => setRaceDate(e.target.value)}
          required
          style={{
            display: "block",
            width: "100%",
            marginTop: 4,
            padding: "8px 12px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
          }}
        />
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="submit"
          disabled={saving}
          style={{
            padding: "10px 20px",
            background: "var(--green)",
            border: "none",
            borderRadius: 6,
            color: "var(--bg)",
            fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save goal"}
        </button>
        {onCancel && initialGoal && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "10px 20px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
