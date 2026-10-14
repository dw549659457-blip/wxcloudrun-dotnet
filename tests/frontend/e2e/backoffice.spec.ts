import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { adminLogin, actorRequest, employee } from './helpers';
const password = 'Accountant-browser-test-only-password';
async function createAccountant(request: APIRequestContext) {
  const admin = await employee(request, 'admin');
  const username = `accountant-${randomUUID()}`;
  const phone = '139' + String(Math.floor(Math.random() * 90000000) + 10000000);
  const result = await actorRequest<{ id: number }>(request, admin, 'post', '/api/users', {
    username,
    name: '浏览器后台管理员验证',
    phone,
    roles: ['ACCOUNTANT'],
    password,
    enabled: true,
  });
  return { username, id: result.id };
}
async function accountantLogin(page: Page, username: string, path: string) {
  await page.goto(path);
  await page.getByLabel('后台账号（管理员 / 后台管理员）').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '进入管理后台' }).click();
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
}
test('后台管理员默认只读与导出，越权请求及查询能由管理员筛选追溯', async ({
  page,
  request,
  browser,
}) => {
  const account = await createAccountant(request);
  await accountantLogin(page, account.username, '/admin/archives/growers');
  await expect(page.getByRole('button', { name: '新增棚户', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出全部 Excel', exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('growers.xlsx');
  const csrf = await page.evaluate(() => sessionStorage.getItem('warehouse:csrf') ?? '');
  const denied = await page.request.post('/api/growers', {
    data: { name: '后台管理员越权' },
    headers: { 'X-CSRF-Token': csrf },
  });
  expect(denied.status()).toBe(403);
  const requestId = denied.headers()['x-request-id'];
  await page.goto('/admin/permissions');
  await expect(page.getByText('当前账号没有此页面权限')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '后台管理员权限配置' })).toHaveCount(0);
  await page.goto('/admin/documents/stock-documents');
  await expect(page.getByRole('heading', { name: '库存入库与调整单据' })).toBeVisible();
  await expect(page.getByRole('button', { name: /新建/ })).toHaveCount(0);
  const context = await browser.newContext();
  try {
    const adminPage = await context.newPage();
    await adminLogin(adminPage, '/admin/audit');
    await adminPage.getByLabel('请求ID筛选').fill(requestId);
    await expect(adminPage.getByRole('cell', { name: /浏览器后台管理员验证/ })).toBeVisible();
    await expect(adminPage.getByText('403 失败', { exact: true })).toBeVisible();
    await adminPage.getByRole('button', { name: '查看操作' }).click();
    await expect(adminPage.getByRole('dialog').getByText('403 FORBIDDEN')).toBeVisible();
    await expect(
      adminPage.getByRole('dialog').getByText('POST /api/growers', { exact: true }),
    ).toBeVisible();
    await adminPage.keyboard.press('Escape');
    await expect(adminPage.getByRole('dialog')).toHaveCount(0);
    await adminPage.getByLabel('请求ID筛选').fill('');
    await adminPage.getByLabel('操作者ID', { exact: true }).fill(String(account.id));
    await expect(adminPage.getByRole('cell', { name: '查询', exact: true }).first()).toBeVisible();
    await expect(adminPage.getByRole('cell', { name: '导出', exact: true }).first()).toBeVisible();
  } finally {
    await context.close();
  }
});
test('管理员通过界面授予及撤销后台管理员业务权限，现有会话立即受控', async ({
  page,
  request,
  browser,
}) => {
  const account = await createAccountant(request);
  await adminLogin(page, '/admin/permissions');
  const context = await browser.newContext();
  try {
    const accounting = await context.newPage();
    await accountantLogin(accounting, account.username, '/admin/archives/growers');
    await expect(accounting.getByRole('button', { name: '新增棚户', exact: true })).toHaveCount(0);
    await page.getByRole('checkbox', { name: '新增、修改和停用', exact: true }).check();
    await page.getByLabel('权限调整原因').fill('财务临时维护档案');
    await page.getByRole('button', { name: '保存后台管理员权限' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '确认保存' }).click();
    await expect(
      page.getByText('后台管理员权限已更新，现有会话从下一次请求起使用新权限。'),
    ).toBeVisible();
    await accounting.reload();
    await accounting.getByRole('button', { name: '新增棚户', exact: true }).click();
    await accounting.getByLabel('名称', { exact: true }).fill('后台管理员获授权新增棚户');
    await accounting.getByRole('button', { name: '保存档案' }).click();
    await expect(
      accounting.getByRole('cell', { name: '后台管理员获授权新增棚户', exact: true }),
    ).toBeVisible();
    await page.getByRole('checkbox', { name: '新增、修改和停用', exact: true }).uncheck();
    await page.getByLabel('权限调整原因').fill('临时维护结束撤销写权限');
    const change = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        response.url().endsWith('/api/backoffice-permissions'),
    );
    await page.getByRole('button', { name: '保存后台管理员权限' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '确认保存' }).click();
    expect((await change).status()).toBe(200);
    const csrf = await accounting.evaluate(() => sessionStorage.getItem('warehouse:csrf') ?? '');
    const denied = await accounting.request.post('/api/growers', {
      data: { name: '撤权后不得新增' },
      headers: { 'X-CSRF-Token': csrf },
    });
    expect(denied.status()).toBe(403);
    await accounting.reload();
    await expect(accounting.getByRole('button', { name: '新增棚户', exact: true })).toHaveCount(0);
    await page.screenshot({ path: 'artifacts/frontend/permissions.png', fullPage: true });
  } finally {
    await context.close();
  }
});

