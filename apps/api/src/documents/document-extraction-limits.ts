export class DocumentExtractionLimitError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** Reject dimensions before they become a canvas allocation. */
export function assertPixelLimit(
  width: number,
  height: number,
  maxPixels: number,
  reason = 'DOCUMENT_PAGE_PIXELS_EXCEEDED',
): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new DocumentExtractionLimitError('DOCUMENT_DIMENSIONS_INVALID');
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > maxPixels) {
    throw new DocumentExtractionLimitError(reason);
  }
  return pixels;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, reason: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new DocumentExtractionLimitError(reason)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
