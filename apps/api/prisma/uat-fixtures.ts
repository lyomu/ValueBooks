import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from '../src/app.module.js';
import { UatFixtureSeedService } from '../src/uat-fixture-seed.service.js';

/**
 * Seeds the four §22.4 UAT fixtures that cannot be produced by clicking (F3, F4, F6, F7).
 * Local and staging only; the service refuses production and requires `ALLOW_UAT_FIXTURES=true`.
 */
async function seed(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  try {
    const summary = await app.get(UatFixtureSeedService).run();
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

void seed().catch((error: unknown) => {
  process.stderr.write(
    `UAT fixture seed failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
