import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

// 检查实际发布文件；这里的 wx 替身不能代替微信开发者工具或真机验收。
export function verifyMiniprogram(projectDirectory) {
  const project = resolve(projectDirectory);
  const configuration = JSON.parse(readFileSync(`${project}/project.config.json`, 'utf8'));
  assert.equal(configuration.compileType, 'miniprogram');
  assert.equal(configuration.setting.urlCheck, true);
  const root = resolve(project, configuration.miniprogramRoot);
  const manifest = JSON.parse(readFileSync(`${root}/app.json`, 'utf8'));
  const files = [];
  function walk(directory) {
    for (const name of readdirSync(directory)) {
      const path = resolve(directory, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else {
        files.push(path);
      }
    }
  }
  walk(root);
  assert(
    files.every((path) => /\.(js|json|wxml|wxss|wxs)$/.test(path)),
    '包内含未编译资源',
  );
  for (const path of files.filter((path) => path.endsWith('.json'))) {
    JSON.parse(readFileSync(path, 'utf8'));
  }
  assert(existsSync(`${root}/${manifest.sitemapLocation}`));
  assert(existsSync(`${root}/app.wxss`));
  const bytes = files.reduce((sum, path) => sum + statSync(path).size, 0);
  assert(bytes < 2 * 1024 * 1024, '主包超过 2 MiB');

  function runtime(overrides = {}) {
    const cache = new Map();
    const state = { app: null, page: null, component: null, calls: [], redirects: [] };
    let response = { statusCode: 200, data: {} };
    const storage = new Map();
    const globals = {
      App: (value) => {
        state.app = value;
      },
      Page: (value) => {
        state.page = value;
      },
      Component: (value) => {
        state.component = value;
      },
      getApp: () => state.app,
      wx: {
        getStorageSync: (key) => storage.get(key),
        getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
        setStorageSync: (key, value) => storage.set(key, value),
        removeStorageSync: (key) => storage.delete(key),
        reLaunch: (options) => state.redirects.push(options.url),
        login: (options) => options.success({ code: 'verification-wechat-code' }),
        request: () => {
          throw new Error('正式包误用了本地 wx.request');
        },
        cloud: {
          init: (options) => state.calls.push({ init: options }),
          callContainer: async (options) => {
            state.calls.push(options);
            return response;
          },
        },
      },
      console,
      setTimeout,
      clearTimeout,
    };
    function load(path) {
      const fullPath = resolve(path);
      assert(!relative(root, fullPath).startsWith(`..${sep}`), 'require 超出小程序目录');
      if (cache.has(fullPath)) {
        return cache.get(fullPath).exports;
      }
      const module = { exports: {} };
      cache.set(fullPath, module);
      const require = (specifier) => {
        assert(specifier.startsWith('.'), `小程序仍依赖 npm 或 Node 模块：${specifier}`);
        const target = resolve(dirname(fullPath), specifier);
        return load(target.endsWith('.js') ? target : `${target}.js`);
      };
      runInNewContext(readFileSync(fullPath, 'utf8'), {
        ...globals,
        module,
        exports: module.exports,
        require,
      });
      if (fullPath === `${root}/config/runtime.js`) {
        Object.assign(module.exports.settings, overrides);
      }
      return module.exports;
    }
    return {
      state,
      load,
      respond: (value) => {
        response = value;
      },
    };
  }
  const native = runtime();
  native.load(`${root}/app.js`);
  const settings = native.load(`${root}/config/runtime.js`).settings;
  assert.equal(settings.mode, 'cloud', '交付包必须使用 cloud 模式');
  assert.equal(settings.developmentLogin, false, '交付包不能开启本地账号入口');
  assert.equal(settings.serviceName, 'dotnet-4jwm');
  const checkedComponents = new Set();
  function registration(path, component = false) {
    // 页面 WXSS 可省略，共用 app.wxss；组件自己的 WXSS 随构建复制。
    for (const extension of ['js', 'json', 'wxml']) {
      assert(existsSync(`${root}/${path}.${extension}`), `缺少 ${path}.${extension}`);
    }
    const metadata = JSON.parse(readFileSync(`${root}/${path}.json`, 'utf8'));
    native.state.page = null;
    native.state.component = null;
    native.load(`${root}/${path}.js`);
    const options = component ? native.state.component : native.state.page;
    assert(options, `${path} 没有注册 ${component ? 'Component' : 'Page'}`);
    const methods = component ? (options.methods ?? {}) : options;
    const template = readFileSync(`${root}/${path}.wxml`, 'utf8');
    for (const match of template.matchAll(
      /\b(?:bind|catch|capture-bind|capture-catch):?[a-z]+\s*=\s*["']([A-Za-z_$][\w$]*)["']/g,
    )) {
      assert.equal(typeof methods[match[1]], 'function', `${path} 缺少事件处理器 ${match[1]}`);
    }
    if (component) {
      assert.equal(metadata.component, true);
    }
    for (const value of Object.values(metadata.usingComponents ?? {})) {
      const target = value.startsWith('/')
        ? value.slice(1)
        : relative(root, resolve(root, dirname(path), value));
      if (!checkedComponents.has(target)) {
        checkedComponents.add(target);
        registration(target, true);
      }
    }
  }
  for (const page of manifest.pages) {
    registration(page);
  }
  assert.equal(manifest.pages.length, 14);
  assert.equal(checkedComponents.size, 2);
  return {
    project,
    root,
    bytes,
    pages: manifest.pages.length,
    components: checkedComponents.size,
    runtime,
  };
}

export async function verifyCloudSmoke(result) {
  // 非真实 envId；只验证发布代码从一个配置文件读取参数并调用官方 cloud 通道。
  const test = result.runtime({ envId: 'verification-env-not-real' });
  test.load(`${result.root}/app.js`);
  test.state.app.onLaunch();
  assert.equal(test.state.calls[0].init.env, 'verification-env-not-real');
  test.load(`${result.root}/pages/start/index.js`);
  const page = test.state.page;
  page.setData = (data) => Object.assign(page.data, data);
  assert.equal(page.data.development, false);
  test.respond({
    statusCode: 200,
    data: { userId: 1, name: '验证员工', roles: ['WORKER'], token: 'verification-only-token' },
  });
  await page.begin();
  const login = test.state.calls.at(-1);
  assert.equal(login.config.env, 'verification-env-not-real');
  assert.equal(login.header['X-WX-SERVICE'], 'dotnet-4jwm');
  assert.equal(login.path, '/api/auth/wechat-login');
  assert.equal(login.method, 'POST');
  assert.equal(JSON.parse(login.data).code, 'verification-wechat-code');
  assert.equal(test.state.redirects.at(-1), '/pages/home/index');
  test.respond({ statusCode: 401, data: { code: 'ACCOUNT_DISABLED', message: '验证账号已停用' } });
  await page.begin();
  assert.equal(test.state.calls.at(-1).header.Authorization, 'Bearer verification-only-token');
  assert(page.data.error.includes('验证账号已停用'));
  test.respond({ statusCode: 200, data: '<html>异常响应</html>' });
  await page.begin();
  assert(page.data.error.includes('登录服务返回'));
  test.respond({
    statusCode: 503,
    data: { code: 'WECHAT_NOT_CONFIGURED', message: '微信登录暂未配置，请联系管理员' },
  });
  await page.begin();
  assert.equal(page.data.error, '微信登录暂未配置，请联系管理员');
  const missing = result.runtime({ envId: '' });
  missing.load(`${result.root}/app.js`);
  missing.state.app.onLaunch();
  assert(missing.state.app.globalData.configurationError.includes('填写'));
  missing.load(`${result.root}/pages/start/index.js`);
  missing.state.page.setData = (data) => Object.assign(missing.state.page.data, data);
  missing.state.page.onLoad();
  assert(missing.state.page.data.error.includes('环境 ID'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyMiniprogram(process.argv[2] ?? 'apps/miniprogram');
  await verifyCloudSmoke(result);
  console.log(
    `通过：${result.pages} 页面、${result.components} 组件、事件绑定、云配置与登录通道/错误处理；主包 ${result.bytes} 字节。微信渲染与真实授权仍需开发者工具/真机。`,
  );
}
