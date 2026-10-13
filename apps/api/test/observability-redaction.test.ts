import { PassThrough } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { LOG_REDACTION_PATHS } from '../src/common/logging/observability.module.js';

describe('AI telemetry redaction', () => {
  it('never serializes prompts, evidence, OCR text, or provider credentials', () => {
    const stream = new PassThrough();
    let rendered = '';
    stream.on('data', (chunk: Buffer) => {
      rendered += chunk.toString('utf8');
    });
    const logger = pino({ redact: { paths: LOG_REDACTION_PATHS, censor: '[redacted]' } }, stream);

    logger.error({
      prompt: 'secret prompt',
      evidence: { reportCell: 'secret report cell' },
      ocrText: 'secret OCR text',
      authorization: 'Bearer secret-provider-key',
      nested: { question: 'secret question', apiKey: 'secret-api-key' },
    });

    expect(rendered).toContain('[redacted]');
    expect(rendered).not.toContain('secret prompt');
    expect(rendered).not.toContain('secret report cell');
    expect(rendered).not.toContain('secret OCR text');
    expect(rendered).not.toContain('secret-provider-key');
    expect(rendered).not.toContain('secret question');
    expect(rendered).not.toContain('secret-api-key');
  });
});
