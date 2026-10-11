// 真实 WXML/WXSS 的浏览器排版映射，检查溢出和点击尺寸；不能替代微信渲染/真机键盘验收。
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { verifyMiniprogram } from './verify-miniprogram.mjs';

const project = verifyMiniprogram('apps/miniprogram');
const root = project.root;
const output = resolve('artifacts/miniprogram-ui');
await mkdir(output, { recursive: true });
await rm(`${output}/verification.json`, { force: true });
const styles = await readFile(`${root}/app.wxss`, 'utf8');
const components = {};
for (const name of ['quantity-row', 'summary-panel']) {
  components[name] = {
    template: await readFile(`${root}/components/${name}/index.wxml`, 'utf8'),
    css: await readFile(`${root}/components/${name}/index.wxss`, 'utf8'),
  };
}
const packaging = [
  { id: 1, name: '泡沫箱', unit: '个' },
  { id: 2, name: '周转筐', unit: '个' },
];
const vegetables = [
  { id: 3, name: '白菜', unit: '箱' },
  { id: 4, name: '西红柿', unit: '公斤' },
];
const batch = { packaging: [{ itemId: 1, name: '泡沫箱', unit: '个', outstanding: '30' }] };
const document = {
  businessDate: '2026-10-10',
  mode: 'FINAL',
  remark: '',
  lossReason: '损坏',
  differenceReason: '',
  items: [{ itemId: 1, quantity: '25' }],
  vegetables: [{ itemId: 3, quantity: '12' }],
};
const form = {
  loading: false,
  packaging,
  vegetables,
  batch,
  batchLabel: '王家棚户 · 2026-10-10 · 司机张师傅',
  document,
};
const posted = {
  document: {
    status: 'POSTED',
    input: document,
    number: 'RECOVERY-20261010-0000000000000123456789',
    customerName: '',
  },
  context: { growerName: '王家棚户' },
};
const scenarios = [
  ['start', 'start', {}],
  ['start-phone', 'start', { stage: 'PHONE' }],
  ['start-confirm', 'start', { stage: 'CONFIRM', candidate: '王师傅 · 司机' }],
  [
    'start-assist',
    'start',
    {
      stage: 'ASSIST',
      assistance: true,
      error: '手机号没有匹配到员工，请联系管理员核实姓名和岗位。',
    },
  ],
  [
    'start-waiting',
    'start',
    { stage: 'WAITING', notice: '已申请，请告诉管理员您的姓名。管理员核实后，查看结果。' },
  ],
  [
    'start-error',
    'start',
    { error: '未连接到云托管登录服务，请检查网络；管理员可检查小程序与云环境的关联权限。' },
  ],
  [
    'home-driver',
    'home',
    {
      name: '张师傅',
      role: 'DRIVER',
      roleName: '司机',
      loading: false,
      pendingCount: 3,
      pendingBatches: [
        { id: 1, growerName: '王家棚户', date: '2026-10-10' },
        { id: 2, growerName: '东村张家大棚（第二批次）', date: '2026-10-10' },
      ],
    },
  ],
  [
    'home-worker',
    'home',
    {
      name: '王阿姨',
      role: 'WORKER',
      roleName: '装菜人员',
      loading: false,
      pendingCount: 6,
      guided: true,
    },
  ],
  [
    'home-outbound',
    'home',
    { name: '李师傅', role: 'OUTBOUND', roleName: '出库员', loading: false },
  ],
  [
    'home-role',
    'home',
    {
      name: '王师傅',
      loading: false,
      selecting: true,
      roles: [
        { value: 'DRIVER', label: '司机' },
        { value: 'WORKER', label: '装菜人员' },
      ],
    },
  ],
  [
    'home-long',
    'home',
    {
      name: '用于检查较长姓名的员工名称',
      role: 'DRIVER',
      roleName: '司机',
      loading: false,
      pendingCount: 9999,
      pendingBatches: [
        { id: 1, growerName: '很长的棚户名称（用于检查小屏换行与按钮尺寸）', date: '2026-10-10' },
      ],
    },
  ],
  [
    'dispatch',
    'dispatch',
    {
      ...form,
      groups: [{ key: '1', growerName: '王家棚户', lines: [{ itemId: 1, quantity: '100' }] }],
    },
  ],
  [
    'work',
    'work',
    {
      ...form,
      document: {
        ...document,
        items: [{ itemId: 1, quantity: '70' }],
        vegetables: [{ itemId: 3, quantity: '12' }],
      },
    },
  ],
  ['recovery', 'recovery', form],
  [
    'recovery-confirm',
    'recovery',
    {
      ...form,
      confirming: true,
      summary: [
        { key: 'grower', label: '棚户', value: '王家棚户' },
        { key: 'pack', label: '本次回收 · 泡沫箱', value: '25 个' },
        { key: 'veg', label: '实收白菜', value: '12 箱' },
      ],
      lossRows: [{ key: 'loss', label: '泡沫箱', value: '本次损耗 5 个' }],
    },
  ],
  [
    'outbound',
    'outbound',
    {
      ...form,
      customerName: '东村蔬菜配送中心',
      inventory: [{ id: 3, name: '白菜', quantity: '12', unit: '箱' }],
      document: {
        ...document,
        mode: 'DIRECT',
        items: [{ itemId: 4, quantity: '1234.567' }],
        remark: '本批次场内临时交付',
      },
    },
  ],
  [
    'outbound-pending',
    'outbound',
    {
      ...form,
      pending: true,
      locked: true,
      customerName: '东村蔬菜配送中心',
      notice: '暂时没有确认结果，请继续确认原提交。',
    },
  ],
  [
    'batches',
    'batches',
    {
      loading: false,
      rows: [
        {
          id: 1,
          growerName: '东村王家大棚（第二批次）',
          date: '2026-10-10',
          driverName: '张师傅',
          status: 'OPEN',
          statusText: '还没收完',
          packagingText: '泡沫箱 100 个 · 周转筐 50 个',
        },
      ],
      page: 999,
    },
  ],
  [
    'records',
    'records',
    {
      title: '派发',
      from: '2026-10-01',
      to: '2026-10-10',
      rows: [
        {
          id: 1,
          input: document,
          status: 'POSTED',
          statusText: '已记账',
          creatorName: '张师傅',
          number: 'DISPATCH-20261010-123456789012345678901234567890',
          createdText: '2026-10-10 12:00:00',
          postedText: '2026-10-10 12:02:00',
        },
      ],
    },
  ],
  [
    'inventory',
    'inventory',
    {
      rows: [
        {
          id: 1,
          name: '西红柿（用于检查较长的品类名称）',
          quantity: '999999999999999.999',
          unit: '公斤',
          enabled: true,
        },
        { id: 2, name: '白菜', quantity: '8', unit: '箱', enabled: false },
      ],
    },
  ],
  [
    'detail',
    'detail',
    {
      loading: false,
      detail: posted,
      success: true,
      creator: '张师傅',
      created: '2026-10-10 12:00:00',
      posted: '2026-10-10 12:02:00',
      statusText: '已记账',
      lines: [
        { key: '1', label: '本次空包装回收 · 泡沫箱', quantity: '25', unit: '个' },
        { key: '2', label: '实收到仓 · 白菜', quantity: '12', unit: '箱' },
      ],
    },
  ],
  [
    'profile',
    'profile',
    {
      name: '张师傅',
      role: 'DRIVER',
      roles: [
        { value: 'DRIVER', label: '司机' },
        { value: 'WORKER', label: '装菜人员' },
      ],
    },
  ],
  ['help', 'help', { role: 'WORKER', roleName: '装菜人员' }],
  ['empty-batches', 'batches', {}],
  ['empty-records', 'records', { title: '派发' }],
];
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
    (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  headless: true,
});
const checks = [];
try {
  const page = await browser.newPage();
  for (const [width, scale] of [
    [320, 1],
    [375, 1],
    [430, 1],
    [320, 1.25],
  ]) {
    await page.setViewportSize({ width, height: 820 });
    for (const [name, pageName, overrides] of scenarios) {
      const native = project.runtime();
      native.load(`${root}/app.js`);
      native.load(`${root}/pages/${pageName}/index.js`);
      const data = { ...native.state.page.data, ...overrides };
      const pageCss = existsSync(`${root}/pages/${pageName}/index.wxss`)
        ? await readFile(`${root}/pages/${pageName}/index.wxss`, 'utf8')
        : '';
      const metadata = JSON.parse(await readFile(`${root}/pages/${pageName}/index.json`, 'utf8'));
      await page.setContent(
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><header id="nav"></header><main id="root"></main></body></html>',
      );
      const metrics = await page.evaluate(
        ({ template, data, styles, pageCss, components, scale, navigationTitle }) => {
          const base =
            'body{margin:0}#nav{padding:14px 16px;background:#176747;color:white;text-align:center;font-size:20px}view,picker,quantity-row,summary-panel{display:block}text{display:inline}button{border:0;font-family:inherit;position:relative}button::after{content:"";position:absolute;inset:0;pointer-events:none}input,textarea{font-family:inherit}*{box-sizing:border-box}';
          const style = document.createElement('style');
          style.textContent = base + styles.replace(/^page\s*\{/gm, 'body {') + pageCss;
          document.head.append(style);
          document.getElementById('nav').textContent = navigationTitle;
          function expression(source, scope) {
            // 仅执行本仓库模板表达式和固定测试数据；不接受远程模板或输入。
            return new Function('scope', `with (scope) { return (${source}); }`)(scope);
          }
          function interpolate(source, scope) {
            return source.replace(/\{\{([\s\S]*?)\}\}/g, (_, code) =>
              String(expression(code, scope) ?? ''),
            );
          }
          function parse(template) {
            const xml = template
              .replace(/&(?!amp;|lt;|gt;|quot;|apos;)/g, '&amp;')
              .replace(/(["'])(.*?)\1/g, (match) => match.replace(/</g, '&lt;'));
            const tree = new DOMParser().parseFromString(
              `<root xmlns:wx="urn:wechat">${xml}</root>`,
              'application/xml',
            );
            if (tree.querySelector('parsererror')) {
              throw new Error(tree.querySelector('parsererror').textContent);
            }
            return tree.documentElement;
          }
          function render(node, scope, parent) {
            if (node.nodeType === Node.TEXT_NODE) {
              parent.append(document.createTextNode(interpolate(node.textContent, scope)));
              return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) {
              return;
            }
            if (node.hasAttribute('wx:for')) {
              const items =
                expression(node.getAttribute('wx:for').replace(/^\{\{|\}\}$/g, ''), scope) ?? [];
              for (let index = 0; index < items.length; index++) {
                const clone = node.cloneNode(true);
                clone.removeAttribute('wx:for');
                render(
                  clone,
                  {
                    ...scope,
                    [node.getAttribute('wx:for-item') ?? 'item']: items[index],
                    [node.getAttribute('wx:for-index') ?? 'index']: index,
                  },
                  parent,
                );
              }
              return;
            }
            if (
              node.hasAttribute('wx:if') &&
              !expression(node.getAttribute('wx:if').replace(/^\{\{|\}\}$/g, ''), scope)
            ) {
              return;
            }
            if (components[node.tagName]) {
              const host = document.createElement(node.tagName);
              parent.append(host);
              const shadow = host.attachShadow({ mode: 'open' });
              const properties = {};
              for (const attribute of node.attributes) {
                properties[attribute.name] = /^\{\{[\s\S]*\}\}$/.test(attribute.value)
                  ? expression(attribute.value.slice(2, -2), scope)
                  : attribute.value;
              }
              const selected = (properties.options ?? []).find(
                (item) => item.id === properties.value?.itemId,
              );
              const componentScope = {
                title: '确认本次记录',
                rows: [],
                value: {},
                ...properties,
                selectedName: selected?.name ?? '',
                selectedUnit: selected?.unit ?? '',
                inputType: selected?.unit === '公斤' ? 'digit' : 'number',
              };
              const localStyle = document.createElement('style');
              localStyle.textContent =
                ':host{display:block;width:100%;min-width:0}view{display:block}text{display:inline}button,input{font:inherit;border:0;box-sizing:border-box}button{position:relative}button::after{content:"";position:absolute;inset:0;pointer-events:none}button{line-height:1.5}' +
                components[node.tagName].css;
              shadow.append(localStyle);
              for (const child of parse(components[node.tagName].template).childNodes) {
                render(child, componentScope, shadow);
              }
              return;
            }
            const element = document.createElement(node.tagName);
            for (const attribute of node.attributes) {
              if (/^(wx:|bind|catch)/.test(attribute.name)) {
                continue;
              }
              const value = interpolate(attribute.value, scope);
              if (['disabled', 'loading'].includes(attribute.name) && value !== 'true') {
                continue;
              }
              element.setAttribute(attribute.name, value);
            }
            parent.append(element);
            for (const child of node.childNodes) {
              render(child, scope, element);
            }
          }
          for (const child of parse(template).childNodes) {
            render(child, data, document.getElementById('root'));
          }
          function collect(root) {
            return [...root.querySelectorAll('*')].flatMap((item) => [
              item,
              ...(item.shadowRoot ? collect(item.shadowRoot) : []),
            ]);
          }
          const elements = collect(document);
          if (scale !== 1) {
            const sizes = elements.map((element) => [
              element,
              parseFloat(getComputedStyle(element).fontSize),
            ]);
            for (const [element, size] of sizes) {
              element.style.fontSize = `${size * scale}px`;
            }
          }
          const visible = elements.filter(
            (element) =>
              !['STYLE', 'HEAD', 'META', 'HTML', 'BODY', 'MAIN', 'HEADER'].includes(
                element.tagName,
              ) && element.getBoundingClientRect().height > 0,
          );
          const outside = visible
            .filter((element) => {
              const r = element.getBoundingClientRect();
              return r.left < -1 || r.right > innerWidth + 1;
            })
            .map((element) => ({
              tag: element.tagName,
              class: element.className,
              text: element.textContent.slice(0, 70),
              width: element.getBoundingClientRect().width,
            }));
          const smallButtons = visible
            .filter(
              (element) =>
                element.tagName === 'BUTTON' && element.getBoundingClientRect().height < 47,
            )
            .map((element) => element.textContent);
          const quantityInputs = visible
            .filter(
              (element) =>
                element.tagName === 'INPUT' && element.getAttribute('aria-label') === '本次数量',
            )
            .map((element) => element.getBoundingClientRect().width);
          const start = visible.find(
            (element) => element.tagName === 'BUTTON' && element.textContent.trim() === '开始使用',
          );
          return {
            scrollWidth: document.documentElement.scrollWidth,
            outside,
            smallButtons,
            quantityInputs,
            startBottom: start?.getBoundingClientRect().bottom,
          };
        },
        {
          template: await readFile(`${root}/pages/${pageName}/index.wxml`, 'utf8'),
          data,
          styles,
          pageCss,
          components,
          scale,
          navigationTitle: metadata.navigationBarTitleText ?? '棚户记账',
        },
      );
      assert(
        metrics.scrollWidth <= width + 1,
        `${name}/${width}/${scale} 页面水平溢出：${metrics.scrollWidth}`,
      );
      assert.deepEqual(metrics.outside, [], `${name}/${width}/${scale} 内容超出屏幕`);
      assert.deepEqual(metrics.smallButtons, [], `${name}/${width}/${scale} 按钮小于48px`);
      assert(
        metrics.quantityInputs.every((size) => size >= 80),
        `${name}/${width}/${scale} 数量输入框过窄`,
      );
      if (name === 'start') {
        if (metrics.startBottom >= 640) {
          await page.screenshot({
            path: `${output}/start-overflow-${width}-${scale}.png`,
            fullPage: true,
          });
        }
        assert(
          metrics.startBottom < 640,
          `开始使用按钮应在初始屏幕可见：${width}/${scale}，底部${metrics.startBottom}`,
        );
      }
      checks.push({ name, width, scale, passed: true });
      if (
        width === 375 &&
        scale === 1 &&
        ['start', 'home-driver', 'work', 'recovery-confirm', 'inventory', 'profile'].includes(name)
      ) {
        await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
      }
    }
  }
} finally {
  await browser.close();
}
await writeFile(
  `${output}/verification.json`,
  JSON.stringify({ kind: 'WXML/WXSS browser layout projection; not real WeChat', checks }, null, 2),
);
console.log(
  `浏览器排版映射通过 ${checks.length} 个场景（320/375/430宽，320宽文字放大125%）。截图：${output}；微信真机仍需验收。`,
);
