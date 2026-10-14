import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { DomainEventsModule } from '../automation/domain-events.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';

@Module({
  imports: [AuthModule, OrganizationsModule, DomainEventsModule, BillingModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
