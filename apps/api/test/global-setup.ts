import { execSync } from 'node:child_process';
import * as dotenv from 'dotenv';
import * as path from 'node:path';

/** Testler ayrı veritabanında çalışır; şema güncel değilse migration'lar uygulanır (veri silinmez). */
export default async function globalSetup() {
  dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL tanımlı değil (.env)');
  if (url === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL geliştirme veritabanıyla aynı olamaz');
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'ignore',
  });
}
