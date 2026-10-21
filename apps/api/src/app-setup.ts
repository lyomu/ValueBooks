import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Applies the API's global HTTP configuration.
 *
 * Both the production bootstrap and the integration-test harness call this, so a test exercises the
 * same prefix, validation, error shaping, and origin rules that production serves.
 *
 * The global exception filter is not registered here: it needs dependency injection, so it is bound
 * through APP_FILTER in AppModule instead.
 */
export function allowedWebOrigins(environment: NodeJS.ProcessEnv = process.env): string[] {
  const candidates = [
    environment.WEB_APP_URL ?? 'http://localhost:3000',
    environment.MARKETING_SITE_URL,
    environment.CONSOLE_APP_URL,
  ];
  const origins = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    try {
      origins.add(new URL(candidate.trim()).origin);
    } catch {
      // Malformed values are rejected by environment validation at boot; never widen on them.
    }
  }
  return [...origins];
}

export function configureApp(app: INestApplication): void {
  const webOrigins = allowedWebOrigins();

  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: webOrigins,
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  });
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  app.use((request: Request, response: Response, next: NextFunction) => {
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const origin = request.get('origin');
    if (unsafe && origin && !webOrigins.includes(origin)) {
      response.status(403).json({
        error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This request origin is not allowed.' },
      });
      return;
    }
    next();
  });
}
