import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { DocumentExtractionWorkerAppModule } from './document-extraction-worker-app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(DocumentExtractionWorkerAppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('ValueBooks document extraction worker started');
}

void bootstrap();
