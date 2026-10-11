import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
const root = fileURLToPath(new URL('../../', import.meta.url));
const host = process.env.E2E_MYSQL_HOST ?? '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  throw new Error('前端自动测试只使用本机隔离 MySQL，禁止连接生产库');
}
const database = `vegetable_ui_${randomBytes(12).toString('hex')}`;
const password = randomBytes(24).toString('base64url');
const environment = {
  ...process.env,
  ASPNETCORE_ENVIRONMENT: 'Development',
  DEV_LOGIN_ENABLED: 'true',
  // 隔离端到端测试不向真实微信发送；实际模板载荷由HTTP替身用例验证。
  WECHAT_NOTIFICATION_TEMPLATE_ID: '',
  WECHAT_NOTIFICATION_FIELDS: '',
  MYSQL_HOST: host,
  MYSQL_PORT: process.env.E2E_MYSQL_PORT ?? '3306',
  MYSQL_USER: process.env.E2E_MYSQL_USER ?? 'root',
  MYSQL_PASSWORD: process.env.E2E_MYSQL_PASSWORD ?? '',
  MYSQL_DATABASE: database,
  MYSQL_SSL_MODE: 'Preferred',
  DEV_SEED_PASSWORD: password,
  PORT: '8182',
};
for (const name of ['MYSQL_ADDRESS', 'MYSQL_USERNAME', 'APP_COMMAND']) {
  delete environment[name];
}
const db = await mysql.createConnection({
  host,
  port: Number(environment.MYSQL_PORT),
  user: environment.MYSQL_USER,
  password: environment.MYSQL_PASSWORD,
});
await db.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
const state = `${root}out/e2e-state.json`;
await mkdir(`${root}out`, { recursive: true });
await writeFile(state, JSON.stringify({ password, database }), { mode: 0o600 });
const dll = `${root}out/api/aspnetapp.dll`;
async function command(commandName) {
  await new Promise((resolve, reject) => {
    const process = spawn('dotnet', [dll], {
      cwd: `${root}out/api`,
      env: { ...environment, APP_COMMAND: commandName },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let diagnostics = '';
    process.stdout.on('data', (chunk) => {
      diagnostics += chunk;
    });
    process.stderr.on('data', (chunk) => {
      diagnostics += chunk;
    });
    process.on('error', reject);
    process.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${commandName} 失败：${diagnostics}`)),
    );
  });
}
let server;
let stopping = false;
async function stop() {
  if (stopping) {
    return;
  }
  stopping = true;
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      server.once('exit', resolve);
      setTimeout(() => {
        server.kill('SIGKILL');
        resolve();
      }, 5000).unref();
    });
  }
  await db.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await db.end();
  await rm(state, { force: true });
}
process.on('SIGTERM', () => {
  void stop().then(() => process.exit(0));
});
process.on('SIGINT', () => {
  void stop().then(() => process.exit(0));
});
try {
  await readFile(dll);
  await command('migrate');
  await command('seed');
  server = spawn('dotnet', [dll], {
    cwd: `${root}out/api`,
    env: environment,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));
  server.on('error', (error) => {
    console.error(error.message);
    void stop().then(() => process.exit(1));
  });
  server.on('exit', (code) => {
    if (!stopping) {
      void stop().then(() => process.exit(code || 1));
    }
  });
} catch (error) {
  await stop();
  throw error;
}
