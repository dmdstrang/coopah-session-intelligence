/**
 * Goal domain: validation, goalPace (sec/mile), weeksRemaining.
 * No persistence — API layer reads/writes DB.
 */

export const GOAL_DISTANCES = ["5k", "10k", "half", "marathon", "custom"] as const;
export type GoalDistance = (typeof GOAL_DISTANCES)[number];

export interface GoalInput {
  raceName: string;
  distance: GoalDistance;
  goalTime: string; // HH:MM:SS
  raceDate: string; // YYYY-MM-DD
}

export interface GoalDerived {
  goalPaceSecPerMile: number;
  weeksRemaining: number;
}

/** Parse HH:MM:SS or HH:MM to total seconds. */
export function parseGoalTimeToSeconds(goalTime: string): number {
  const parts = goalTime.trim().split(":").map(Number);
  if (parts.length < 2 || parts.some(isNaN)) {
    throw new Error("Invalid goal time; use HH:MM:SS or HH:MM");
  }
  const [h = 0, m = 0, s = 0] =
    parts.length === 2 ? [0, parts[0], parts[1]] : parts;
  return h * 3600 + m * 60 + s;
}

/** Distance in meters for standard races (for pace derivation). */
const DISTANCE_METERS: Record<GoalDistance, number> = {
  "5k": 5000,
  "10k": 10000,
  half: 21097.5,
  marathon: 42195,
  custom: 0, // not used for goal pace
};

const MILES_PER_METER = 1 / 1609.34;

/** Compute goal pace in seconds per mile. */
export function goalPaceSecPerMile(
  distance: GoalDistance,
  goalTimeSec: number
): number {
  if (distance === "custom") {
    throw new Error("Custom distance does not define goal pace");
  }
  const meters = DISTANCE_METERS[distance];
  const miles = meters * MILES_PER_METER;
  return goalTimeSec / miles;
}

/** Weeks from today to race date. */
export function weeksRemaining(raceDateStr: string): number {
  const race = new Date(raceDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  race.setHours(0, 0, 0, 0);
  const diffMs = race.getTime() - today.getTime();
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
}

export function validateGoalInput(input: GoalInput): void {
  if (!input.raceName?.trim()) {
    throw new Error("Race name is required");
  }
  if (!GOAL_DISTANCES.includes(input.distance)) {
    throw new Error(`Distance must be one of: ${GOAL_DISTANCES.join(", ")}`);
  }
  const goalTimeSec = parseGoalTimeToSeconds(input.goalTime);
  if (goalTimeSec <= 0) {
    throw new Error("Goal time must be positive");
  }
  const dateMatch = /^\d{4}-\d{2}-\d{2}$/.exec(input.raceDate);
  if (!dateMatch) {
    throw new Error("Race date must be YYYY-MM-DD");
  }
  const d = new Date(input.raceDate);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid race date");
  }
}

export function deriveGoal(input: GoalInput, goalTimeSec: number): GoalDerived {
  const pace =
    input.distance === "custom"
      ? 0
      : goalPaceSecPerMile(input.distance, goalTimeSec);
  return {
    goalPaceSecPerMile: pace,
    weeksRemaining: weeksRemaining(input.raceDate),
  };
}
