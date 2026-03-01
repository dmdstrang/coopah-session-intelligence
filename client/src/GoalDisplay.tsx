import type { Goal } from "./App";

function paceToMinPerMile(secPerMile: number): string {
  const min = Math.floor(secPerMile / 60);
  const sec = Math.round(secPerMile % 60);
  return `${min}:${sec.toString().padStart(2, "0")} /mi`;
}

interface GoalDisplayProps {
  goal: Goal;
  onEdit?: () => void;
}

export function GoalDisplay({ goal, onEdit }: GoalDisplayProps) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 16,
        marginBottom: 24,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <h2 style={{ fontSize: "1rem", marginTop: 0, marginBottom: 12 }}>
            Current goal
          </h2>
          <p style={{ margin: "0 0 4px", fontWeight: 600 }}>{goal.raceName}</p>
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 14 }}>
            {goal.distance} · {goal.goalTime} · {goal.raceDate}
          </p>
          <p style={{ margin: "12px 0 0", color: "var(--text-secondary)", fontSize: 14 }}>
            Goal pace: {paceToMinPerMile(goal.goalPaceSecPerMile)}
          </p>
          <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: 14 }}>
            {goal.weeksRemaining} weeks remaining
          </p>
        </div>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
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
            Edit
          </button>
        )}
      </div>
    </div>
  );
}
