import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { RequestContext, secureCookies } from './common/request-context';

/**
 * Barındırma platformları (ör. Coolify) adresi şemasız ("tahsilo.firma.com") verebilir.
 * Dönüş adresleri, CORS ve çerezler için tam URL gerekir. Şema yoksa: geçici test alan adları
 * (sslip.io, nip.io), localhost ve IP adresleri http; gerçek alan adları https kabul edilir.
 */
export function toPublicUrl(value: string | undefined) {
  const v = value?.trim();
  if (!v) return undefined;
  if (/^https?:\/\//.test(v)) return v.replace(/\/+$/, '');
  const host = v.split('/')[0].split(':')[0];
  const plainHttp = /(\.sslip\.io|\.nip\.io)$/.test(host) || host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  return `${plainHttp ? 'http' : 'https'}://${v}`.replace(/\/+$/, '');
}

/** WEB_URL yoksa Coolify'ın verdiği adres (WEB_FQDN) kullanılır; API_URL verilmezse web adresiyle aynıdır (tek alan adı). */
export function resolvePublicUrls(env: NodeJS.ProcessEnv = process.env) {
  const web = toPublicUrl(env.WEB_URL) ?? toPublicUrl(env.WEB_FQDN);
  if (web) env.WEB_URL = web;
  const api = toPublicUrl(env.API_URL) ?? web;
  if (api) env.API_URL = api;
}
resolvePublicUrls();

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
  console.log(`Genel adres (WEB_URL): ${process.env.WEB_URL ?? 'tanımsız'} • güvenli çerez: ${secureCookies() ? 'evet' : 'hayır (HTTP)'}`);
  console.log(`Tahsilo API http://localhost:${port}/api/v1`);
}

if (require.main === module) void bootstrap();
