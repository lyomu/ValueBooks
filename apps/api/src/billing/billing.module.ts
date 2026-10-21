import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { BillingController } from './billing.controller.js';
import { BillingMailerService } from './billing-mailer.service.js';
import { BillingNotificationService } from './billing-notification.service.js';
import { BillingMaintenanceService } from './billing-maintenance.service.js';
import { BillingService } from './billing.service.js';
import { BillingWebhookController } from './billing-webhook.controller.js';
import { BillingWebhookService } from './billing-webhook.service.js';
import { PaystackBillingAdapter } from './paystack-billing.adapter.js';
import { TrialLifecycleService } from './trial-lifecycle.service.js';
import { UsageMeteringService } from './usage-metering.service.js';
@Module({
  imports: [AuthModule, JobsModule, forwardRef(() => AutomationModule)],
  controllers: [BillingController, BillingWebhookController],
  providers: [
    BillingService,
    UsageMeteringService,
    PaystackBillingAdapter,
    BillingWebhookService,
    BillingMailerService,
    BillingNotificationService,
    BillingMaintenanceService,
    TrialLifecycleService,
  ],
  exports: [
    BillingService,
    UsageMeteringService,
    PaystackBillingAdapter,
    TrialLifecycleService,
    BillingWebhookService,
    BillingNotificationService,
    BillingMaintenanceService,
  ],
})
export class BillingModule {}