test('后台管理员维护下级员工，后台岗位与密码保持受限', async ({ page, request }) => {
  const account = await createAccountant(request);
  await accountantLogin(page, account.username, '/admin/users');
  const ownRow = page.getByRole('row').filter({ hasText: account.username });
  await expect(ownRow.getByRole('button', { name: /^编\s*辑$/ })).toBeDisabled();
  await page.getByRole('button', { name: '新增员工', exact: true }).click();
  const modal = page.getByRole('dialog');
  await expect(modal.getByRole('checkbox', { name: '管理员', exact: true })).toHaveCount(0);
  await expect(modal.getByRole('checkbox', { name: '后台管理员', exact: true })).toHaveCount(0);
  await expect(modal.getByLabel(/后台密码/)).toHaveCount(0);
  const username = `staff-${randomUUID()}`;
  await modal.getByLabel('本人姓名 / 称呼').fill('后台管理员登记的员工');
  await modal.getByLabel('唯一账号').fill(username);
  await modal
    .getByLabel('本人手机号')
    .fill('139' + String(Math.floor(Math.random() * 90000000) + 10000000));
  await modal.getByRole('checkbox', { name: '司机', exact: true }).check();
  const creation = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/api/users'),
  );
  await modal.getByRole('button', { name: '保存员工' }).click();
  expect((await creation).status()).toBe(200);
  const row = page.getByRole('row').filter({ hasText: username });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /^编\s*辑$/ }).click();
  await modal.getByLabel('本人姓名 / 称呼').fill('后台管理员更新的员工');
  await modal.getByRole('checkbox', { name: '司机', exact: true }).uncheck();
  await modal.getByRole('checkbox', { name: '出库员', exact: true }).check();
  const update = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().includes('/api/users/'),
  );
  await modal.getByRole('button', { name: '保存员工' }).click();
  expect((await update).status()).toBe(200);
  await expect(row.getByText('后台管理员更新的员工')).toBeVisible();
  const csrf = await page.evaluate(() => sessionStorage.getItem('warehouse:csrf') ?? '');
  const denied = await page.request.post('/api/users', {
    headers: { 'X-CSRF-Token': csrf },
    data: {
      username: `forbidden-${randomUUID()}`,
      name: '越权后台账号',
      phone: '139' + String(Math.floor(Math.random() * 90000000) + 10000000),
      roles: ['ADMIN'],
      enabled: true,
      password,
    },
  });
  expect(denied.status()).toBe(403);
  await page.goto('/admin/bindings');
  await expect(page.getByRole('heading', { name: '员工开通协助', exact: true })).toBeVisible();
});
