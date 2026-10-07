import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * The DB-backed suite. Requires the Compose PostgreSQL container to be running; the global setup
 * creates and migrates a dedicated `valuebooks_test` database.
 *
 * The SWC plugin is required rather than optional: Nest resolves constructor dependencies from
 * `emitDecoratorMetadata`, which vitest's default esbuild transform does not emit. Without it every
 * injected dependency arrives as `undefined`.
 *
 * Files run one at a time because every spec truncates the shared test database. Each file gets a
 * fresh worker process so Nest/Prisma metadata and fixture graphs are released between the large
 * integration suites instead of exhausting local developer memory during a full release gate.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.int.test.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    setupFiles: ['test/support/setup-env.ts'],
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { maxForks: 1, minForks: 1 } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
