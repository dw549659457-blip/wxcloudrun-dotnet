import {
  ApiError,
  isApiFailure,
  queryString,
  type ApiTransport,
  type PageResult,
  type RequestMethod,
  type ApiFailure,
} from '@warehouse/contracts';
import { settings } from '../config/settings';
import { appState } from '../types';
function requestError(
  method: RequestMethod,
  path: string,
  status: number,
  failure: ApiFailure,
): ApiError {
  // 只记录定位字段，不记录请求体、登录code、手机号、会话令牌、原始异常对象。
  const requestId =
    failure.requestId && /^[a-f0-9-]{16,64}$/i.test(failure.requestId)
      ? failure.requestId
      : undefined;
  const cloudErrorCode =
    typeof failure.details === 'number' && Number.isSafeInteger(failure.details)
      ? failure.details
      : undefined;
  console.warn('[warehouse] 接口请求失败', {
    method,
    path: path.split('?')[0],
    status,
    code: /^[A-Z_]{1,80}$/.test(failure.code) ? failure.code : 'REQUEST_FAILED',
    requestId,
    cloudErrorCode,
  });
  return new ApiError(status, failure);
}
function sdkErrorCode(failure: unknown): number | undefined {
  if (
    typeof failure === 'object' &&
    failure !== null &&
    'errCode' in failure &&
    typeof failure.errCode === 'number' &&
    Number.isSafeInteger(failure.errCode)
  ) {
    return failure.errCode;
  }
  return undefined;
}
export const api: ApiTransport = {
  async request<T>(
    method: RequestMethod,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders };
    const token = appState().globalData.session?.token;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    let status: number;
    let raw: unknown;
    try {
      if (settings.mode === 'cloud') {
        if (!settings.envId || !settings.serviceName) {
          throw new Error('请管理员先配置小程序的云托管环境和服务名称');
        }
        const response = await wx.cloud.callContainer({
          config: { env: settings.envId },
          path,
          method,
          header: { ...headers, 'X-WX-SERVICE': settings.serviceName },
          data: body === undefined ? undefined : JSON.stringify(body),
        });
        status = response.statusCode;
        raw = response.data;
      } else {
        const response = await new Promise<WechatMiniprogram.RequestSuccessCallbackResult>(
          (resolve, reject) => {
            wx.request({
              url: settings.apiBaseUrl.replace(/\/$/, '') + path,
              method,
              header: headers,
              data: body === undefined ? undefined : JSON.stringify(body),
              timeout: 30000,
              success: resolve,
              fail: () =>
                reject(
                  new ApiError(0, { code: 'NETWORK_ERROR', message: '网络没有连上，请稍后再试' }),
                ),
            });
          },
        );
        status = response.statusCode;
        raw = response.data;
      }
    } catch (failure) {
      if (failure instanceof Error && failure.message.startsWith('请管理员')) {
        throw failure;
      }
      if (failure instanceof ApiError) {
        throw requestError(method, path, failure.status, failure.failure);
      }
      throw requestError(method, path, 0, {
        code: 'NETWORK_ERROR',
        message: '网络没有连上，请稍后再试',
        details: sdkErrorCode(failure),
      });
    }
    let data: unknown;
    try {
      data = typeof raw === 'string' && raw ? JSON.parse(raw) : raw;
    } catch {
      throw requestError(method, path, 502, {
        code: 'INVALID_RESPONSE',
        message: '暂时没有确认结果，请检查网络后查询原提交',
      });
    }
    if (status < 200 || status >= 300) {
      throw requestError(
        method,
        path,
        status,
        isApiFailure(data) ? data : { code: 'REQUEST_FAILED', message: '暂时没能完成，请稍后重试' },
      );
    }
    return data as T;
  },
};
export async function allPages<T>(path: string, filter: object = {}): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= 500; page += 1) {
    const response = await api.request<PageResult<T>>(
      'GET',
      `${path}?${queryString({ ...filter, page, pageSize: 100 })}`,
    );
    items.push(...response.items);
    if (response.items.length < 100) {
      return items;
    }
  }
  throw new Error('记录较多，请按棚户姓名缩小查询范围');
}
