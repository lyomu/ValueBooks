import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // CLI/migrations use the privileged, non-pooled role (was `directUrl`).
    // The restricted runtime role (`DATABASE_URL`) is wired into PrismaClient
    // via the @prisma/adapter-pg driver adapter in prisma.service.ts instead.
    url: env('DATABASE_MIGRATION_URL'),
  },
});
