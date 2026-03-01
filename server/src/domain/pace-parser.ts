/**
 * Parse OCR text from Coopah PACE tab screenshots.
 * Extracts session name and all intervals (warmup, work, recovery, cooldown).
 * Work blocks are derived from intervals with type "work" for scoring.
 */

export type IntervalType = "warmup" | "work" | "recovery" | "cooldown";

export interface Interval {
  type: IntervalType;
  durationSeconds: number;
  repNumber?: number;        // for work
  targetPaceSecPerMile?: number; // for work
}

export interface ParsedPlan {
  sessionName: string;
  coachMessage: string;
  intervals: Interval[];
  confidence: number; // 0-100
}

export interface OcrLineForParser {
  text: string;
  bbox: { y0: number; y1: number };
  rowHeight: number;
}

/** Work block for scoring (derived from intervals where type === "work"). */
export interface WorkBlock {
  repNumber: number;
  durationSeconds: number;
  targetPaceSecPerMile: number;
  recoverySeconds: number; // next interval if type recovery, else 0
}

const PACE_MARKERS = ["PACE", "pace", "Pace"];

function parseDurationToSeconds(s: string): number {
  const n = s.replace(/[^\d]/g, "");
  if (/min|m\b/i.test(s) && !s.includes(":")) return parseInt(n, 10) * 60;
  if (s.includes(":")) {
    const [a, b] = s.split(":").map(Number);
    return (a ?? 0) * 60 + (b ?? 0);
  }
  return parseInt(n, 10) || 0;
}

/**
 * Heuristic parse: find PACE, then session name (first substantial line after PACE),
 * then intervals. Only count as "work" when we see both duration and pace (M:SS) on same line;
 * cap work intervals at 25 to avoid warmup/cool-down noise.
 */
export function parsePaceOcrText(ocrText: string): ParsedPlan {
  const text = ocrText || "";
  const upper = text.toUpperCase();
  const hasPace = PACE_MARKERS.some((m) => upper.includes(m.toUpperCase()));
  if (!hasPace) {
    return { sessionName: "Unknown", coachMessage: "", intervals: [], confidence: 0 };
  }

  const lines = text.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  let sessionName = "Session";

  const paceIdx = lines.findIndex((l) => PACE_MARKERS.some((m) => l.toLowerCase().includes(m.toLowerCase())));
  if (paceIdx >= 0) {
    for (let i = paceIdx + 1; i < Math.min(paceIdx + 5, lines.length); i++) {
      const line = lines[i];
      if (line.length > 2 && line.length < 60 && !/^\d+$/.test(line) && !/^\d+\s*min/i.test(line) && !/\d{1,2}:\d{2}/.test(line)) {
        sessionName = line.replace(/\s+/g, " ").slice(0, 80);
        break;
      }
    }
  }

  const intervals: Interval[] = [];
  let workCount = 0;
  const maxWork = 25;

  for (let i = 0; i < lines.length && workCount < maxWork; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    if (/warm\s*up|warmup|easy|jog/i.test(lower) && /\d+/.test(line)) {
      const durMatch = line.match(/(\d+)\s*(?:min|m|:|\s)/);
      if (durMatch) {
        intervals.push({ type: "warmup", durationSeconds: parseDurationToSeconds(durMatch[0]) || 600 });
      }
      continue;
    }
    if (/cool\s*down|cooldown|warm\s*down/i.test(lower) && /\d+/.test(line)) {
      const durMatch = line.match(/(\d+)\s*(?:min|m|:|\s)/);
      if (durMatch) {
        intervals.push({ type: "cooldown", durationSeconds: parseDurationToSeconds(durMatch[0]) || 600 });
      }
      continue;
    }
    if (/(?:rec|recovery|rest)\s*[:\s]*\d+/i.test(line)) {
      const numMatch = line.match(/(\d+)\s*(sec|s|min|m)?/i);
      if (numMatch) {
        const n = parseInt(numMatch[1], 10);
        const unit = (numMatch[2] ?? "").toLowerCase();
        const sec = /min|m\b/.test(unit) ? n * 60 : n;
        intervals.push({ type: "recovery", durationSeconds: sec });
      }
      continue;
    }

    const durationMatch = line.match(/(\d+)\s*(?:min|m)(?:\s|$)/i) ?? line.match(/(\d{1,2}):(\d{2})(?:\s|$)/);
    const paceMatch = line.match(/(\d{1,2}):(\d{2})\s*(?:\/mi|\/mile|per mile)?/i);
    const hasPaceOnLine = !!paceMatch;
    const hasDurationOnLine = !!durationMatch;

    if (hasPaceOnLine && hasDurationOnLine) {
      const durationSec = durationMatch!.length >= 3
        ? parseInt(durationMatch![1], 10) * 60 + parseInt(durationMatch![2], 10)
        : parseDurationToSeconds(durationMatch![0]);
      const paceSec = parseInt(paceMatch![1], 10) * 60 + parseInt(paceMatch![2], 10);
      if (durationSec >= 30 && durationSec <= 3600 && paceSec >= 240 && paceSec <= 900) {
        workCount++;
        intervals.push({
          type: "work",
          durationSeconds: durationSec,
          repNumber: workCount,
          targetPaceSecPerMile: paceSec,
        });
      }
    }
  }

  if (intervals.filter((i) => i.type === "work").length === 0) {
    const paceMatches = [...text.matchAll(/(\d{1,2}):(\d{2})\s*(?:\/mi|\/mile)?/gi)];
    const seen = new Set<string>();
    for (const m of paceMatches) {
      if (workCount >= maxWork) break;
      const key = m[0];
      if (seen.has(key)) continue;
      seen.add(key);
      const paceSec = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      if (paceSec >= 240 && paceSec <= 900) {
        workCount++;
        intervals.push({
          type: "work",
          durationSeconds: 120,
          repNumber: workCount,
          targetPaceSecPerMile: paceSec,
        });
      }
    }
  }

  let confidence = 30;
  const workIntervals = intervals.filter((i) => i.type === "work");
  if (workIntervals.length > 0) confidence += Math.min(workIntervals.length * 4, 40);
  if (hasPace) confidence += 20;
  if (sessionName !== "Session") confidence += 10;
  confidence = Math.min(100, confidence);

  return { sessionName, coachMessage: "", intervals, confidence };
}

/** Derive work blocks from intervals for scoring (work + following recovery). */
export function intervalsToWorkBlocks(intervals: Interval[]): WorkBlock[] {
  const blocks: WorkBlock[] = [];
  for (let i = 0; i < intervals.length; i++) {
    const inv = intervals[i];
    if (inv.type !== "work") continue;
    const next = intervals[i + 1];
    const recoverySeconds = next?.type === "recovery" ? next.durationSeconds : 90;
    blocks.push({
      repNumber: inv.repNumber ?? blocks.length + 1,
      durationSeconds: inv.durationSeconds,
      targetPaceSecPerMile: inv.targetPaceSecPerMile ?? 360,
      recoverySeconds,
    });
  }
  return blocks;
}
