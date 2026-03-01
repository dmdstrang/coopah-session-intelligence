/**
 * Analyse Coopah PACE screenshots using OpenAI vision.
 * Returns structured session name, coach message, and intervals.
 */

import type { Interval } from "../domain/pace-parser.js";

function getOpenAiConfig() {
  return {
    apiKey: (process.env.OPENAI_API_KEY ?? "").trim(),
    model: process.env.OPENAI_VISION_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  };
}

export interface AiParsedPlan {
  sessionName: string;
  coachMessage: string;
  intervals: Interval[];
  confidence: number;
}

function getMimeType(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e) return "image/png";
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46) return "image/webp";
  return "image/jpeg";
}

const SYSTEM_PROMPT = `You analyse Coopah running app screenshots showing the PACE tab. Extract structured data.

MULTIPLE SCREENSHOTS: The user may upload 2+ images. Often the FIRST image (or the one WITHOUT the interval table) shows only the SESSION TITLE (main/biggest heading) and the COACH MESSAGE (a paragraph below the summary). The OTHER image(s) show the interval table. You MUST look at every image and extract sessionName and coachMessage from the screenshot that has the title and coach text (the intro screen). Use the interval-table screenshot(s) only for the intervals array.

INTERVALS — ORDER: List intervals in the EXACT order they appear in the screenshot. Do not reorder, sort, or group. First row in the table = first object in the array.

INTERVALS — PACE vs DURATION (critical): For work intervals there are TWO different values:
- DURATION = how long the interval lasts (e.g. 2 min, 400m, 3:00). Put this in durationSeconds (convert to seconds).
- TARGET PACE = speed to run (e.g. 6:00/mi, 5:45 per mile). Put this in targetPaceSecPerMile (convert to seconds per mile: 6:00/mi = 360).
Do NOT use the duration value as the pace. They are different columns/numbers in the UI.

Return valid JSON only, no markdown or explanation:
{
  "sessionName": "string - exact session title from the intro screen",
  "coachMessage": "string - full coach message from the intro screen, or empty if not present",
  "intervals": [
    { "type": "warmup", "durationSeconds": number },
    { "type": "work", "repNumber": 1, "durationSeconds": number, "targetPaceSecPerMile": number },
    { "type": "recovery", "durationSeconds": number },
    ...
    { "type": "cooldown", "durationSeconds": number }
  ]
}

Rules:
- type is one of: warmup, work, recovery, cooldown
- durationSeconds: interval length in seconds (e.g. 2 min = 120, 90 sec = 90)
- targetPaceSecPerMile: only for type "work"; the PACE column (e.g. 6:00/mi = 360), NOT the duration
- Preserve the exact order of rows from the interval table.`;

export async function analyseScreenshotsWithAi(
  imageBuffers: Buffer[]
): Promise<AiParsedPlan | null> {
  const { apiKey, model } = getOpenAiConfig();
  if (!apiKey) return null;

  const imageParts = imageBuffers.map((buffer) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:${getMimeType(buffer)};base64,${buffer.toString("base64")}`,
    },
  }));

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Look at ALL images. The intro screen (often the first) has the session title and coach message — use those. The other screen(s) have the interval table — list intervals in the exact table order. For work rows, duration is how long the interval lasts; targetPaceSecPerMile is the pace column (e.g. 6:00/mi), not the duration. Return only the JSON object.",
            },
            ...imageParts,
          ],
        },
      ],
      max_tokens: 2000,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("No content from OpenAI");

  const jsonStr = content.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(jsonStr) as {
    sessionName?: string;
    coachMessage?: string;
    intervals?: unknown[];
  };

  const intervals: Interval[] = (parsed.intervals ?? []).map((inv: unknown) => {
    const x = inv as Record<string, unknown>;
    const type = (x.type as string) || "work";
    const interval: Interval = {
      type: type as Interval["type"],
      durationSeconds: typeof x.durationSeconds === "number" ? x.durationSeconds : 0,
    };
    if (type === "work") {
      interval.repNumber = typeof x.repNumber === "number" ? x.repNumber : undefined;
      interval.targetPaceSecPerMile =
        typeof x.targetPaceSecPerMile === "number" ? x.targetPaceSecPerMile : 360;
    }
    return interval;
  });

  return {
    sessionName: typeof parsed.sessionName === "string" ? parsed.sessionName : "Session",
    coachMessage: typeof parsed.coachMessage === "string" ? parsed.coachMessage : "",
    intervals,
    confidence: 85,
  };
}

export function isAiScreenshotAvailable(): boolean {
  return getOpenAiConfig().apiKey.length > 0;
}
