import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { EntitlementsModule } from '../platform/entitlements.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { AsyncReportExportService } from './async-report-export.service.js';
import { ReportExportService } from './report-export.service.js';
import { ReportArtifactService } from './report-artifact.service.js';
import { ReportingController } from './reporting.controller.js';
import { ReportingService } from './reporting.service.js';

@Module({
  imports: [
    AuthModule,
    OrganizationsModule,
    SalesModule,
    EntitlementsModule,
    AutomationModule,
    StorageModule,
  ],
  controllers: [ReportingController],
  providers: [
    ReportingService,
    ReportExportService,
    ReportArtifactService,
    AsyncReportExportService,
  ],
  exports: [ReportingService, ReportExportService, ReportArtifactService, AsyncReportExportService],
})
export class ReportingModule {}
