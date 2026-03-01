/**
 * Generate a 2–3 paragraph coach review from session data (deterministic, no LLM).
 * Tone: interpretive and conversational; avoid simply restating numbers.
 */

interface WorkSplit {
  repIndex: number;
  plannedDurationSec: number;
  plannedPaceSecPerMile: number;
  actualDurationSec: number;
  actualPaceSecPerMile: number;
  deviationPct: number;
}

interface IntensityDiag {
  pct_z2_work: number;
  pct_z3_work: number;
  pct_z4_work: number;
  pct_z5_work: number;
  drift_bpm: number;
}

interface FitnessState {
  fatigueIndex: number;
  fatigueState: string;
  fitnessTrendState: string;
  estimatedThresholdSecPerMile: number;
  sessionsCount: number;
  predictionConfidence: number;
}

function paceToMinSec(secPerMile: number): string {
  const min = Math.floor(secPerMile / 60);
  const sec = Math.round(secPerMile % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export interface CoachContext {
  raceGoal?: { raceName: string; distance: string; goalPaceSecPerMile: number } | null;
  sessionName?: string | null;
  sessionThresholdSecPerMile?: number;
}

export function generateCoachNarrative(
  totalScore: number,
  paceScore: number,
  volumeScore: number,
  intensityScore: number,
  workSplits: WorkSplit[],
  intensityDiagnostics: IntensityDiag | null,
  fitnessState: FitnessState | null,
  context?: CoachContext
): string {
  const paragraphs: string[] = [];

  // —— Optional: Race goal and session — are you on track?
  if (context?.raceGoal && context.sessionThresholdSecPerMile != null && context.sessionThresholdSecPerMile > 0) {
    const goalPace = context.raceGoal.goalPaceSecPerMile;
    const sessionPace = context.sessionThresholdSecPerMile;
    const diffSec = sessionPace - goalPace; // positive = session slower than goal
    const sessionLabel = context.sessionName ? `"${context.sessionName}"` : "This session";
    let onTrack = "";
    if (diffSec <= 5) {
      onTrack = `${sessionLabel} is right in the ballpark of your ${context.raceGoal.raceName} goal pace (${paceToMinSec(goalPace)}/mi). You’re on track. `;
    } else if (diffSec <= 15) {
      onTrack = `For ${context.raceGoal.raceName}, your goal pace is ${paceToMinSec(goalPace)}/mi. ${sessionLabel} ran at about ${paceToMinSec(sessionPace)}/mi — close; a few more sessions like this and you’ll be right there. `;
    } else {
      onTrack = `Your ${context.raceGoal.raceName} goal is ${paceToMinSec(goalPace)}/mi. ${sessionLabel} was around ${paceToMinSec(sessionPace)}/mi — use that as a checkpoint. Keep stacking sessions and execution; the trend matters more than one day. `;
    }
    paragraphs.push(onTrack.trim());
  }

  // —— Paragraph: What this session means for you (interpretation, not raw scores)
  const scoreTier =
    totalScore >= 85 ? "excellent" : totalScore >= 70 ? "strong" : totalScore >= 55 ? "solid" : "tough";
  let opening = "";
  if (scoreTier === "excellent") {
    opening =
      "This is the kind of session that builds confidence: you executed the plan and your body responded. ";
  } else if (scoreTier === "strong") {
    opening =
      "You got the work in and stayed largely on script — a few small tweaks could make the next one even sharper. ";
  } else if (scoreTier === "solid") {
    opening =
      "There’s useful information here. Some parts of the session drifted from the plan; we can use that to adjust next time. ";
  } else {
    opening =
      "Today was more about getting through than hitting numbers — that’s still valuable. Let’s look at what to prioritise next. ";
  }

  if (paceScore >= 32) {
    opening += "Your pacing was the standout: you held the effort where it mattered and didn’t chase the first rep. ";
  } else if (paceScore >= 24) {
    opening +=
      "Pacing was close but not quite locked in — often that means starting a touch hot or fading at the end. Next time, aim to feel like you could do one more rep at the same pace. ";
  } else {
    opening +=
      "Pace drifted more than we’d like, which usually points to either going out too hard or the target being a bit ambitious for today. Consider starting a few seconds per mile easier and see how the later reps feel. ";
  }

  if (volumeScore >= 18) {
    opening += "Volume matched the plan, so the training load is right where we want it. ";
  } else if (volumeScore >= 14) {
    opening += "Volume was a bit short of plan — worth double‑checking next time that the laps you’re selecting really match the intended work blocks. ";
  } else {
    opening += "Total work volume was off plan; that might be lap selection or cutting the session short. Worth confirming the plan and lap mapping next time. ";
  }

  if (intensityScore > 0) {
    if (intensityScore >= 32) {
      opening += "Heart rate stayed in the right zones, which suggests the effort and recovery balance was good. ";
    } else if (intensityScore >= 24) {
      opening +=
        "HR showed some drift or zone spill — starting the first rep a bit easier often keeps the rest of the set more stable. ";
    } else {
      opening +=
        "HR control was the main limiter today. Easing into the first rep and keeping the middle reps steady usually improves both the score and how you feel. ";
    }
  } else {
    opening += "No HR data this time, so we couldn’t score intensity; when you have a strap or optical HR, it helps round out the picture. ";
  }
  paragraphs.push(opening.trim());

  // —— Paragraph 2: One or two concrete takeaways (not a list of numbers)
  if (workSplits.length > 0) {
    const avgDev =
      workSplits.reduce((s, w) => s + w.deviationPct, 0) / workSplits.length;
    const worst = workSplits.reduce((a, w) => (w.deviationPct > a.deviationPct ? w : a), workSplits[0]);
    let takeaway = "";
    if (worst.deviationPct > 8) {
      takeaway = `Rep ${worst.repIndex} had the biggest pace drift (${worst.deviationPct.toFixed(0)}% off target). That’s often where the session gets away from us — try locking in that rep next time and see how the rest of the set feels. `;
    } else if (avgDev > 5) {
      takeaway = `Pace was a bit variable across the reps (about ${avgDev.toFixed(0)}% off on average). Small improvements in consistency here usually translate to better execution scores and a clearer fitness signal. `;
    } else {
      takeaway = `Pace was consistent across the reps — that’s exactly what we want for both execution and for reading your fitness. `;
    }
    if (intensityDiagnostics) {
      const z3z4 = (intensityDiagnostics.pct_z3_work + intensityDiagnostics.pct_z4_work) * 100;
      const drift = intensityDiagnostics.drift_bpm;
      if (drift > 10 || intensityDiagnostics.pct_z5_work > 0.25) {
        takeaway += `Heart rate drifted ${drift >= 0 ? "+" : ""}${drift.toFixed(0)} bpm from first to last rep, and a fair chunk of work crept into higher zones. Bringing the opening rep down a notch usually keeps the whole set more controlled. `;
      } else if (z3z4 >= 70) {
        takeaway += `Most of the work stayed in Z3–Z4 — that’s good zone discipline and helps the session do its job. `;
      }
    }
    if (takeaway) paragraphs.push(takeaway.trim());
  }

  // —— Paragraph 3: Context and what to do next (fatigue + trend + next step)
  if (fitnessState) {
    const fatigue = fitnessState.fatigueState.toLowerCase();
    const trend = fitnessState.fitnessTrendState;
    let context = "";
    if (fitnessState.fatigueState === "High" || fitnessState.fatigueState === "Building") {
      context = `Fatigue is ${fatigue} right now, so the priority is recovery and consistency rather than pushing. An easier or shorter session next will help you absorb the work you’ve done. `;
    } else if (fitnessState.fatigueState === "Low" || fitnessState.fatigueState === "Stable") {
      if (totalScore >= 75) {
        context = `Fatigue is ${fatigue} and the trend is ${trend}. You’re in a good place to maintain volume and focus on execution — the next session is a chance to reinforce this. `;
      } else {
        context = `Fatigue is ${fatigue}. Next time, keep volume similar and focus on nailing pace and HR control so we get a clearer read on your fitness. `;
      }
    } else {
      context = `With ${fitnessState.sessionsCount} session${fitnessState.sessionsCount !== 1 ? "s" : ""} in the mix, we’re building a clearer picture (confidence around ${(fitnessState.predictionConfidence * 100).toFixed(0)}%). Next up: steady volume and clean execution. `;
    }
    if (fitnessState.estimatedThresholdSecPerMile != null && fitnessState.estimatedThresholdSecPerMile > 0) {
      context += `Current threshold-style pace is around ${paceToMinSec(fitnessState.estimatedThresholdSecPerMile)}/mi — use that as a reference for effort on steady and tempo work. `;
    }
    paragraphs.push(context.trim());
  } else {
    paragraphs.push(
      "Keep logging sessions — each one sharpens the picture of your fatigue and fitness. Next time, aim to match or slightly improve execution and volume so we can see the trend."
    );
  }

  return paragraphs.join("\n\n");
}
