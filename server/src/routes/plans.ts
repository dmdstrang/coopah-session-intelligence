import { Router } from "express";
import multer from "multer";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { parsedPlans } from "../db/schema.js";
import type { AuthRequest } from "../middleware/auth.js";
import { ocrImageBuffer } from "../services/ocr.js";
import { analyseScreenshotsWithAi, isAiScreenshotAvailable } from "../services/screenshot-ai.js";
import { parsePaceOcrText, type Interval } from "../domain/pace-parser.js";

export const plansRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype);
    cb(null, !!ok);
  },
});

/** POST /api/plans/analyse — upload 1–5 images; use AI vision when available, else OCR */
plansRouter.post("/analyse", upload.array("images", 5), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files?.length) {
      return res.status(400).json({ error: "Upload 1–5 images" });
    }
    if (files.length > 5) {
      return res.status(400).json({ error: "Maximum 5 images" });
    }

    const buffers = files.map((f) => f.buffer);

    if (isAiScreenshotAvailable()) {
      try {
        const parsed = await analyseScreenshotsWithAi(buffers);
        if (parsed) {
          return res.json({
            sessionName: parsed.sessionName,
            coachMessage: parsed.coachMessage,
            intervals: parsed.intervals,
            confidence: parsed.confidence,
          });
        }
      } catch (e) {
        console.warn("AI screenshot analysis failed, falling back to OCR:", e);
      }
    }

    let fullText = "";
    for (const buffer of buffers) {
      const text = await ocrImageBuffer(buffer);
      fullText += text + "\n\n";
    }

    const parsed = parsePaceOcrText(fullText);
    if (parsed.confidence === 0) {
      return res.status(400).json({
        error: "PACE tab not detected. Ensure screenshots show the Coopah PACE view.",
        sessionName: "",
        coachMessage: "",
        intervals: [],
        confidence: 0,
      });
    }

    res.json({
      sessionName: parsed.sessionName,
      coachMessage: parsed.coachMessage ?? "",
      intervals: parsed.intervals,
      confidence: parsed.confidence,
    });
  } catch (e) {
    console.error("Analyse plans error:", e);
    res.status(500).json({ error: "Failed to analyse screenshots" });
  }
});

/** POST /api/plans/confirm — save or update user-confirmed plan. Send parsedPlanId to update in place, omit to create new. */
plansRouter.post("/confirm", async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const body = req.body as { parsedPlanId?: number; sessionName?: string; coachMessage?: string; intervals?: unknown[] };
    const sessionName = (body.sessionName ?? "Session").trim() || "Session";
    const coachMessage = typeof body.coachMessage === "string" ? body.coachMessage : "";
    const rawIntervals = Array.isArray(body.intervals) ? body.intervals : [];
    const intervals: Interval[] = rawIntervals.map((inv: unknown) => {
      const x = inv as Record<string, unknown>;
      const type = (x.type as string) || "work";
      const invNorm: Interval = {
        type: type as Interval["type"],
        durationSeconds: typeof x.durationSeconds === "number" ? x.durationSeconds : 0,
      };
      if (type === "work") {
        invNorm.repNumber = typeof x.repNumber === "number" ? x.repNumber : undefined;
        invNorm.targetPaceSecPerMile = typeof x.targetPaceSecPerMile === "number" ? x.targetPaceSecPerMile : 360;
      }
      return invNorm;
    });

    const existingId = typeof body.parsedPlanId === "number" ? body.parsedPlanId : null;
    if (existingId != null) {
      const [updated] = await db
        .update(parsedPlans)
        .set({
          sessionName,
          coachMessage,
          workBlocks: JSON.stringify(intervals),
          confidence: 100,
        })
        .where(and(eq(parsedPlans.id, existingId), eq(parsedPlans.userId, userId)))
        .returning({ id: parsedPlans.id });
      if (updated) {
        return res.json({ parsedPlanId: updated.id });
      }
      // Plan not found or not owned by user — fall through to insert new
    }

    const [inserted] = await db
      .insert(parsedPlans)
      .values({
        userId,
        sessionName,
        coachMessage,
        workBlocks: JSON.stringify(intervals),
        confidence: 100,
      })
      .returning();

    res.json({ parsedPlanId: inserted!.id });
  } catch (e) {
    console.error("Confirm plan error:", e);
    res.status(500).json({ error: "Failed to save plan" });
  }
});
