import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { actorRequest, archive, employee } from './helpers';
import type { DocumentFormState } from '../../../apps/miniprogram/src/services/document-page';
import type { SubmissionTicket } from '../../../packages/contracts/src/submission';
import type {
  EmployeeSession,
  PageResult,
  Batch,
  InventoryRow,
} from '../../../packages/contracts/src/types';
interface NativePage {
  data: DocumentFormState;
  onLoad(query: Record<string, string>): Promise<void>;
  preview(): Promise<void>;
  submit(): Promise<void>;
  setData(value: Partial<DocumentFormState>): void;
  chooseGrower(event: {
    detail: { value: string };
    currentTarget: { dataset: { group: number } };
  }): void;
  chooseCustomer(event: { detail: { value: string } }): void;
  chooseMode(event: { currentTarget: { dataset: { mode: string } } }): void;
  lineChange(event: {
    detail: { index: number; line: { itemId: number; quantity: string } };
    currentTarget: { dataset: { group?: number; section?: string } };
  }): void;
  field(event: { detail: { value: string }; currentTarget: { dataset: { field: string } } }): void;
}
interface RequestOptions {
  url: string;
  method: string;
  header: Record<string, string>;
  data?: string;
  success(response: { statusCode: number; data: unknown }): void;
  fail(): void;
}
// 原生 Page 的控制器和 wx.request 适配器调用真实 C# + MySQL；微信设备和手机号授权另需真实环境验收。
class NativeRuntime {
  storage = new Map<string, unknown>();
  session: EmployeeSession | null = null;
  redirects: string[] = [];
  keys: string[] = [];
  dropNextOutboundResponse = false;
  dropStatus = false;
  wx = {
    getStorageInfoSync: () => ({ keys: [...this.storage.keys()] }),
    getStorageSync: (key: string) => this.storage.get(key),
    setStorageSync: (key: string, value: unknown) => this.storage.set(key, value),
    removeStorageSync: (key: string) => this.storage.delete(key),
    enableAlertBeforeUnload: () => undefined,
    disableAlertBeforeUnload: () => undefined,
    pageScrollTo: () => undefined,
    showModal: (options: { success(choice: { confirm: boolean; cancel: boolean }): void }) =>
      options.success({ confirm: true, cancel: false }),
    navigateBack: () => undefined,
    navigateTo: (options: { url: string }) => this.redirects.push(options.url),
    redirectTo: (options: { url: string }) => this.redirects.push(options.url),
    reLaunch: (options: { url: string }) => this.redirects.push(options.url),
    request: (options: RequestOptions) => {
      void (async () => {
        try {
          const path = new URL(options.url).pathname;
          if (path === '/api/submissions/status' && this.dropStatus) {
            options.fail();
            return;
          }
          if (path === '/api/outbounds' && options.method === 'POST') {
            this.keys.push(options.header['Idempotency-Key']);
          }
          const response = await fetch(options.url, {
            method: options.method,
            headers: options.header,
            body: options.data,
          });
          const text = await response.text();
          if (
            path === '/api/outbounds' &&
            options.method === 'POST' &&
            this.dropNextOutboundResponse
          ) {
            this.dropNextOutboundResponse = false;
            options.fail();
            return;
          }
          options.success({ statusCode: response.status, data: text });
        } catch {
          options.fail();
        }
      })();
    },
  };
  async load(
    name: string,
    session: EmployeeSession,
    query: Record<string, string> = {},
  ): Promise<NativePage> {
    this.session = session;
    let captured: unknown;
    runInNewContext(await readFile(`out/mini-verification/pages/${name}/index.js`, 'utf8'), {
      wx: this.wx,
      getApp: () => ({
        globalData: {
          get session() {
            return session;
          },
          set session(value: EmployeeSession) {
            session = value;
          },
          bindingToken: '',
        },
      }),
      Page: (options: unknown) => {
        captured = options;
      },
      console,
      setTimeout,
      clearTimeout,
    });
    const page = captured as NativePage;
    page.data = structuredClone(page.data);
    page.setData = (value) => {
      Object.assign(page.data, value);
    };
    await page.onLoad(query);
    expect(page.data.error, `${name} load`).toBe('');
    return page;
  }
}
test('原生页面执行1000→派发100→消耗70→回收25损耗5；12箱出库后8箱，弱网重试不重扣', async ({
  request,
}) => {
  const admin = await employee(request, 'admin');
  const growerId = await archive(request, admin, 'growers', '原生验证棚户');
  const customerId = await archive(request, admin, 'customers', '原生验证客户');
  const packId = await archive(request, admin, 'packaging-types', '原生泡沫箱', '个');
  const veggieId = await archive(request, admin, 'vegetable-types', '原生白菜', '箱');
  await actorRequest(request, admin, 'post', '/api/stock-documents', {
    post: true,
    document: {
      businessDate: '2026-10-10',
      source: 'OPENING',
      items: [{ itemId: packId, quantity: '1000' }],
    },
  });
  const driver = await employee(request, 'driver1');
  const worker = await employee(request, 'worker1');
  const outbound = await employee(request, 'outbound1');
  for (const [actor, role] of [
    [driver, 'DRIVER'],
    [worker, 'WORKER'],
    [outbound, 'OUTBOUND'],
  ] as const) {
    await actorRequest(request, actor, 'post', '/api/auth/select-role', { role });
    actor.selectedRole = role;
  }
  const runtime = new NativeRuntime();
  const dispatch = await runtime.load('dispatch', driver);
  dispatch.chooseGrower({
    detail: { value: String(dispatch.data.growers.findIndex((item) => item.id === growerId)) },
    currentTarget: { dataset: { group: 0 } },
  });
  dispatch.lineChange({
    detail: { index: 0, line: { itemId: packId, quantity: '100' } },
    currentTarget: { dataset: { group: 0 } },
  });
  await dispatch.preview();
  expect(dispatch.data.confirming).toBe(true);
  expect(dispatch.data.summary.some((row) => row.value === '100 个')).toBe(true);
  await dispatch.submit();
  expect(runtime.redirects.at(-1)).toContain('success=1');
  const batches = await actorRequest<PageResult<Batch>>(
    request,
    driver,
    'get',
    `/api/batches?growerId=${growerId}`,
  );
  const batchId = batches.items[0].id;
  const work = await runtime.load('work', worker, { batchId: String(batchId) });
  expect(work.data.packaging.map((item) => item.id)).toEqual([packId]);
  work.lineChange({
    detail: { index: 0, line: { itemId: packId, quantity: '70' } },
    currentTarget: { dataset: {} },
  });
  work.lineChange({
    detail: { index: 0, line: { itemId: veggieId, quantity: '12' } },
    currentTarget: { dataset: { section: 'vegetables' } },
  });
  await work.preview();
  expect(work.data.confirming, work.data.error).toBe(true);
  await work.submit();
  const recovery = await runtime.load('recovery', driver, { batchId: String(batchId) });
  expect(recovery.data.document.mode).toBe('');
  recovery.chooseMode({ currentTarget: { dataset: { mode: 'FINAL' } } });
  recovery.lineChange({
    detail: { index: 0, line: { itemId: packId, quantity: '25' } },
    currentTarget: { dataset: {} },
  });
  recovery.setData({
    document: {
      ...recovery.data.document,
      vegetables: [{ itemId: veggieId, quantity: '12' }],
      lossReason: '损坏',
    },
  });
  await recovery.preview();
  expect(recovery.data.confirming, recovery.data.error).toBe(true);
  expect(recovery.data.lossRows[0].value).toBe('本次损耗 5 个');
  await recovery.submit();
  const normal = await runtime.load('outbound', outbound);
  normal.chooseCustomer({
    detail: { value: String(normal.data.customers.findIndex((item) => item.id === customerId)) },
  });
  normal.lineChange({
    detail: { index: 0, line: { itemId: veggieId, quantity: '3' } },
    currentTarget: { dataset: {} },
  });
  await normal.preview();
  expect(normal.data.confirming, normal.data.error).toBe(true);
  await normal.submit();
  const direct = await runtime.load('outbound', outbound, { mode: 'DIRECT' });
  expect(direct.data.document.items[0].quantity).toBe('');
  direct.chooseCustomer({
    detail: { value: String(direct.data.customers.findIndex((item) => item.id === customerId)) },
  });
  direct.lineChange({
    detail: { index: 0, line: { itemId: veggieId, quantity: '1' } },
    currentTarget: { dataset: {} },
  });
  direct.field({
    detail: { value: '本批次临时场内交付' },
    currentTarget: { dataset: { field: 'remark' } },
  });
  await direct.preview();
  expect(direct.data.confirming, direct.data.error).toBe(true);
  runtime.dropNextOutboundResponse = true;
  runtime.dropStatus = true;
  await direct.submit();
  expect(direct.data.pending).toBe(true);
  expect(direct.data.locked).toBe(true);
  const pending = runtime.storage.get(`warehouse:draft:${outbound.userId}:outbounds:new`) as {
    ticket: SubmissionTicket;
  };
  expect(pending.ticket.key).toBe(runtime.keys.at(-1));
  runtime.dropStatus = false;
  await direct.submit();
  expect(runtime.keys.at(-1)).toBe(runtime.keys.at(-2));
  expect(runtime.redirects.at(-1)).toContain('success=1');
  const packaging = await actorRequest<PageResult<InventoryRow>>(
    request,
    admin,
    'get',
    `/api/inventory/packaging?itemId=${packId}`,
  );
  const vegetables = await actorRequest<PageResult<InventoryRow>>(
    request,
    outbound,
    'get',
    `/api/inventory/vegetables?itemId=${veggieId}`,
  );
  expect(packaging.items[0].quantity).toBe('925');
  expect(vegetables.items[0].quantity).toBe('8');
  const forbidden = await request.get('/api/inventory/packaging', {
    headers: { Authorization: `Bearer ${worker.token}` },
  });
  expect(forbidden.status()).toBe(403);
  const driver2 = await employee(request, 'driver2');
  const ownOnly = await request.get(`/api/batches/${batchId}/summary`, {
    headers: { Authorization: `Bearer ${driver2.token}` },
  });
  expect(ownOnly.status()).toBe(404);
  for (let index = 0; index < 2; index += 1) {
    await actorRequest(request, driver, 'post', '/api/dispatches', {
      post: true,
      document: {
        businessDate: '2026-10-10',
        items: [{ itemId: packId, growerId, quantity: '1' }],
      },
    });
  }
  const choosing = await runtime.load('work', worker);
  expect(choosing.data.document.batchId).toBeFalsy();
  expect(choosing.data.packaging).toEqual([]);
  expect(choosing.data.document.items[0].quantity).toBe('');
  const reconciliation = await actorRequest<{ consistent: boolean }>(
    request,
    admin,
    'get',
    '/api/admin/reconcile',
  );
  expect(reconciliation.consistent).toBe(true);
});
