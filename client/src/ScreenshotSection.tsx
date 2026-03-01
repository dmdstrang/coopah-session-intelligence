import { useRef, useState } from "react";
import { parseJson } from "./api";
import { useAuth } from "./Auth";

export type IntervalType = "warmup" | "work" | "recovery" | "cooldown";

export interface Interval {
  type: IntervalType;
  durationSeconds: number;
  repNumber?: number;
  targetPaceSecPerMile?: number;
}

interface ParsedPlan {
  sessionName: string;
  coachMessage: string;
  intervals: Interval[];
  confidence: number;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatPace(secPerMile: number): string {
  const m = Math.floor(secPerMile / 60);
  const s = Math.floor(secPerMile % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function parseDurationToSeconds(s: string): number {
  const t = s.trim();
  const parts = t.split(":");
  if (parts.length >= 2) {
    const m = parseInt(parts[0], 10) || 0;
    const s = parseInt(parts[1], 10) || 0;
    return m * 60 + s;
  }
  const num = parseInt(t.replace(/\D/g, ""), 10);
  if (Number.isNaN(num) || num < 0) return 0;
  if (t.length <= 2) return num;
  if (t.length === 3) return Math.floor(num / 100) * 60 + (num % 100);
  return Math.floor(num / 100) * 60 + (num % 100);
}

function parsePaceToSeconds(s: string): number {
  const t = s.trim();
  const parts = t.split(":");
  if (parts.length >= 2) {
    const m = parseInt(parts[0], 10) || 0;
    const s = parseInt(parts[1], 10) || 0;
    return m * 60 + s;
  }
  const num = parseInt(t.replace(/\D/g, ""), 10);
  if (Number.isNaN(num)) return 360;
  if (num <= 0) return 360;
  if (t.length <= 2) return num;
  if (t.length === 3) return Math.floor(num / 100) * 60 + (num % 100);
  if (t.length >= 4) return Math.floor(num / 100) * 60 + (num % 100);
  return num;
}

function intervalLabel(inv: Interval, idx: number): string {
  if (inv.type === "warmup") return "Warm up";
  if (inv.type === "cooldown") return "Cool down";
  if (inv.type === "recovery") return "Recovery";
  return `Work ${inv.repNumber ?? idx + 1}`;
}

interface ScreenshotSectionProps {
  onPlanConfirmed?: (id: number | null, plan?: { sessionName: string; intervals: Interval[] }) => void;
  initialParsedPlanId?: number | null;
}

const BLANK_MANUAL_PLAN: ParsedPlan = {
  sessionName: "",
  coachMessage: "",
  intervals: [{ type: "work", durationSeconds: 0, targetPaceSecPerMile: 360, repNumber: 1 }],
  confidence: 100,
};

export function ScreenshotSection({ onPlanConfirmed, initialParsedPlanId = null }: ScreenshotSectionProps) {
  const auth = useAuth();
  const [addMode, setAddMode] = useState<null | "manual" | "screenshot">(null);
  const [files, setFiles] = useState<File[]>([]);
  const [parsed, setParsed] = useState<ParsedPlan | null>(null);
  const [parsedPlanId, setParsedPlanId] = useState<number | null>(initialParsedPlanId ?? null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** While editing, show raw string; parse and commit on blur so typing "6:00" works */
  const [editing, setEditing] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addMoreInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(e.target.files ?? []);
    const valid = chosen.filter((f) => /^image\/(jpeg|png|gif|webp)$/i.test(f.type));
    setFiles(valid.slice(0, 5));
    setParsed(null);
    setParsedPlanId(null);
    onPlanConfirmed?.(null, undefined);
    setError(null);
    setAddMode("screenshot");
  };

  const handleAddMoreFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(e.target.files ?? []);
    const valid = chosen.filter((f) => /^image\/(jpeg|png|gif|webp)$/i.test(f.type));
    setFiles((prev) => [...prev, ...valid].slice(0, 5));
    setParsed(null);
    setParsedPlanId(null);
    onPlanConfirmed?.(null, undefined);
    setError(null);
    e.target.value = "";
  };

  const handleAnalyse = async () => {
    if (files.length === 0) {
      setError("Select 1–5 images first");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      files.forEach((f) => formData.append("images", f));
      const res = await auth.apiFetch("/api/plans/analyse", {
        method: "POST",
        body: formData,
      });
      const data = await parseJson<ParsedPlan & { error?: string }>(res);
      if (!res.ok) {
        setError(data?.error ?? "Failed to analyse");
        setParsed(null);
        return;
      }
      if (data && Array.isArray(data.intervals)) {
        setParsed({
          sessionName: data.sessionName ?? "Session",
          coachMessage: data.coachMessage ?? "",
          intervals: data.intervals,
          confidence: data.confidence ?? 0,
        });
      } else {
        setError("No plan detected");
        setParsed(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to analyse screenshots");
      setParsed(null);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!parsed) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await auth.apiFetch("/api/plans/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionName: parsed.sessionName,
          coachMessage: parsed.coachMessage,
          intervals: parsed.intervals,
        }),
      });
      const data = await parseJson<{ parsedPlanId?: number; error?: string }>(res);
      if (!res.ok) {
        setError(data?.error ?? "Failed to save plan");
        return;
      }
      if (data?.parsedPlanId && parsed) {
        setParsedPlanId(data.parsedPlanId);
        onPlanConfirmed?.(data.parsedPlanId, { sessionName: parsed.sessionName, intervals: parsed.intervals });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to confirm plan");
    } finally {
      setConfirming(false);
    }
  };

  const updateSessionName = (v: string) => {
    if (parsed) setParsed({ ...parsed, sessionName: v });
  };

  const updateCoachMessage = (v: string) => {
    if (parsed) setParsed({ ...parsed, coachMessage: v });
  };

  const updateInterval = (idx: number, field: "durationSeconds" | "targetPaceSecPerMile", value: number) => {
    if (!parsed) return;
    const next = [...parsed.intervals];
    if (next[idx]) (next[idx] as unknown as Record<string, number>)[field] = value;
    setParsed({ ...parsed, intervals: renumberWorkReps(next) });
  };

  /** Renumber work repNumbers 1, 2, 3... in order. */
  function renumberWorkReps(intervals: Interval[]): Interval[] {
    let rep = 0;
    return intervals.map((inv) => {
      if (inv.type !== "work") return inv;
      rep += 1;
      return { ...inv, repNumber: rep };
    });
  }

  const addInterval = (type: IntervalType) => {
    if (!parsed) return;
    const defaults: Record<IntervalType, Partial<Interval>> = {
      warmup: { durationSeconds: 300 },
      cooldown: { durationSeconds: 300 },
      recovery: { durationSeconds: 90 },
      work: { durationSeconds: 60, targetPaceSecPerMile: 360 },
    };
    const newInv: Interval = { type, durationSeconds: defaults[type]?.durationSeconds ?? 60, ...defaults[type] };
    const next = renumberWorkReps([...parsed.intervals, newInv]);
    setParsed({ ...parsed, intervals: next });
  };

  const deleteInterval = (idx: number) => {
    if (!parsed || parsed.intervals.length <= 1) return;
    const next = parsed.intervals.filter((_, i) => i !== idx);
    setParsed({ ...parsed, intervals: renumberWorkReps(next) });
    setEditing({});
  };

  const editKey = (idx: number, field: "d" | "p") => `${idx}-${field}`;

  const commitDuration = (idx: number) => {
    const key = editKey(idx, "d");
    const raw = editing[key];
    if (raw === undefined) return;
    const sec = parseDurationToSeconds(raw);
    updateInterval(idx, "durationSeconds", sec);
    setEditing((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const commitPace = (idx: number) => {
    const key = editKey(idx, "p");
    const raw = editing[key];
    if (raw === undefined) return;
    const sec = parsePaceToSeconds(raw);
    updateInterval(idx, "targetPaceSecPerMile", sec);
    setEditing((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

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
        {!parsed ? "Add your planned session" : "Session plan (screenshots)"}
      </h2>
      {error && (
        <p style={{ color: "var(--red)", marginBottom: 12, fontSize: 14 }}>
          {error}
        </p>
      )}

      {!parsed && !parsedPlanId && addMode === null ? (
        <div>
          <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 12, fontWeight: 600 }}>
            Add screenshots of your Coopah training session.
          </p>
          <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 20 }}>
            Add all the screenshots including the title and coach message. Make sure that each rep shows the time and pace.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
            <button
              type="button"
              onClick={() => setParsed({ ...BLANK_MANUAL_PLAN })}
              style={{
                minHeight: 120,
                padding: 20,
                background: "var(--bg)",
                border: "2px solid var(--border)",
                borderRadius: 12,
                color: "var(--text)",
                cursor: "pointer",
                fontSize: 16,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
              }}
            >
              Add manually
            </button>
            <button
              type="button"
              onClick={() => setAddMode("screenshot")}
              style={{
                minHeight: 120,
                padding: 20,
                background: "var(--bg)",
                border: "2px solid var(--border)",
                borderRadius: 12,
                color: "var(--text)",
                cursor: "pointer",
                fontSize: 16,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
              }}
            >
              Add screenshot
            </button>
          </div>
        </div>
      ) : !parsed && addMode === "screenshot" ? (
        <div>
          <button
            type="button"
            onClick={() => { setAddMode(null); setFiles([]); setError(null); }}
            style={{
              marginBottom: 12,
              padding: "4px 0",
              background: "none",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            ← Back
          </button>
          <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 12, fontWeight: 600 }}>
            Add screenshots of your Coopah training session.
          </p>
          <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 12 }}>
            Add all the screenshots including the title and coach message. Make sure that each rep shows the time and pace.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            onChange={handleFileChange}
            style={{ marginBottom: 8, fontSize: 14 }}
          />
          {files.length > 0 && (
            <input
              ref={addMoreInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              multiple
              onChange={handleAddMoreFiles}
              style={{ display: "none" }}
            />
          )}
          {files.length > 0 && (
            <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 8 }}>
              {files.length} image(s) selected (max 5)
            </p>
          )}
          {files.length > 0 && files.length < 5 && (
            <button
              type="button"
              onClick={() => addMoreInputRef.current?.click()}
              style={{
                marginBottom: 12,
                padding: "8px 14px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text)",
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              Add new
            </button>
          )}
          <button
            type="button"
            onClick={handleAnalyse}
            disabled={loading || files.length === 0}
            style={{
              padding: "10px 20px",
              background: "var(--green)",
              border: "none",
              borderRadius: 6,
              color: "var(--bg)",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Analysing…" : "Analyse screenshots"}
          </button>
        </div>
      ) : parsed ? (
        <div>
          {!parsedPlanId && !initialParsedPlanId && (
            <button
              type="button"
              onClick={() => { setParsed(null); setAddMode(null); setError(null); }}
              style={{
                marginBottom: 12,
                padding: "4px 0",
                background: "none",
                border: "none",
                color: "var(--text-secondary)",
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              ← Back
            </button>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, margin: 0 }}>
              Confirm or edit the plan below. All intervals are shown; scoring uses work intervals only.
            </p>
            <div>
              <input
                ref={replaceInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                multiple
                onChange={handleFileChange}
                style={{ display: "none" }}
              />
              <button
                type="button"
                onClick={() => replaceInputRef.current?.click()}
                style={{
                  padding: "6px 12px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "var(--text)",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                Add new
              </button>
            </div>
          </div>
          <label style={{ display: "block", marginBottom: 8 }}>
            <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>Session name</span>
            <input
              type="text"
              value={parsed.sessionName}
              onChange={(e) => updateSessionName(e.target.value)}
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
          <label style={{ display: "block", marginBottom: 12 }}>
            <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>Coach message</span>
            <textarea
              value={parsed.coachMessage}
              onChange={(e) => updateCoachMessage(e.target.value)}
              placeholder="Message from coach (if any)"
              rows={3}
              style={{
                display: "block",
                width: "100%",
                marginTop: 4,
                padding: "8px 12px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text)",
                resize: "vertical",
              }}
            />
          </label>
          <p style={{ fontSize: 14, marginTop: 12, marginBottom: 4 }}>All intervals</p>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>
            Re-confirm after editing so scoring uses your latest plan.
          </p>
          <div style={{ overflowX: "auto", marginBottom: 8 }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Interval</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Duration (min:sec)</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Pace (min:sec /mi)</th>
                  <th style={{ width: 40, padding: "6px 8px" }} />
                </tr>
              </thead>
              <tbody>
                {parsed.intervals.map((inv, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 8px" }}>{intervalLabel(inv, idx)}</td>
                    <td style={{ padding: "6px 8px" }}>
                      <input
                        type="text"
                        value={editing[editKey(idx, "d")] ?? formatDuration(inv.durationSeconds)}
                        onChange={(e) => setEditing((p) => ({ ...p, [editKey(idx, "d")]: e.target.value }))}
                        onBlur={() => commitDuration(idx)}
                        onFocus={(e) => setEditing((p) => ({ ...p, [editKey(idx, "d")]: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                        placeholder="0:00"
                        style={{
                          width: 72,
                          padding: "4px 6px",
                          background: "var(--bg)",
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                          color: "var(--text)",
                        }}
                      />
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      {inv.type === "work" && inv.targetPaceSecPerMile != null ? (
                        <input
                          type="text"
                          value={editing[editKey(idx, "p")] ?? formatPace(inv.targetPaceSecPerMile)}
                          onChange={(e) => setEditing((p) => ({ ...p, [editKey(idx, "p")]: e.target.value }))}
                          onBlur={() => commitPace(idx)}
                          onFocus={(e) => setEditing((p) => ({ ...p, [editKey(idx, "p")]: e.target.value }))}
                          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                          placeholder="6:00"
                          style={{
                            width: 72,
                            padding: "4px 6px",
                            background: "var(--bg)",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            color: "var(--text)",
                          }}
                        />
                      ) : (
                        <span style={{ color: "var(--text-secondary)" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <button
                        type="button"
                        onClick={() => deleteInterval(idx)}
                        disabled={parsed.intervals.length <= 1}
                        title="Remove interval"
                        style={{
                          padding: "4px 8px",
                          background: "transparent",
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                          color: "var(--text-secondary)",
                          cursor: parsed.intervals.length <= 1 ? "not-allowed" : "pointer",
                          fontSize: 12,
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Add:</span>
            {(["warmup", "work", "recovery", "cooldown"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => addInterval(type)}
                style={{
                  padding: "6px 12px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "var(--text)",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                + {type === "work" ? "Work" : type === "warmup" ? "Warm up" : type === "cooldown" ? "Cool down" : "Recovery"}
              </button>
            ))}
          </div>
          <p style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 12 }}>
            Analysis confidence: {parsed.confidence}%
          </p>
          {(parsedPlanId ?? initialParsedPlanId) ? (
            <p style={{ color: "var(--green)", fontSize: 14 }}>
              Plan saved (ID: {parsedPlanId ?? initialParsedPlanId}). You can select a Strava activity and run analysis next.
            </p>
          ) : (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirming}
              style={{
                padding: "10px 20px",
                background: "var(--green)",
                border: "none",
                borderRadius: 6,
                color: "var(--bg)",
                fontWeight: 600,
                cursor: confirming ? "not-allowed" : "pointer",
              }}
            >
              {confirming ? "Saving…" : "Confirm plan"}
            </button>
          )}
        </div>
      ) : (
        <div>
          <p style={{ color: "var(--green)", fontSize: 14, marginBottom: 16 }}>
            Plan saved (ID: {parsedPlanId ?? initialParsedPlanId}). You can select a Strava activity and run analysis next.
          </p>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>Add another session:</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
            <button
              type="button"
              onClick={() => setParsed({ ...BLANK_MANUAL_PLAN })}
              style={{
                minHeight: 100,
                padding: 16,
                background: "var(--bg)",
                border: "2px solid var(--border)",
                borderRadius: 12,
                color: "var(--text)",
                cursor: "pointer",
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              Add manually
            </button>
            <button
              type="button"
              onClick={() => setAddMode("screenshot")}
              style={{
                minHeight: 100,
                padding: 16,
                background: "var(--bg)",
                border: "2px solid var(--border)",
                borderRadius: 12,
                color: "var(--text)",
                cursor: "pointer",
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              Add screenshot
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
