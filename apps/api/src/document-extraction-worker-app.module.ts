import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateApiEnvironment } from '@valuebooks/config';

import { ObservabilityModule } from './common/logging/observability.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DocumentExtractionWorkerModule } from './documents/document-extraction-worker.module.js';

/**
 * The hostile-document worker deliberately does not load email, automation, HTTP controllers, or
 * tenant feature modules. Its restricted container therefore has the smallest practical runtime
 * surface: database, storage, ClamAV, Redis, OCR, and PDF rasterization only.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateApiEnvironment }),
    ObservabilityModule,
    DatabaseModule,
    DocumentExtractionWorkerModule,
  ],
})
export class DocumentExtractionWorkerAppModule {}
