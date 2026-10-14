import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { actorRequest, adminLogin, archive, choose, employee, testPassword } from './helpers';
import type {
  DocumentInput,
  SubmissionResult,
  PageResult,
  InventoryRow,
} from '../../../packages/contracts/src/types';
const businessDate = '2026-10-10';
test('深层管理路由可刷新；API 404 和非管理员权限仍由后台判定', async ({ page, request }) => {
  const response = await page.goto('/admin/reports/monthly-loss');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('button', { name: '进入管理后台' })).toBeVisible();
  const missing = await request.get('/api/no-such-api');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['content-type']).toContain('application/json');
  await page.getByLabel('后台账号（管理员 / 后台管理员）').fill('worker1');
  await page.getByLabel('密码', { exact: true }).fill(await testPassword());
  const denied = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/admin-login'),
  );
  await page.getByRole('button', { name: '进入管理后台' }).click();
  expect((await denied).status()).toBe(403);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: '退出登录' })).toHaveCount(0);
});
test('管理员从界面新增档案与期初库存，核对实物量及账本', async ({ page, request }) => {
  await adminLogin(page, '/admin/archives/growers');
  await page.getByRole('button', { name: '新增棚户' }).click();
  await page.getByLabel('名称', { exact: true }).fill('界面验证棚户');
  await page.getByRole('button', { name: '保存档案' }).click();
  await expect(page.getByRole('cell', { name: '界面验证棚户', exact: true })).toBeVisible();
  await page.goto('/admin/stock');
  await choose(page, page.getByLabel('品类 / 单位'), '泡沫箱 · 个 (个)');
  await page.getByLabel('本次数量（正数）').fill('1000');
  await page.getByRole('button', { name: '检查并提交' }).click();
  await expect(
    page
      .getByRole('dialog', { name: '确认库存变更' })
      .getByRole('cell', { name: '1000', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '确认记账', exact: true }).click();
  await expect(page.getByText(/库存已入账：STOCK-/)).toBeVisible();
  await page.goto('/admin/dashboard');
  await expect(page.getByRole('cell', { name: '1000', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '只读账本对账' }).click();
  await expect(page.getByRole('status')).toHaveText('余额与流水一致');
  const anonymous = await request.get('/api/inventory/packaging');
  expect(anonymous.status()).toBe(401);
});
test('新增员工不要求普通员工密码；角色与启用状态来自实际 API', async ({ page }) => {
  await adminLogin(page, '/admin/users');
  await page.getByRole('button', { name: '新增员工' }).click();
  await page.getByLabel('本人姓名 / 称呼').fill('前端验证装菜员');
  await page.getByLabel('唯一账号').fill('ui_worker');
  await page.getByLabel('本人手机号').fill('13912345678');
  await page.getByRole('button', { name: '保存员工' }).click();
  await expect(page.getByRole('cell', { name: '前端验证装菜员', exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /前端验证装菜员/ })).toContainText('装菜人员');
  await page.goto('/admin/bindings');
  await expect(
    page.locator('.ant-empty-description').filter({ hasText: '暂无数据' }),
  ).toBeVisible();
  await page.goto('/admin/audit');
  await page.getByRole('tab', { name: '业务变更明细' }).click();
  await expect(page.getByRole('cell', { name: '创建用户', exact: true })).toBeVisible();
});
test('提交已入库但两个响应丢失，刷新后使用原 key 确认且只入账一次', async ({ page, request }) => {
  const admin = await employee(request, 'admin');
  const id = await archive(request, admin, 'packaging-types', '网络验证包装', '个');
  await adminLogin(page, '/admin/stock');
  await choose(page, page.getByLabel('品类 / 单位'), '网络验证包装 · 个 (个)');
  await page.getByLabel('本次数量（正数）').fill('10');
  const keys: string[] = [];
  await page.route('**/api/stock-documents', async (route) => {
    keys.push(route.request().headers()['idempotency-key']);
    await route.fetch();
    await route.abort();
  });
  await page.route('**/api/submissions/status?**', (route) => route.abort());
  await page.getByRole('button', { name: '检查并提交' }).click();
  await page.getByRole('button', { name: '确认记账', exact: true }).click();
  await expect(
    page.getByText('暂时没查到结果。内容已保留，请用“确认原提交结果”继续，不要新建一笔。'),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText('有一笔待确认提交，先处理原提交')).toBeVisible();
  await page.unroute('**/api/stock-documents');
  await page.unroute('**/api/submissions/status?**');
  const retry = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/stock-documents'),
  );
  await page.getByRole('button', { name: '确认原提交结果', exact: true }).click();
  expect((await retry).headers()['idempotency-key']).toBe(keys[0]);
  await expect(page.getByText(/库存已入账：STOCK-/)).toBeVisible();
  const balances = await actorRequest<PageResult<InventoryRow>>(
    request,
    admin,
    'get',
    `/api/inventory/packaging?itemId=${id}`,
  );
  expect(balances.items[0].quantity).toBe('10');
});
test('草稿修改并提交、依赖拒绝链接、原子冲销重建均可从界面完成', async ({ page, request }) => {
  const admin = await employee(request, 'admin');
  const packId = await archive(request, admin, 'packaging-types', '修正验证包装', '个');
  const draft = await actorRequest<SubmissionResult>(
    request,
    admin,
    'post',
    '/api/stock-documents',
    {
      post: false,
      document: { businessDate, source: 'OPENING', items: [{ itemId: packId, quantity: '10' }] },
    },
  );
  await adminLogin(page, `/admin/documents/stock-documents?document=${draft.id}`);
  await page.getByRole('button', { name: '编辑草稿 / 提交' }).click();
  await page.getByLabel('本次数量（正数）').fill('12');
  await page.getByRole('button', { name: '检查并提交' }).click();
  await page.getByRole('button', { name: '确认记账', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认本次操作' })).toHaveCount(0);
  await page.goto(`/admin/documents/stock-documents?document=${draft.id}`);
  await page.getByRole('button', { name: '冲销并重建修正' }).click();
  await page.locator('textarea').first().fill('核实后修正期初');
  await page.getByLabel('本次数量（正数）').fill('20');
  await page.getByRole('button', { name: '检查并提交' }).click();
  await page.getByRole('button', { name: '确认记账', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认本次操作' })).toHaveCount(0);
  const balances = await actorRequest<PageResult<InventoryRow>>(
    request,
    admin,
    'get',
    `/api/inventory/packaging?itemId=${packId}`,
  );
  expect(balances.items[0].quantity).toBe('20');
  const driver = await employee(request, 'driver1');
  await actorRequest(request, driver, 'post', '/api/auth/select-role', { role: 'DRIVER' });
  const worker = await employee(request, 'worker1');
  await actorRequest(request, worker, 'post', '/api/auth/select-role', { role: 'WORKER' });
  const dispatch = await actorRequest<SubmissionResult>(
    request,
    driver,
    'post',
    '/api/dispatches',
    {
      post: true,
      document: { businessDate, items: [{ itemId: packId, growerId: 1, quantity: '10' }] },
    },
  );
  const batches = await actorRequest<PageResult<{ id: number; dispatchId: number }>>(
    request,
    driver,
    'get',
    '/api/batches',
  );
  const batchId = batches.items.find((batch) => batch.dispatchId === dispatch.id)?.id;
  expect(batchId).toBeTruthy();
  const work = await actorRequest<SubmissionResult>(request, worker, 'post', '/api/work-records', {
    post: true,
    document: {
      businessDate,
      batchId,
      items: [{ itemId: packId, quantity: '1' }],
      vegetables: [{ itemId: 7, quantity: '1' }],
    },
  });
  await page.goto(`/admin/documents/dispatches?document=${dispatch.id}`);
  await page.getByRole('button', { name: '冲销原单' }).click();
  await page.getByLabel('冲销原因').fill('验证依赖保护');
  await page.getByRole('button', { name: '确认冲销', exact: true }).click();
  await expect(page.getByRole('link', { name: work.number })).toBeVisible();
  await expect(page.getByText('先按逆序处理以下依赖单据')).toBeVisible();
});
test('日期品类筛选作用于全部 Excel，超过一页仍完整导出', async ({ page, request }) => {
  const admin = await employee(request, 'admin');
  const itemId = await archive(request, admin, 'packaging-types', '导出验证包装', '个');
  for (let index = 0; index < 21; index += 1) {
    const document: DocumentInput = {
      businessDate,
      source: 'OPENING',
      items: [{ itemId, quantity: '1' }],
      remark: `导出行${index}`,
    };
    await actorRequest(request, admin, 'post', '/api/stock-documents', { post: true, document });
  }
  await adminLogin(page, '/admin/reports/inventory-ledger');
  await choose(page, page.getByRole('combobox').nth(0), '导出验证包装 (个)');
  await expect(page.getByText('第 1 页 · 本页 20 条')).toBeVisible();
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeEnabled();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出全部筛选结果 Excel' }).click(),
  ]);
  const file = await download.path();
  expect(file).toBeTruthy();
  const contents = await readFile(file!);
  expect(contents.subarray(0, 2).toString()).toBe('PK');
  const count = Number(
    execFileSync(
      process.platform === 'win32' ? 'python' : 'python3',
      [
        '-c',
        'import zipfile,sys,xml.etree.ElementTree as E; z=zipfile.ZipFile(sys.argv[1]); r=E.fromstring(z.read("xl/worksheets/sheet2.xml")); print(len(r.findall("{*}sheetData/{*}row")))',
        file!,
      ],
      { encoding: 'utf8' },
    ),
  );
  expect(count).toBe(22);
  await mkdir('artifacts/frontend', { recursive: true });
  await page.screenshot({ path: 'artifacts/frontend/admin-ledger.png', fullPage: true });
});
test('常用桌面与窄屏登录页面正常显示', async ({ page }) => {
  for (const width of [320, 375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/admin/');
    await expect(page.getByRole('button', { name: '进入管理后台' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await adminLogin(page);
  await expect(page.getByRole('heading', { name: '仓库概览', exact: true })).toBeVisible();
  await expect(page.locator('.ant-spin-spinning')).toHaveCount(0);
  await mkdir('artifacts/frontend', { recursive: true });
  await page.screenshot({ path: 'artifacts/frontend/admin-dashboard.png', fullPage: true });
});
