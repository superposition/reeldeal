import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { seedDemoData } from './seed';

const directory = mkdtempSync(join(tmpdir(), 'reeldeal-smoke-'));
const dbPath = join(directory, 'demo.sqlite');
const database = new Database(dbPath, { create: true, strict: true });
database.exec(readFileSync(new URL('../apps/api/src/db/schema.sql', import.meta.url), 'utf8'));
await seedDemoData(database);
database.close();
const token = crypto.randomUUID() + crypto.randomUUID();
const root = resolve(import.meta.dir, '..');
const environment = { ...process.env, DB_PATH: dbPath, HOST: '127.0.0.1', PORT: '0', REELDEAL_SELLER_TOKEN: token };
// No token is persisted, printed or sent to a public service.
const server = Bun.spawn(['bun', 'apps/api/src/index.ts'], { cwd: root, env: environment, stdout: 'pipe', stderr: 'inherit' });
const reader = server.stdout.getReader();
let timer: ReturnType<typeof setTimeout> | undefined;
try {
  const origin = await Promise.race([
    (async () => {
      const decoder = new TextDecoder();
      let output = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) throw new Error('API exited before listening');
        output += decoder.decode(value, { stream: true });
        const match = output.match(/ReelDeal API listening on (http:\/\/127\.0\.0\.1:\d+)\//);
        if (match) return match[1];
      }
    })(),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Local smoke API startup timed out')), 10_000); }),
  ]);
  clearTimeout(timer);
  // Drain non-sensitive request logs so a long smoke cannot fill the stdout pipe.
  void (async () => { while (!(await reader.read()).done) { /* drain */ } })();
  const smoke = Bun.spawn(['bash', 'scripts/smoke.sh'], {
    cwd: root, env: { ...environment, API: `${origin}/v1` }, stdout: 'inherit', stderr: 'inherit',
  });
  if (await smoke.exited !== 0) throw new Error('Local smoke failed');
  const check = new Database(dbPath, { readonly: true });
  try {
    const sales = check.query('SELECT COUNT(*) AS n FROM sales').get() as { n: number };
    if (sales.n !== 1) throw new Error(`Expected one sale after competing accepts, got ${sales.n}`);
    console.log(`one-sale database invariant: OK; synthetic evidence retained at ${dbPath}`);
  } finally { check.close(); }
} finally {
  clearTimeout(timer);
  server.kill();
  await server.exited;
}
