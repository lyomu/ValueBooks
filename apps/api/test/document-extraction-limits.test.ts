import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';

import {
  assertPixelLimit,
  DocumentExtractionLimitError,
} from '../src/documents/document-extraction-limits';
import { imageDimensions } from '../src/documents/ocr.service';
import {
  hardenedPdfLoadOptions,
  PdfRasterizeError,
  PdfRasterizerService,
} from '../src/documents/pdf-rasterizer.service';

describe('document extraction resource boundaries', () => {
  it('disables PDF JavaScript evaluation in the exact options passed to pdf.js', () => {
    expect(hardenedPdfLoadOptions(16_000_000)).toMatchObject({
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: true,
      maxImageSize: 16_000_000,
    });
  });

  it('rejects extreme PNG dimensions before OCR or canvas allocation', () => {
    const image = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(image);
    image.writeUInt32BE(100_000, 16);
    image.writeUInt32BE(100_000, 20);

    expect(imageDimensions(image)).toEqual({ width: 100_000, height: 100_000 });
    expect(() => assertPixelLimit(100_000, 100_000, 16_000_000)).toThrow(
      DocumentExtractionLimitError,
    );
  });

  it('rejects invalid dimensions and arithmetic overflow fail closed', () => {
    expect(() => assertPixelLimit(0, 1, 1_000_000)).toThrow(DocumentExtractionLimitError);
    expect(() => assertPixelLimit(Number.MAX_VALUE, 2, 1_000_000)).toThrow(
      DocumentExtractionLimitError,
    );
  });

  it('rejects malformed PDFs without returning partial raster output', async () => {
    const rasterizer = new PdfRasterizerService(
      new ConfigService({
        DOCUMENT_EXTRACTION_MAX_PAGES: 5,
        DOCUMENT_EXTRACTION_MAX_PAGE_PIXELS: 16_000_000,
        DOCUMENT_EXTRACTION_MAX_TOTAL_PIXELS: 40_000_000,
        DOCUMENT_EXTRACTION_TIMEOUT_MS: 10_000,
      }),
    );

    await expect(
      rasterizer.rasterize(Buffer.from('%PDF-1.7\nnot a real PDF')),
    ).rejects.toBeInstanceOf(PdfRasterizeError);
  });
});
