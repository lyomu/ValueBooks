import { Controller, Module, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { allowedWebOrigins, configureApp } from '../src/app-setup.js';

@Controller('probe')
class ProbeController {
  @Post()
  probe() {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('allowedWebOrigins', () => {
  it('normalizes and de-duplicates the configured web origins', () => {
    expect(
      allowedWebOrigins({
        WEB_APP_URL: 'https://next.valuebooks.co/',
        MARKETING_SITE_URL: 'https://valuebooks.co',
        CONSOLE_APP_URL: 'https://console.valuebooks.co',
      }),
    ).toEqual(['https://next.valuebooks.co', 'https://valuebooks.co', 'https://console.valuebooks.co']);

    expect(
      allowedWebOrigins({ WEB_APP_URL: 'https://valuebooks.co', MARKETING_SITE_URL: 'https://valuebooks.co/' }),
    ).toEqual(['https://valuebooks.co']);
  });

  it('falls back to the local web app and ignores empty or malformed values', () => {
    expect(allowedWebOrigins({ CONSOLE_APP_URL: '', MARKETING_SITE_URL: 'not a url' })).toEqual([
      'http://localhost:3000',
    ]);
  });
});

describe('configureApp origin rules', () => {
  let app: INestApplication;
  const previous = { ...process.env };

  beforeAll(async () => {
    process.env.WEB_APP_URL = 'https://next.valuebooks.co';
    process.env.MARKETING_SITE_URL = 'https://valuebooks.co';
    process.env.CONSOLE_APP_URL = 'https://console.valuebooks.co';
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env = previous;
  });

  it.each(['https://next.valuebooks.co', 'https://valuebooks.co', 'https://console.valuebooks.co'])(
    'accepts unsafe requests and echoes CORS for %s',
    async (origin) => {
      const response = await request(app.getHttpServer() as Server)
        .post('/api/v1/probe')
        .set('Origin', origin);
      expect(response.status).toBe(201);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    },
  );

  it('rejects unsafe requests from any other origin', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/api/v1/probe')
      .set('Origin', 'https://evil.example.com');
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'ORIGIN_NOT_ALLOWED' } });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
