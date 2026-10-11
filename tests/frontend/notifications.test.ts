import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type StockNotificationFeed } from '@warehouse/contracts';
import {
  notificationView,
  type PendingSubscription,
} from '../../apps/miniprogram/src/services/notifications';

const mocks = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn() }));
vi.mock('../../apps/miniprogram/src/services/api', () => ({ api: { request: mocks.request } }));
vi.mock('../../apps/miniprogram/src/services/session', () => ({ requireSession: mocks.session }));
const base = '/api/admin/stock-notifications';
const feed: StockNotificationFeed = {
  items: [
    {
      notification: {
        id: 4,
        documentId: 2,
        number: 'OUTBOUND-TEST',
        kind: 'OUTBOUND',
        action: 'POST',
        title: '发货出库',
        actor: '李师傅',
        party: '东村客户',
        businessDate: '2026-10-11',
        occurredAt: '2026-10-11T00:00:00Z',
        lines: [
          { itemId: 1, name: '白菜', unit: '箱', domain: 'VEGETABLE', delta: '-3', balance: '8' },
        ],
        lineCount: 1,
      },
      isRead: false,
    },
  ],
  latestId: 4,
  unreadCount: 1,
  hasMore: true,
  updatedAt: '2026-10-11T00:00:00Z',
  subscription: {
    configured: true,
    templateId: 'template-test',
    configurationError: '',
    bound: true,
    paused: false,
    recordedSubscriptions: 0,
    lastDelivery: null,
  },
};
interface AdminPage {
  data: {
    loading: boolean;
    items: { notification: ReturnType<typeof notificationView> }[];
    vegetables: unknown[];
    packaging: unknown[];
    subscription: StockNotificationFeed['subscription'] | null;
    expanded: boolean;
    newCount: number;
    error: string;
    pendingSubscription: boolean;
    busy: boolean;
  };
  onShow(): Promise<void>;
  onHide(): void;
  refresh(reset?: boolean): Promise<void>;
  subscribe(): void;
  sync(): Promise<void>;
  setData(data: Partial<AdminPage['data']>): void;
}
let page: AdminPage;
let RuntimeApiError: typeof ApiError;
let storage: Map<string, PendingSubscription>;
let authorize: ((result: Record<string, string>) => Promise<void>) | undefined;
const subscribeSdk = vi.fn();
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  RuntimeApiError = (await import('@warehouse/contracts')).ApiError;
  mocks.request.mockReset();
  mocks.session.mockReset();
  subscribeSdk.mockReset();
  storage = new Map();
  authorize = undefined;
  mocks.session.mockResolvedValue({
    userId: 1,
    name: '管理员',
    roles: ['ADMIN'],
    selectedRole: 'ADMIN',
    token: 'test-token',
  });
  mocks.request.mockImplementation(async (_method: string, path: string) =>
    path === base ? structuredClone(feed) : { items: [] },
  );
  vi.stubGlobal('wx', {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: PendingSubscription) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    requestSubscribeMessage: subscribeSdk.mockImplementation(
      (options: { success: typeof authorize }) => {
        authorize = options.success;
      },
    ),
  });
  vi.stubGlobal('Page', (definition: AdminPage) => {
    page = definition;
    page.setData = (data) => Object.assign(page.data, data);
  });
  await import('../../apps/miniprogram/src/pages/admin/index');
});
afterEach(() => {
  page.onHide();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('管理员原生页面的动态与订阅', () => {
  it('显示时自动更新，离开后停止请求；未读与库存来源于后台', async () => {
    await page.onShow();
    expect(page.data.items[0].notification.lines[0].deltaText).toBe('-3');
    expect(page.data.items[0].notification.lines[0].label).toBe('仓库蔬菜');
    expect(mocks.request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.request).toHaveBeenCalledTimes(6);
    page.onHide();
    await vi.advanceTimersByTimeAsync(15000);
    expect(mocks.request).toHaveBeenCalledTimes(6);
  });
  it('隐藏页面后到达的旧响应不会写入页面', async () => {
    let resolveFeed: (value: StockNotificationFeed) => void = () => undefined;
    const deferred = new Promise<StockNotificationFeed>((resolve) => {
      resolveFeed = resolve;
    });
    mocks.request.mockImplementation(async (_method: string, path: string) =>
      path === base ? deferred : { items: [] },
    );
    const showing = page.onShow();
    await Promise.resolve();
    await Promise.resolve();
    page.onHide();
    resolveFeed(feed);
    await showing;
    expect(page.data.items).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('撤销权限后清空库存和动态，并停止轮询', async () => {
    await page.onShow();
    mocks.request.mockRejectedValue(
      new RuntimeApiError(403, { code: 'FORBIDDEN', message: '权限已撤销' }),
    );
    await page.refresh();
    expect(page.data.items).toEqual([]);
    expect(page.data.subscription).toBeNull();
    const calls = mocks.request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.request).toHaveBeenCalledTimes(calls);
    expect(page.data.error).toContain('权限已撤销');
  });
  it('读历史时保留位置，新动态用入口提示', async () => {
    await page.onShow();
    page.data.expanded = true;
    const newer = structuredClone(feed);
    newer.latestId = 5;
    newer.items[0].notification.id = 5;
    mocks.request.mockImplementation(async (_method: string, path: string) =>
      path === base ? newer : { items: [] },
    );
    await page.refresh();
    expect(page.data.items[0].notification.id).toBe(4);
    expect(page.data.newCount).toBe(1);
    await page.refresh(true);
    expect(page.data.items[0].notification.id).toBe(5);
  });
  it('订阅登记断网后用原标识同步，不再请求微信授权', async () => {
    await page.onShow();
    mocks.request.mockImplementation(async (method: string, path: string) => {
      if (method === 'POST' && path.endsWith('/subscribe')) {
        throw new RuntimeApiError(0, { code: 'NETWORK_ERROR', message: '断网' });
      }
      return path === base ? structuredClone(feed) : { items: [] };
    });
    page.subscribe();
    expect(subscribeSdk).toHaveBeenCalledTimes(1);
    await authorize?.({ 'template-test': 'accept' });
    expect(page.data.pendingSubscription).toBe(true);
    page.subscribe();
    expect(subscribeSdk).toHaveBeenCalledTimes(1);
    const pending = [...storage.values()][0];
    mocks.request.mockImplementation(async (_method: string, path: string) =>
      path === base ? structuredClone(feed) : { recorded: true },
    );
    await page.sync();
    expect(page.data.pendingSubscription).toBe(false);
    expect(storage.size).toBe(0);
    const registrations = mocks.request.mock.calls.filter((call) => call[1].endsWith('/subscribe'));
    expect(registrations).toHaveLength(2);
    expect(registrations[0][3]['Idempotency-Key']).toBe(pending.key);
    expect(registrations[1][3]['Idempotency-Key']).toBe(pending.key);
    expect(subscribeSdk).toHaveBeenCalledTimes(1);
  });
  it('模板未配置时不弹授权；普通员工不能进入管理员页面', async () => {
    const unconfigured = structuredClone(feed);
    unconfigured.subscription.configured = false;
    unconfigured.subscription.templateId = '';
    mocks.request.mockImplementation(async (_method: string, path: string) =>
      path === base ? unconfigured : { items: [] },
    );
    await page.onShow();
    page.subscribe();
    expect(subscribeSdk).not.toHaveBeenCalled();
    page.onHide();
    mocks.session.mockResolvedValue({
      userId: 2,
      name: '员工',
      roles: ['WORKER'],
      selectedRole: 'WORKER',
    });
    await page.onShow();
    expect(page.data.items).toEqual([]);
    expect(page.data.error).toContain('仅管理员');
  });
});
