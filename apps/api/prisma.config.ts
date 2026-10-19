import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // CLI/migrations use the privileged, non-pooled role (was `directUrl`).
    // The restricted runtime role (`DATABASE_URL`) is wired into PrismaClient
    // via the @prisma/adapter-pg driver adapter in prisma.service.ts instead.
    //
    // `env()` throws at config-load time if the var is unset, for every CLI
    // invocation -- including `prisma generate`, which never needs a live
    // connection. The Docker build's `prisma generate` step runs before any
    // real DATABASE_MIGRATION_URL is injected, so fall back to an empty
    // string rather than the strict `env()` helper.
    url: process.env.DATABASE_MIGRATION_URL ?? '',
  },
});
