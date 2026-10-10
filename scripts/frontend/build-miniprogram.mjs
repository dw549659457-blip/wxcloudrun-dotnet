import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from '../../apps/miniprogram/node_modules/esbuild/lib/main.js';
const root = fileURLToPath(new URL('../../apps/miniprogram/', import.meta.url));
const verification = process.argv.includes('--verification');
const source = `${root}src`;
const output = verification
  ? fileURLToPath(new URL('../../out/mini-verification/', import.meta.url)).replace(/\/$/, '')
  : `${root}miniprogram`;
const entryPoints = [];
async function copyTree(directory) {
  for (const entry of await readdir(directory)) {
    if (entry === 'local.ts') {
      continue;
    }
    const path = `${directory}/${entry}`;
    if ((await stat(path)).isDirectory()) {
      await copyTree(path);
    } else if (path.endsWith('.ts') && (entry === 'app.ts' || entry === 'index.ts')) {
      entryPoints.push(path);
    } else if (/\.(json|wxml|wxss|wxs)$/.test(path)) {
      const target = path.replace(source, output);
      await mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true });
      await cp(path, target);
    }
  }
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await copyTree(source);
await build({
  entryPoints,
  outbase: source,
  outdir: output,
  bundle: true,
  platform: 'neutral',
  format: 'cjs',
  target: 'es2018',
  tsconfig: `${root}tsconfig.json`,
  logLevel: 'warning',
  plugins: [
    {
      name: 'local-configuration',
      setup(builder) {
        builder.onResolve({ filter: /config\/settings$/ }, () => {
          if (verification) {
            return { path: 'verification-config', namespace: 'verification' };
          }
          const local = `${source}/config/local.ts`;
          if (existsSync(local)) {
            return { path: local };
          }
          return { path: `${source}/config/settings.ts` };
        });
        builder.onLoad({ filter: /.*/, namespace: 'verification' }, () => ({
          contents: `export const settings = { mode: 'local', envId: '', serviceName: 'dotnet-4jwm', apiBaseUrl: 'http://127.0.0.1:8182', administratorPhone: '', developmentLogin: true, businessUtcOffsetMinutes: 480 };`,
          loader: 'ts',
        }));
      },
    },
  ],
});
console.log(
  `${verification ? '仅本地接口验证包，禁止发布：' : '微信原生小程序已编译：'}${output}，在开发者工具导入 apps/miniprogram`,
);
