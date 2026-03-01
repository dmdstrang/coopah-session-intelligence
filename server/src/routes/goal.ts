import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { goals } from "../db/schema.js";
import {
  validateGoalInput,
  parseGoalTimeToSeconds,
  deriveGoal,
  type GoalDistance,
} from "../domain/goal.js";
import type { AuthRequest } from "../middleware/auth.js";

export const goalRouter = Router();

function formatGoalTime(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** GET /api/goal — current goal (single user: latest row) */
goalRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const [row] = await db
      .select()
      .from(goals)
      .where(eq(goals.userId, userId))
      .orderBy(desc(goals.createdAt))
      .limit(1);
    if (!row) {
      return res.json(null);
    }
    const input = {
      raceName: row.raceName,
      distance: row.distance as GoalDistance,
      goalTime: formatGoalTime(row.goalTimeSec),
      raceDate: row.raceDate,
    };
    const derived = deriveGoal(input, row.goalTimeSec);

    res.json({
      id: row.id,
      raceName: row.raceName,
      distance: row.distance,
      goalTime: formatGoalTime(row.goalTimeSec),
      goalPaceSecPerMile: derived.goalPaceSecPerMile,
      raceDate: row.raceDate,
      weeksRemaining: derived.weeksRemaining,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load goal" });
  }
});

/** PUT /api/goal — create or replace current goal */
goalRouter.put("/", async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const body = req.body as {
      raceName?: string;
      distance?: string;
      goalTime?: string;
      raceDate?: string;
    };
    const input = {
      raceName: body.raceName ?? "",
      distance: (body.distance ?? "5k") as GoalDistance,
      goalTime: body.goalTime ?? "00:00:00",
      raceDate: body.raceDate ?? "",
    };
    validateGoalInput(input);
    const goalTimeSec = parseGoalTimeToSeconds(input.goalTime);
    const derived = deriveGoal(input, goalTimeSec);

    await db.delete(goals).where(eq(goals.userId, userId));
    const [inserted] = await db
      .insert(goals)
      .values({
        userId,
        raceName: input.raceName.trim(),
        distance: input.distance,
        goalTimeSec,
        raceDate: input.raceDate,
      })
      .returning();

    res.json({
      id: inserted!.id,
      raceName: inserted!.raceName,
      distance: inserted!.distance,
      goalTime: formatGoalTime(inserted!.goalTimeSec),
      goalPaceSecPerMile: derived.goalPaceSecPerMile,
      raceDate: inserted!.raceDate,
      weeksRemaining: derived.weeksRemaining,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid goal";
    res.status(400).json({ error: msg });
  }
});
