import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { configureApp } from './app-setup.js';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  // bufferLogs holds startup output until the pino logger is attached, so nothing is emitted in the
  // default format first.
  // rawBody: true preserves the exact request bytes on `req.rawBody` alongside the parsed body, so
  // Paystack webhook signature verification hashes the exact bytes the provider signed.
  // rather than a re-serialized JSON object.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  const port = Number(process.env.API_PORT ?? 3001);

  // Catalog items carry an inline product image (a data URL of up to ~2 MB once encoded), which
  // the 100 kb Express default rejects as a 413. useBodyParser keeps the rawBody capture above.
  app.useBodyParser('json', { limit: '3mb' });
  app.useBodyParser('urlencoded', { limit: '3mb', extended: true });

  app.useLogger(app.get(Logger));
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');

  app.get(Logger).log(`ValueBooks API listening on http://localhost:${port}/api/v1`);
}

void bootstrap();
