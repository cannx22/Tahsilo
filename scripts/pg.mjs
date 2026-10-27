// Yerel geliştirme PostgreSQL'i (yönetici yetkisi gerektirmez).
// Kullanım: node scripts/pg.mjs start|stop|status
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = join(root, '.pgdata');
const log = join(root, '.pgdata.log');
const password = 'tahsilo_dev';
const exe = process.platform === 'win32' ? '.exe' : '';

function findBin() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const base = 'C:\\Program Files\\PostgreSQL';
  if (process.platform === 'win32' && existsSync(base)) {
    const versions = readdirSync(base).filter((v) => /^\d+$/.test(v)).sort((a, b) => b - a);
    if (versions.length) return join(base, versions[0], 'bin');
  }
  return ''; // PATH üzerinden
}

const bin = findBin();
const tool = (name) => (bin ? join(bin, name + exe) : name);
const run = (name, args, opts = {}) => spawnSync(tool(name), args, { stdio: 'inherit', ...opts });
const env = { ...process.env, PGPASSWORD: password };

const cmd = process.argv[2] ?? 'start';

if (cmd === 'start') {
  if (!existsSync(join(data, 'PG_VERSION'))) {
    console.log(`Veritabanı kümesi oluşturuluyor: ${data}`);
    const pw = join(tmpdir(), `tahsilo-pw-${process.pid}`);
    writeFileSync(pw, password);
    const r = run('initdb', ['-D', data, '-U', 'postgres', `--pwfile=${pw}`, '-A', 'scram-sha-256', '-E', 'UTF8', '--locale=C']);
    rmSync(pw);
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  const status = spawnSync(tool('pg_ctl'), ['-D', data, 'status'], { stdio: 'ignore' });
  if (status.status === 0) {
    console.log('PostgreSQL zaten çalışıyor.');
  } else {
    const r = run('pg_ctl', ['-D', data, '-l', log, '-o', '-p 5432', '-w', 'start']);
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  for (const db of ['tahsilo', 'tahsilo_test']) {
    const exists = execFileSync(tool('psql'), ['-U', 'postgres', '-h', 'localhost', '-tAc', `SELECT 1 FROM pg_database WHERE datname='${db}'`], { env })
      .toString()
      .trim();
    if (exists !== '1') {
      run('createdb', ['-U', 'postgres', '-h', 'localhost', db], { env });
      console.log(`Veritabanı oluşturuldu: ${db}`);
    }
  }
} else if (cmd === 'stop') {
  process.exit(run('pg_ctl', ['-D', data, '-w', 'stop']).status ?? 0);
} else if (cmd === 'status') {
  process.exit(run('pg_ctl', ['-D', data, 'status']).status ?? 0);
} else {
  console.error('Kullanım: node scripts/pg.mjs start|stop|status');
  process.exit(1);
}
