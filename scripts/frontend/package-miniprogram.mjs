import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { verifyMiniprogram, verifyCloudSmoke } from './verify-miniprogram.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const release = JSON.parse(
  await readFile(resolve(root, 'apps/miniprogram/src/release.json'), 'utf8'),
);
const output = resolve(root, 'out/miniprogram-delivery');
const project = resolve(output, 'vegetable-miniprogram');
const configuration = JSON.parse(
  await readFile(resolve(root, 'apps/miniprogram/project.config.json'), 'utf8'),
);
const appId = process.env.MINIPROGRAM_APP_ID ?? configuration.appid;
const envId = process.env.MINIPROGRAM_ENV_ID;
if (appId !== 'touristappid' && !/^wx[0-9a-f]{16}$/.test(appId)) {
  throw new Error('MINIPROGRAM_APP_ID 应为 wx 开头的真实小程序 AppID');
}
if (envId && !/^[A-Za-z0-9_-]+$/.test(envId)) {
  throw new Error('MINIPROGRAM_ENV_ID 应为控制台 config.env 中的环境 ID');
}
// 无论本机 local.ts 是否开启开发登录，交付都只从 cloud 默认配置生成。
execFileSync(process.execPath, ['scripts/frontend/build-miniprogram.mjs', '--release'], {
  cwd: root,
  stdio: 'inherit',
});
await rm(output, { recursive: true, force: true });
await mkdir(project, { recursive: true });
await cp(resolve(root, 'apps/miniprogram/miniprogram'), resolve(project, 'miniprogram'), {
  recursive: true,
});
configuration.appid = appId;
await writeFile(
  resolve(project, 'project.config.json'),
  `${JSON.stringify(configuration, null, 2)}\n`,
);
const module = { exports: {} };
runInNewContext(await readFile(resolve(project, 'miniprogram/config/runtime.js'), 'utf8'), {
  module,
  exports: module.exports,
});
const settings = {
  ...module.exports.settings,
  envId: envId ?? module.exports.settings.envId,
  mode: 'cloud',
  developmentLogin: false,
};
await writeFile(
  resolve(project, 'miniprogram/config/runtime.js'),
  `// 只改 envId（云托管环境 ID）与 administratorPhone（可选）。\n// 不填写数据库密码或 AppSecret；修改后在开发者工具点“编译”，不需要构建 npm。\nmodule.exports = {\n  settings: ${JSON.stringify(settings, null, 2)}\n};\n`,
);
await cp(resolve(root, 'docs/miniprogram-import.md'), resolve(project, 'README-导入说明.md'));
await cp(resolve(root, 'LICENSE'), resolve(project, 'LICENSE'));
if (release.version === '1.2.2') {
  await cp(
    resolve(root, 'docs/backoffice-role-hierarchy.md'),
    resolve(project, '后台管理员职级说明.md'),
  );
  await cp(
    resolve(root, 'deliverables/prelaunch-data-maintenance-1.2.2.xlsx'),
    resolve(project, '数据维护填写表.xlsx'),
  );
}
await cp(
  resolve(root, 'database/wechat-cloudrun-upgrade-006.sql'),
  resolve(project, '数据库升级006.sql'),
);
await cp(
  resolve(root, 'database/wechat-cloudrun-upgrade-005.sql'),
  resolve(project, '数据库升级005.sql'),
);
await cp(
  resolve(root, `docs/miniprogram-release-${release.version}.md`),
  resolve(project, '发布试上线说明.md'),
);
await writeFile(
  resolve(project, '微信验收清单.md'),
  (await readFile(resolve(root, 'docs/miniprogram-verification.md'), 'utf8')).replaceAll(
    '(miniprogram-import.md)',
    '(README-导入说明.md)',
  ),
);
await writeFile(
  resolve(project, '员工使用指引.md'),
  (await readFile(resolve(root, 'docs/employee-quickstart.md'), 'utf8')).replaceAll(
    '(miniprogram-verification.md)',
    '(微信验收清单.md)',
  ),
);
const result = verifyMiniprogram(project);
await verifyCloudSmoke(result);
const gitRevision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
await writeFile(
  resolve(project, '工程信息.json'),
  `${JSON.stringify(
    {
      sourceRepository: 'dw549659457-blip/wxcloudrun-dotnet',
      sourceRevision: gitRevision,
      deliveryVersion: release.version,
      description: release.description,
      builtAt: new Date().toISOString(),
      appIdConfigured: appId !== 'touristappid',
      envIdConfigured: Boolean(settings.envId),
      serviceName: settings.serviceName,
      mainPackageBytes: result.bytes,
      pages: result.pages,
      components: result.components,
      localChecks: ['JS/JSON/页面组件注册/事件绑定', 'cloud 配置读取及登录、错误处理（wx 替身）'],
      realWechatVerified: false,
    },
    null,
    2,
  )}\n`,
);
const archive = resolve(output, 'vegetable-miniprogram-import.zip');
// Python 标准库生成 ZIP，不需要额外安装打包依赖。
execFileSync(
  'python3',
  [
    '-c',
    'import shutil,sys; shutil.make_archive(sys.argv[1], "zip", sys.argv[2], sys.argv[3])',
    archive.slice(0, -4),
    output,
    'vegetable-miniprogram',
  ],
  { stdio: 'inherit' },
);
const sha256 = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex');
await writeFile(`${archive}.sha256`, `${sha256}  vegetable-miniprogram-import.zip\n`);
const versionedName = `vegetable-miniprogram-${release.version}.zip`;
await cp(archive, resolve(output, versionedName));
await writeFile(resolve(output, `${versionedName}.sha256`), `${sha256}  ${versionedName}\n`);
console.log(
  `可直接导入的工程：${archive}；主包 ${result.bytes} 字节，${result.pages} 页面 / ${result.components} 组件。`,
);
console.log(
  `AppID：${appId === 'touristappid' ? '待填写' : '已填写'}；envId：${settings.envId ? '已填写' : '待填写'}。真实微信验证需开发者工具与真机。`,
);
