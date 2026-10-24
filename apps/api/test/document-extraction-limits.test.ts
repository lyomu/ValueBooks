import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { access } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';

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
import { buildMinimalPdf } from './support/minimal-pdf';

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

  it('supplies Node pdf.js with a readable standard-font URL', async () => {
    const options = hardenedPdfLoadOptions(16_000_000);
    expect(options.standardFontDataUrl).toMatch(/^file:/);
    await expect(access(new URL('LiberationSans-Regular.ttf', options.standardFontDataUrl))).resolves.toBeUndefined();
  });

  it('renders alphabetic text from a PDF standard font', async () => {
    const rasterizer = new PdfRasterizerService(
      new ConfigService({
        DOCUMENT_EXTRACTION_MAX_PAGES: 5,
        DOCUMENT_EXTRACTION_MAX_PAGE_PIXELS: 16_000_000,
        DOCUMENT_EXTRACTION_MAX_TOTAL_PIXELS: 40_000_000,
        DOCUMENT_EXTRACTION_TIMEOUT_MS: 10_000,
      }),
    );
    const pngs = await rasterizer.rasterize(buildMinimalPdf(['Acme Alphabetic Text']));
    expect(pngs).toHaveLength(1);
    const image = await loadImage(pngs[0]!);
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let nonWhitePixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index]! < 200 || pixels[index + 1]! < 200 || pixels[index + 2]! < 200) nonWhitePixels += 1;
    }
    expect(nonWhitePixels).toBeGreaterThan(100);
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
