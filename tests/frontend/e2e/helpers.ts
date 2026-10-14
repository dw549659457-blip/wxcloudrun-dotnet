import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { EmployeeSession } from '../../../packages/contracts/src/types';
export async function testPassword(): Promise<string> {
  const state: { password: string } = JSON.parse(await readFile('out/e2e-state.json', 'utf8'));
  return state.password;
}
export async function adminLogin(page: Page, path = '/admin/dashboard') {
  await page.goto(path);
  await page.getByLabel('后台账号（管理员 / 后台管理员）').fill('admin');
  await page.getByLabel('密码', { exact: true }).fill(await testPassword());
  await page.getByRole('button', { name: '进入管理后台' }).click();
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
}
export async function employee(
  request: APIRequestContext,
  username: string,
): Promise<EmployeeSession> {
  const response = await request.post('/api/auth/dev-login', {
    data: { username, password: await testPassword() },
  });
  expect(response.status()).toBe(200);
  return response.json();
}
export async function actorRequest<T>(
  request: APIRequestContext,
  actor: EmployeeSession,
  method: 'get' | 'post',
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await request[method](path, {
    data,
    headers: { Authorization: `Bearer ${actor.token}`, 'Idempotency-Key': randomUUID() },
  });
  expect(response.status(), `${method} ${path}`).toBeGreaterThanOrEqual(200);
  expect(response.status(), `${method} ${path}`).toBeLessThan(300);
  return response.status() === 204 ? (undefined as T) : response.json();
}
export async function archive(
  request: APIRequestContext,
  admin: EmployeeSession,
  resource: string,
  name: string,
  unit = '',
): Promise<number> {
  const value = await actorRequest<{ id: number }>(request, admin, 'post', `/api/${resource}`, {
    name,
    unit,
    specification: '',
    contact: '',
    phone: '',
    enabled: true,
  });
  return value.id;
}
export async function choose(page: Page, input: ReturnType<Page['getByRole']>, label: string) {
  await input.click();
  await page.locator('.ant-select-dropdown:visible').getByText(label, { exact: true }).click();
}
