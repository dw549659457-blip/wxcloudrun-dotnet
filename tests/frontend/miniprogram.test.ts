import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recoveryPreview } from '../../apps/miniprogram/src/services/document-page';
import { getDraft, saveDraft } from '../../apps/miniprogram/src/services/drafts';
import { saveSession } from '../../apps/miniprogram/src/services/session';
import type { BatchSummary, EmployeeSession } from '@warehouse/contracts';
const storage = new Map<string, unknown>();
let session: EmployeeSession | null = null;
beforeEach(() => {
  storage.clear();
  session = null;
  vi.stubGlobal('wx', {
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('getApp', () => ({
    globalData: {
      get session() {
        return session;
      },
      set session(value: EmployeeSession | null) {
        session = value;
      },
      bindingToken: '',
    },
  }));
});
const batch: BatchSummary = {
  batch: {
    id: 1,
    dispatchId: 1,
    growerId: 1,
    growerName: '棚户A',
    status: 'OPEN',
    version: 1,
    number: 'DISPATCH-1',
    businessDate: '2026-10-10',
    driverName: '司机一',
  },
  packaging: [
    {
      itemId: 5,
      name: '泡沫箱',
      unit: '个',
      dispatched: '100',
      consumed: '70',
      recovered: '0',
      outstanding: '30',
      lost: '0',
    },
  ],
  vegetables: [
    { itemId: 7, name: '白菜', unit: '箱', output: '12', received: '0', difference: '12' },
  ],
};
describe('小程序回收对账', () => {
  it('100下发−70消耗−25本次回收=5损耗，12箱实收差异为零', () => {
    const preview = recoveryPreview(batch, {
      businessDate: '2026-10-10',
      batchId: 1,
      mode: 'FINAL',
      items: [{ itemId: 5, quantity: '25' }],
      vegetables: [{ itemId: 7, quantity: '12' }],
      lossReason: '损坏',
    });
    expect(preview.errors).toEqual([]);
    expect(preview.lossRows[0].value).toBe('本次损耗 5 个');
    expect(preview.differenceRows).toEqual([]);
  });
  it('部分回收不提前确认损耗', () => {
    expect(
      recoveryPreview(batch, {
        businessDate: '2026-10-10',
        mode: 'PARTIAL',
        items: [{ itemId: 5, quantity: '20' }],
      }).lossRows,
    ).toEqual([]);
  });
  it('最终损耗和蔬菜差异都需要原因', () => {
    const preview = recoveryPreview(batch, {
      businessDate: '2026-10-10',
      mode: 'FINAL',
      items: [{ itemId: 5, quantity: '25' }],
      vegetables: [{ itemId: 7, quantity: '10' }],
    });
    expect(preview.errors).toEqual([
      '有包装损耗，请选择或填写原因',
      '装菜产出与司机实收有差异，请填写原因',
    ]);
    expect(preview.differenceRows[0].value).toBe('差异 2 箱');
  });
  it('重复品类合计检查，不允许逐行绕过在外量', () => {
    expect(
      recoveryPreview(batch, {
        businessDate: '2026-10-10',
        mode: 'PARTIAL',
        items: [
          { itemId: 5, quantity: '20' },
          { itemId: 5, quantity: '20' },
        ],
      }).errors,
    ).toContain('泡沫箱的回收量超过当前在外量');
  });
});
describe('本机草稿隔离', () => {
  it('只允许草稿所属员工读取', () => {
    saveDraft({
      ownerId: 1,
      resource: 'work-records',
      document: { businessDate: '2026-10-10', items: [] },
      updatedAt: '2026-10-10',
    });
    expect(getDraft(1, 'work-records')).not.toBeNull();
    expect(getDraft(2, 'work-records')).toBeNull();
  });
  it('员工切换后清除前一人的业务草稿', () => {
    saveSession({ userId: 1, name: '一', roles: ['WORKER'], token: 'test-session' });
    saveDraft({
      ownerId: 1,
      resource: 'work-records',
      document: { businessDate: '2026-10-10', items: [] },
      updatedAt: '',
    });
    saveSession({ userId: 2, name: '二', roles: ['WORKER'], token: 'other-test-session' });
    expect(getDraft(1, 'work-records')).toBeNull();
  });
  it('刷新同一员工会话保留草稿', () => {
    const current: EmployeeSession = {
      userId: 1,
      name: '一',
      roles: ['WORKER'],
      token: 'test-session',
    };
    saveSession(current);
    saveDraft({
      ownerId: 1,
      resource: 'work-records',
      document: { businessDate: '2026-10-10', items: [] },
      updatedAt: '',
    });
    saveSession({ ...current, token: 'new-test-session' });
    expect(getDraft(1, 'work-records')).not.toBeNull();
  });
});

type StartPage = {
  data: {
    loading: boolean;
    stage: string;
    candidate: string;
    assistance: boolean;
    notice: string;
    error: string;
  };
  setData(value: Partial<StartPage['data']>): void;
  phone(event: { detail: { code?: string } }): Promise<void>;
  notMe(): void;
  confirm(): Promise<void>;
  requestHelp(): Promise<void>;
  checkHelp(): Promise<void>;
};
let originalStart: StartPage | undefined;
async function startPage(): Promise<StartPage> {
  vi.stubGlobal('Page', (options: StartPage) => {
    originalStart = options;
  });
  await import('../../apps/miniprogram/src/pages/start/index');
  if (!originalStart) {
    throw new Error('未捕获原生页面');
  }
  const page = { ...originalStart, data: structuredClone(originalStart.data) };
  page.setData = (value) => {
    Object.assign(page.data, value);
  };
  return page;
}
describe('首次微信绑定控制器（接口替身，非微信线上验证）', () => {
  it('拒绝手机号授权不调用绑定接口，保留管理员协助提示', async () => {
    const { api } = await import('../../apps/miniprogram/src/services/api');
    const request = vi.spyOn(api, 'request').mockResolvedValue({});
    const page = await startPage();
    await page.phone({ detail: {} });
    expect(request).not.toHaveBeenCalled();
    expect(page.data.error).toContain('管理员协助');
    request.mockRestore();
  });
  it('手机号匹配后只显示候选身份，本人确认才正式绑定', async () => {
    const { api } = await import('../../apps/miniprogram/src/services/api');
    const request = vi
      .spyOn(api, 'request')
      .mockResolvedValueOnce({ status: 'PENDING_CONFIRM', name: '张三', roles: ['WORKER'] })
      .mockResolvedValueOnce({
        userId: 1,
        name: '张三',
        roles: ['WORKER'],
        token: 'unit-test-token',
      });
    vi.stubGlobal('wx', {
      getStorageInfoSync: () => ({ keys: [] }),
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: vi.fn(),
      reLaunch: vi.fn(),
    });
    const page = await startPage();
    await page.phone({ detail: { code: 'unit-phone-code' } });
    expect(page.data.candidate).toBe('张三 · 装菜人员');
    expect(page.data.stage).toBe('CONFIRM');
    expect(session).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    await page.confirm();
    expect(request.mock.calls[1][1]).toBe('/api/auth/confirm-binding');
    expect(session?.name).toBe('张三');
    request.mockRestore();
  });
  it('点不是我停止正式绑定，清除候选姓名并进入协助', async () => {
    const { api } = await import('../../apps/miniprogram/src/services/api');
    const request = vi
      .spyOn(api, 'request')
      .mockResolvedValue({ status: 'PENDING_CONFIRM', name: '其他员工', roles: ['DRIVER'] });
    const page = await startPage();
    await page.phone({ detail: { code: 'unit-phone-code' } });
    page.notMe();
    expect(page.data.stage).toBe('ASSIST');
    expect(page.data.candidate).toBe('');
    expect(session).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    request.mockRestore();
  });
  it('管理员协助申请不授予会话，批准后仍等待本人确认', async () => {
    const { api } = await import('../../apps/miniprogram/src/services/api');
    const request = vi
      .spyOn(api, 'request')
      .mockResolvedValueOnce({ requestId: 1, status: 'PENDING_APPROVAL' })
      .mockResolvedValueOnce({
        status: 'APPROVED',
        candidate: { name: '王五', roles: ['DRIVER'] },
      });
    vi.stubGlobal('getApp', () => ({
      globalData: { session: null, bindingToken: 'unit-binding-ticket' },
    }));
    const page = await startPage();
    await page.requestHelp();
    expect(page.data.stage).toBe('WAITING');
    expect(session).toBeNull();
    await page.checkHelp();
    expect(page.data.stage).toBe('CONFIRM');
    expect(page.data.candidate).toBe('王五 · 司机');
    expect(request.mock.calls.some((call) => call[1] === '/api/auth/confirm-binding')).toBe(false);
    request.mockRestore();
  });
});

describe('会话过期后的草稿隐私', () => {
  it('旧会话已清空后，新员工仍不能继承前一人的草稿', () => {
    saveSession({ userId: 1, name: '一', roles: ['WORKER'], token: 'old-test-session' });
    saveDraft({
      ownerId: 1,
      resource: 'work-records',
      document: { businessDate: '2026-10-10', items: [] },
      updatedAt: '',
    });
    session = null;
    saveSession({ userId: 2, name: '二', roles: ['WORKER'], token: 'other-test-session' });
    expect(getDraft(1, 'work-records')).toBeNull();
  });
  it('过期后恢复已绑定微信，保留同一员工草稿，不重复索取手机号', async () => {
    const { api } = await import('../../apps/miniprogram/src/services/api');
    const { ApiError } = await import('@warehouse/contracts');
    const { requireSession } = await import('../../apps/miniprogram/src/services/session');
    saveSession({ userId: 1, name: '一', roles: ['WORKER'], token: 'expired-test-session' });
    saveDraft({
      ownerId: 1,
      resource: 'work-records',
      document: { businessDate: '2026-10-10', items: [] },
      updatedAt: '',
    });
    const request = vi
      .spyOn(api, 'request')
      .mockRejectedValueOnce(new ApiError(401, { code: 'UNAUTHORIZED', message: '会话已过期' }))
      .mockResolvedValueOnce({
        userId: 1,
        name: '一',
        roles: ['WORKER'],
        token: 'restored-test-session',
      });
    const previousWx = wx;
    vi.stubGlobal('wx', {
      ...previousWx,
      login: (options: { success(value: { code: string }): void }) =>
        options.success({ code: 'unit-wechat-code' }),
    });
    const restored = await requireSession();
    expect(restored?.token).toBe('restored-test-session');
    expect(getDraft(1, 'work-records')).not.toBeNull();
    expect(request.mock.calls.map((call) => call[1])).toEqual([
      '/api/auth/me',
      '/api/auth/wechat-login',
    ]);
    request.mockRestore();
  });
});
