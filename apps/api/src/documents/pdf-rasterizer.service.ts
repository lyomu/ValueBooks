import { Canvas, createCanvas } from '@napi-rs/canvas';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// pdfjs-dist's default build targets a browser DOM; the legacy Node build accepts a canvas factory
// instead, which is what lets this run without a real display or browser environment.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  assertPixelLimit,
  DocumentExtractionLimitError,
  withTimeout,
} from './document-extraction-limits.js';

export class PdfRasterizeError extends Error {}

const RENDER_SCALE = 2.0;

interface CanvasAndContext {
  canvas: Canvas;
  context: ReturnType<Canvas['getContext']>;
}

/** Minimal canvas factory pdf.js's legacy Node build asks for -- it never touches the DOM itself. */
class NodeCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(canvasAndContext: CanvasAndContext, width: number, height: number): void {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext: CanvasAndContext): void {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

/**
 * Rasterizes bounded PDF pages to PNG buffers for the existing image OCR path. PDF JavaScript is
 * explicitly disabled, page/pixel limits are checked before canvas allocation, and every parse or
 * render is bounded by the job wall-clock budget. This remains defense in depth: production must
 * run the worker in the restricted container manifest under `infrastructure/`.
 */
@Injectable()
export class PdfRasterizerService {
  constructor(private readonly config: ConfigService) {}

  async rasterize(pdfBuffer: Buffer, remainingJobMs?: number): Promise<Buffer[]> {
    // pdf.js constructs this itself (`new CanvasFactory(...)`), so this must be the class, not an
    // already-constructed instance -- passing an instance throws "CanvasFactory is not a
    // constructor" before any page is even parsed, which is real behavior confirmed against the
    // pdfjs-dist version this project pins, not a hypothetical concern.
    const factory = new NodeCanvasFactory();
    const maxPages = this.config.getOrThrow<number>('DOCUMENT_EXTRACTION_MAX_PAGES');
    const maxPagePixels = this.config.getOrThrow<number>('DOCUMENT_EXTRACTION_MAX_PAGE_PIXELS');
    const maxTotalPixels = this.config.getOrThrow<number>('DOCUMENT_EXTRACTION_MAX_TOTAL_PIXELS');
    const deadline =
      Date.now() +
      Math.min(
        this.config.getOrThrow<number>('DOCUMENT_EXTRACTION_TIMEOUT_MS'),
        remainingJobMs ?? Number.POSITIVE_INFINITY,
      );
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      ...hardenedPdfLoadOptions(maxPagePixels),
    });

    try {
      const doc = await withTimeout(
        loadingTask.promise,
        remainingMs(deadline),
        'PDF_PARSE_TIMEOUT',
      );
      if (doc.numPages > maxPages) {
        throw new DocumentExtractionLimitError('PDF_PAGE_LIMIT_EXCEEDED');
      }
      let totalPixels = 0;
      const images: Buffer[] = [];
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        try {
          const viewport = page.getViewport({ scale: RENDER_SCALE });
          const pagePixels = assertPixelLimit(viewport.width, viewport.height, maxPagePixels);
          totalPixels += pagePixels;
          if (!Number.isSafeInteger(totalPixels) || totalPixels > maxTotalPixels) {
            throw new DocumentExtractionLimitError('PDF_TOTAL_PIXELS_EXCEEDED');
          }
          const { canvas, context } = factory.create(viewport.width, viewport.height);
          await withTimeout(
            page.render({
              // pdf.js's TS types expect a browser HTMLCanvasElement/CanvasRenderingContext2D (not
              // in this project's lib target); @napi-rs/canvas implements the runtime surface.
              canvas: null,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
              canvasContext: context as any,
              viewport,
            }).promise,
            remainingMs(deadline),
            'PDF_RENDER_TIMEOUT',
          );
          images.push(canvas.toBuffer('image/png'));
        } finally {
          page.cleanup();
        }
      }
      return images;
    } catch (error) {
      if (error instanceof DocumentExtractionLimitError) throw error;
      throw new PdfRasterizeError(error instanceof Error ? error.message : 'Failed to render PDF.');
    } finally {
      await loadingTask.destroy();
    }
  }
}

function remainingMs(deadline: number): number {
  const remaining = deadline - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) {
    throw new DocumentExtractionLimitError('DOCUMENT_WALL_CLOCK_EXCEEDED');
  }
  return remaining;
}

/** Exported for a regression test: this is the PDF JavaScript/evaluation security boundary. */
export function hardenedPdfLoadOptions(maxPagePixels: number) {
  return {
    CanvasFactory: NodeCanvasFactory,
    // Do not rely on the default: pdf.js otherwise enables eval where the runtime supports it.
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
    maxImageSize: maxPagePixels,
  };
}
