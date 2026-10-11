import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, relative } from 'node:path';
import { build } from '../../apps/miniprogram/node_modules/esbuild/lib/main.js';
const root = fileURLToPath(new URL('../../apps/miniprogram/', import.meta.url));
const verification = process.argv.includes('--verification');
const release = process.argv.includes('--release');
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
const options = {
  outbase: source,
  outdir: output,
  bundle: true,
  platform: 'neutral',
  format: 'cjs',
  target: 'es2018',
  tsconfig: `${root}tsconfig.json`,
  logLevel: 'warning',
};
if (!verification) {
  const local = `${source}/config/local.ts`;
  await build({
    ...options,
    entryPoints: {
      'config/runtime': !release && existsSync(local) ? local : `${source}/config/settings.ts`,
    },
  });
}
await Promise.all(
  entryPoints.map(async (entryPoint) => {
    let configurationPath = relative(dirname(entryPoint), `${source}/config/runtime.js`).replaceAll(
      '\\',
      '/',
    );
    if (!configurationPath.startsWith('.')) {
      configurationPath = `./${configurationPath}`;
    }
    await build({
      ...options,
      entryPoints: [entryPoint],
      plugins: [
        {
          name: 'local-configuration',
          setup(builder) {
            builder.onResolve({ filter: /config\/settings$/ }, () => {
              if (verification) {
                return { path: 'verification-config', namespace: 'verification' };
              }
              return { path: configurationPath, external: true };
            });
            builder.onLoad({ filter: /.*/, namespace: 'verification' }, () => ({
              contents: `export const settings = { mode: 'local', envId: '', serviceName: 'dotnet-4jwm', apiBaseUrl: 'http://127.0.0.1:8182', administratorPhone: '', developmentLogin: true, businessUtcOffsetMinutes: 480 };`,
              loader: 'ts',
            }));
          },
        },
      ],
    });
  }),
);
console.log(
  `${verification ? '仅本地接口验证包，禁止发布：' : '微信原生小程序已编译：'}${output}，在开发者工具导入 apps/miniprogram`,
);
