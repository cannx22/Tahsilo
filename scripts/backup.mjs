// Veritabanı + şifreli belge deposu yedeği.
// Kullanım: node scripts/backup.mjs   (BACKUP_DIR, BACKUP_KEEP ortam değişkenleriyle özelleştirilebilir)
// Geri yükleme: docs/DEPLOYMENT.md → "Yedekten geri yükleme"
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((l) => /^\s*[A-Z_]+=/.test(l))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
      }),
  );
}

const env = { ...loadEnv(join(root, 'apps/api/.env')), ...process.env };
const dbUrl = env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL bulunamadı (apps/api/.env veya ortam değişkeni)');
  process.exit(1);
}

function pgDump() {
  if (env.PG_BIN) return join(env.PG_BIN, process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump');
  const base = 'C:\\Program Files\\PostgreSQL';
  if (process.platform === 'win32' && existsSync(base)) {
    const v = readdirSync(base).filter((x) => /^\d+$/.test(x)).sort((a, b) => b - a)[0];
    if (v) return join(base, v, 'bin', 'pg_dump.exe');
  }
  return 'pg_dump';
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = resolve(env.BACKUP_DIR ?? join(root, 'backups'));
const target = join(outDir, `tahsilo-${stamp}`);
mkdirSync(target, { recursive: true });

// Bağlantı adresindeki ?schema= parametresi pg_dump tarafından tanınmaz
const url = new URL(dbUrl);
url.searchParams.delete('schema');
const dump = spawnSync(pgDump(), ['--format=custom', '--no-owner', `--file=${join(target, 'database.dump')}`, url.toString()], { stdio: 'inherit' });
if (dump.status !== 0) {
  rmSync(target, { recursive: true, force: true });
  console.error('pg_dump başarısız oldu');
  process.exit(dump.status ?? 1);
}

// Belgeler diskte zaten şifrelidir (AES-256-GCM); ENCRYPTION_KEY yedeğe konmaz, ayrıca saklanmalıdır.
const storage = resolve(join(root, 'apps/api'), env.STORAGE_DIR ?? './storage');
if (existsSync(storage)) cpSync(storage, join(target, 'storage'), { recursive: true });

writeFileSync(
  join(target, 'manifest.json'),
  JSON.stringify({ createdAt: new Date().toISOString(), database: url.pathname.slice(1), storageIncluded: existsSync(storage) }, null, 2),
);

// Saklama: en yeni BACKUP_KEEP yedek tutulur
const keep = Number(env.BACKUP_KEEP ?? 14);
const all = readdirSync(outDir)
  .filter((d) => d.startsWith('tahsilo-') && statSync(join(outDir, d)).isDirectory())
  .sort()
  .reverse();
for (const old of all.slice(keep)) rmSync(join(outDir, old), { recursive: true, force: true });

console.log(`Yedek hazır: ${target}`);
console.log(`Saklanan yedek sayısı: ${Math.min(all.length, keep)}`);
