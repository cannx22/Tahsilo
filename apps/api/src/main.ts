import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { RequestContext } from './common/request-context';

/**
 * Barındırma platformları (ör. Coolify) adresi şemasız ("tahsilo.firma.com") verebilir.
 * Dönüş adresleri ve CORS için tam URL gerekir: şema yoksa https eklenir, sondaki / atılır.
 */
export function normalizeUrlEnv(name: string) {
  const v = process.env[name]?.trim();
  if (!v) return;
  process.env[name] = (/^https?:\/\//.test(v) ? v : `https://${v}`).replace(/\/+$/, '');
}
normalizeUrlEnv('WEB_URL');
normalizeUrlEnv('API_URL');

/** Uygulama ve testler aynı yapılandırmayı kullanır. */
export function configureApp(app: INestApplication) {
  const express = app as NestExpressApplication;
  express.set('trust proxy', 1);
  app.use(helmet());
  app.use(cookieParser());
  // Her istek kendi bağlamında çalışır; AuthGuard tenant ve kullanıcıyı bu bağlama yazar.
  app.use((req: any, _res: any, next: () => void) =>
    RequestContext.run({ ip: req.ip, userAgent: req.headers['user-agent'] }, next),
  );
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: process.env.WEB_URL ?? 'http://localhost:3000', credentials: true });
  app.enableShutdownHooks();
  return app;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  configureApp(app);
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`Tahsilo API http://localhost:${port}/api/v1`);
}

if (require.main === module) void bootstrap();
