import { createWorker } from "tesseract.js";

export interface OcrLine {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  rowHeight: number;
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
}

/** OCR returning plain text only (legacy). */
export async function ocrImageBuffer(buffer: Buffer): Promise<string> {
  const result = await ocrImageBufferWithLayout(buffer);
  return result.text;
}

/** OCR returning text and lines with bbox/height for title and coach message extraction. */
export async function ocrImageBufferWithLayout(buffer: Buffer): Promise<OcrResult> {
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(buffer);
    const text = data.text || "";
    const lines: OcrLine[] = (data.lines || []).map((line: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; rowAttributes?: { row_height?: number } }) => ({
      text: (line.text || "").trim(),
      bbox: line.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
      rowHeight: line.rowAttributes?.row_height ?? (line.bbox ? line.bbox.y1 - line.bbox.y0 : 0),
    })).filter((l: OcrLine) => l.text.length > 0);
    return { text, lines };
  } finally {
    await worker.terminate();
  }
}
