import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWorker } from 'tesseract.js';

import {
  assertPixelLimit,
  DocumentExtractionLimitError,
  withTimeout,
} from './document-extraction-limits.js';

export class OcrFailedError extends Error {}

export interface OcrLine {
  readonly text: string;
  readonly page: number;
  readonly bbox: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
}

export interface OcrResult {
  readonly text: string;
  readonly lines: readonly OcrLine[];
}

/**
 * Pure local OCR (tesseract.js: WASM, no native binary or external service to install/patch). Bounds
 * pixel area, wall-clock time, and output length. The dedicated worker has an accompanying
 * low-privilege container manifest; these in-process checks remain defense in depth. The returned
 * text/lines are treated purely as data by the caller: no tool-calling, no
 * model, no instruction-following -- a regex/heuristic extractor only reads them, never executes
 * them. Line bounding boxes are what let the extractor cite a field's source region.
 */
@Injectable()
export class OcrService {
  constructor(private readonly config: ConfigService) {}

  /** `pageNumber` only tags the returned lines (for multi-page-PDF source regions); it does not
   * affect recognition, which always runs on the single image buffer given. */
  async recognize(
    imageBuffer: Buffer,
    pageNumber = 1,
    remainingJobMs?: number,
  ): Promise<OcrResult> {
    const timeoutMs = Math.min(
      this.config.getOrThrow<number>('OCR_TIMEOUT_MS'),
      remainingJobMs ?? Number.POSITIVE_INFINITY,
    );
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new DocumentExtractionLimitError('DOCUMENT_WALL_CLOCK_EXCEEDED');
    }
    const maxChars = this.config.getOrThrow<number>('OCR_MAX_TEXT_CHARS');
    const maxPixels = this.config.getOrThrow<number>('DOCUMENT_EXTRACTION_MAX_PAGE_PIXELS');
    const dimensions = imageDimensions(imageBuffer);
    assertPixelLimit(
      dimensions.width,
      dimensions.height,
      maxPixels,
      'DOCUMENT_IMAGE_PIXELS_EXCEEDED',
    );

    const worker = await createWorker('eng');
    try {
      const page = await withTimeout(
        worker.recognize(imageBuffer, {}, { blocks: true }).then((result) => result.data),
        timeoutMs,
        'OCR_TIMEOUT',
      );
      const lines: OcrLine[] = [];
      let usedChars = 0;
      for (const block of page.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            const text = line.text.trim();
            if (usedChars + text.length > maxChars) break;
            usedChars += text.length;
            lines.push({ text, page: pageNumber, bbox: line.bbox });
          }
        }
      }
      return { text: page.text.slice(0, maxChars), lines };
    } catch (error) {
      if (error instanceof DocumentExtractionLimitError) throw error;
      if (error instanceof OcrFailedError) throw error;
      throw new OcrFailedError(error instanceof Error ? error.message : 'OCR failed.');
    } finally {
      await worker.terminate().catch(() => undefined);
    }
  }
}

export function imageDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return jpegDimensions(bytes);
  }
  throw new DocumentExtractionLimitError('DOCUMENT_IMAGE_DIMENSIONS_UNAVAILABLE');
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } {
  for (let offset = 2; offset + 9 < bytes.length;) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === undefined) break;
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (isStartOfFrame(marker)) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  throw new DocumentExtractionLimitError('DOCUMENT_IMAGE_DIMENSIONS_UNAVAILABLE');
}

function isStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
