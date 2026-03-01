declare module "tesseract.js" {
  interface RecognizeResult {
    data: {
      text: string;
      lines?: Array<{
        text: string;
        bbox: { x0: number; y0: number; x1: number; y1: number };
        rowAttributes?: { row_height?: number };
      }>;
    };
  }
  interface WorkerInstance {
    recognize(image: Buffer | string): Promise<RecognizeResult>;
    terminate(): Promise<void>;
  }
  export function createWorker(
    lang?: string,
    options?: { logger?: (m: unknown) => void }
  ): Promise<WorkerInstance>;
}
