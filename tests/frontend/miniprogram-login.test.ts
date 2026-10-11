import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, friendlyError } from '@warehouse/contracts';
import { loginError } from '../../apps/miniprogram/src/services/login-errors';
import { api } from '../../apps/miniprogram/src/services/api';

describe('身份核实错误与记账错误的区别', () => {
  it.each(['WECHAT_NOT_CONFIGURED', 'WECHAT_REQUEST_FAILED', 'WECHAT_UNAVAILABLE'])(
    '%s 保留微信后台的明确原因',
    (code) => {
      expect(
        loginError(new ApiError(503, { code, message: '微信登录暂未配置，请联系管理员' })),
      ).toBe('微信登录暂未配置，请联系管理员');
    },
  );
  it.each([
    [0, 'NETWORK_ERROR', '未连接到云托管登录服务'],
    [502, 'INVALID_RESPONSE', '登录服务返回'],
    [500, 'INTERNAL_ERROR', '登录服务暂时不可用'],
  ] as const)('登录 %s / %s 不要求查询不存在的业务提交', (status, code, expected) => {
    const message = loginError(new ApiError(status, { code, message: '接口未成功' }));
    expect(message).toContain(expected);
    expect(message).not.toContain('原提交');
  });
  it('业务提交仍保留待确认提示，不能因登录文案修复诱导重复提交', () => {
    expect(
      friendlyError(new ApiError(503, { code: 'DATABASE_UNAVAILABLE', message: '未确认' })),
    ).toContain('查询原提交结果');
  });
});

describe('云登录请求的可定位错误信息', () => {
  const callContainer = vi.fn();
  beforeEach(() => {
    callContainer.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('wx', { cloud: { callContainer } });
    vi.stubGlobal('getApp', () => ({ globalData: { session: null } }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('后台503保留原code/message/requestId；诊断不记录请求体或错误明细', async () => {
    const requestId = '861ba22ba20043dc9887c5a0c9b79143';
    callContainer.mockResolvedValue({
      statusCode: 503,
      data: {
        code: 'WECHAT_NOT_CONFIGURED',
        message: '微信登录暂未配置，请联系管理员',
        requestId,
        details: { secret: 'do-not-log-response-detail' },
      },
    });
    await expect(
      api.request('POST', '/api/auth/wechat-login', { code: 'do-not-log-login-code' }),
    ).rejects.toMatchObject({ status: 503, failure: { code: 'WECHAT_NOT_CONFIGURED', requestId } });
    expect(console.warn).toHaveBeenCalledWith(
      '[warehouse] 接口请求失败',
      expect.objectContaining({
        path: '/api/auth/wechat-login',
        status: 503,
        code: 'WECHAT_NOT_CONFIGURED',
        requestId,
      }),
    );
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('do-not-log');
  });
  it('SDK通道拒绝保留数值错误码，不把原始异常中的令牌或登录code输出', async () => {
    callContainer.mockRejectedValue({
      errCode: -501000,
      errMsg: 'do-not-log-sdk-secret',
      data: 'do-not-log-sdk-body',
    });
    await expect(
      api.request('POST', '/api/auth/wechat-login', { code: 'do-not-log-login-code' }),
    ).rejects.toMatchObject({ status: 0, failure: { code: 'NETWORK_ERROR', details: -501000 } });
    expect(console.warn).toHaveBeenCalledWith(
      '[warehouse] 接口请求失败',
      expect.objectContaining({
        status: 0,
        cloudErrorCode: -501000,
      }),
    );
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('do-not-log');
  });
});
