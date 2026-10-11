import {
  ApiError,
  isApiFailure,
  queryString,
  type ApiTransport,
  type PageQuery,
  type PageResult,
  type RequestMethod,
} from '@warehouse/contracts';

let csrfToken = sessionStorage.getItem('warehouse:csrf') ?? '';
export function setCsrfToken(value: string): void {
  csrfToken = value;
  if (value) {
    sessionStorage.setItem('warehouse:csrf', value);
  } else {
    sessionStorage.removeItem('warehouse:csrf');
  }
}
export function hasCsrfToken(): boolean {
  return csrfToken.length > 0;
}
export const api: ApiTransport = {
  async request<T>(
    method: RequestMethod,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const headers: Record<string, string> = { ...extraHeaders };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (method !== 'GET' && csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
    try {
      const response = await fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
        signal: controller.signal,
      });
      if (response.status === 204) {
        return undefined as T;
      }
      const data: unknown = await response.json();
      if (!response.ok) {
        if (response.status === 401 && !path.endsWith('/admin-login')) {
          window.dispatchEvent(new Event('warehouse:unauthorized'));
        }
        if (response.status === 403 && isApiFailure(data) && data.code === 'FORBIDDEN') {
          window.dispatchEvent(new Event('warehouse:permissions-changed'));
        }
        throw new ApiError(
          response.status,
          isApiFailure(data)
            ? data
            : { code: 'REQUEST_FAILED', message: '服务没有完成请求，请重试' },
        );
      }
      return data as T;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(0, { code: 'NETWORK_ERROR', message: '网络中断，暂时没有确认结果' });
    } finally {
      clearTimeout(timeout);
    }
  },
};
export async function list<T>(path: string, query: PageQuery = {}): Promise<PageResult<T>> {
  return api.request('GET', `${path}?${queryString(query)}`);
}
export async function allPages<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= 500; page += 1) {
    const result = await list<T>(path, { page, pageSize: 100 });
    items.push(...result.items);
    if (result.items.length < 100) {
      return items;
    }
  }
  throw new Error('选项超过50,000条，请缩小范围后查询');
}
export async function downloadReport(path: string, fileName: string): Promise<void> {
  const response = await fetch(path, { credentials: 'same-origin' });
  if (!response.ok || !response.headers.get('Content-Type')?.includes('spreadsheetml')) {
    const data: unknown = await response.json();
    if (response.status === 401) {
      window.dispatchEvent(new Event('warehouse:unauthorized'));
    }
    throw new ApiError(
      response.status,
      isApiFailure(data) ? data : { code: 'EXPORT_FAILED', message: '导出暂未完成，请重试' },
    );
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
