import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { OPENAPI_COMMON_COMPONENTS, buildResourceOpenApi } from '@homeos/shared';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/errors';
import { SerializeInterceptor } from './common/serialize.interceptor';
import { loadConfig } from './config';

/** Middleware, filters and prefixes shared by the server and the integration tests. */
export function configureApp(app: INestApplication): void {
  const cfg = loadConfig();
  const express = app as NestExpressApplication;
  express.set('trust proxy', 1);
  express.useBodyParser('json', { limit: '6mb' });
  app.setGlobalPrefix('v1');
  // Files are served to the web origin, so the resource policy is set per response instead.
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(cookieParser());
  app.enableCors({ origin: cfg.webOrigins, credentials: true, allowedHeaders: ['Content-Type', 'Authorization', 'X-Household-Id'] });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new SerializeInterceptor());
}

/** Full OpenAPI document: routes found on controllers plus every registry resource. */
export function buildOpenApiDocument(app: INestApplication): Record<string, any> {
  const base = new DocumentBuilder()
    .setTitle('HomeOS API')
    .setDescription(
      [
        'REST API for HomeOS. The web app and mobile apps use exactly these endpoints.',
        '',
        '**Authentication.** `POST /v1/auth/login` returns an access token (15 minutes) and a refresh token. Send `Authorization: Bearer <accessToken>`. Exchange the refresh token at `POST /v1/auth/refresh`; each refresh token can be used once.',
        '',
        '**Households.** Household-scoped endpoints need the `X-Household-Id` header. `GET /v1/auth/me` lists the households, role and permissions of the signed-in user.',
        '',
        '**Errors.** `{ statusCode, code, message, issues? }` where `issues` lists invalid fields.',
        '',
        '**Records.** Every record type listed under its module supports list (search, filters, date range, sort, paging), get, and — unless read-only — create, partial update and soft delete.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .build();
  const doc: Record<string, any> = SwaggerModule.createDocument(app, base) as any;
  const resources = buildResourceOpenApi();
  doc.paths = { ...doc.paths, ...resources.paths };
  doc.components = {
    ...(doc.components ?? {}),
    securitySchemes: { ...(doc.components?.securitySchemes ?? {}), ...OPENAPI_COMMON_COMPONENTS.securitySchemes },
    parameters: { ...(doc.components?.parameters ?? {}), ...OPENAPI_COMMON_COMPONENTS.parameters },
    schemas: { ...(doc.components?.schemas ?? {}), ...OPENAPI_COMMON_COMPONENTS.schemas, ...resources.schemas },
  };
  const tagNames = new Set((doc.tags ?? []).map((t: any) => t.name));
  doc.tags = [...(doc.tags ?? []), ...resources.tags.filter((t) => !tagNames.has(t.name))];
  doc.security = [{ bearer: [] }];
  return doc;
}

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  configureApp(app);
  app.enableShutdownHooks();
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup('docs', app, document as any);
  app.getHttpAdapter().get('/openapi.json', (_req: any, res: any) => res.json(document));
  return app;
}
