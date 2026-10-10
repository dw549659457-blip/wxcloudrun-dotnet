import {
  ApiError,
  isApiFailure,
  queryString,
  type ApiTransport,
  type PageResult,
  type RequestMethod,
} from '@warehouse/contracts';
import { settings } from '../config/settings';
import { appState } from '../types';
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
      if (
        failure instanceof ApiError ||
        (failure instanceof Error && failure.message.startsWith('请管理员'))
      ) {
        throw failure;
      }
      throw new ApiError(0, { code: 'NETWORK_ERROR', message: '网络没有连上，请稍后再试' });
    }
    let data: unknown;
    try {
      data = typeof raw === 'string' && raw ? JSON.parse(raw) : raw;
    } catch {
      throw new ApiError(502, {
        code: 'INVALID_RESPONSE',
        message: '暂时没有确认结果，请检查网络后查询原提交',
      });
    }
    if (status < 200 || status >= 300) {
      throw new ApiError(
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
