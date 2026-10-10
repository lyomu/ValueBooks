import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateApiEnvironment } from '@valuebooks/config';

import { ObservabilityModule } from './common/logging/observability.module.js';
import { AutomationWorkerModule } from './automation/automation-worker.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DocumentExtractionWorkerModule } from './documents/document-extraction-worker.module.js';
import { JobsWorkerModule } from './jobs/jobs-worker.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateApiEnvironment }),
    ObservabilityModule,
    // @Global() only takes effect once the root imports it. Without this the worker process
    // crashed at boot (DomainEventsService could not resolve PrismaService), so no document
    // extraction, automation or scheduled job ever ran outside the API process.
    DatabaseModule,
    JobsWorkerModule,
    AutomationWorkerModule,
    DocumentExtractionWorkerModule,
  ],
})
export class WorkerAppModule {}
