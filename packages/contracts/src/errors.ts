import type { ApiFailure } from './types';
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly failure: ApiFailure,
  ) {
    super(failure.message);
    this.name = 'ApiError';
  }
}
export function isApiFailure(value: unknown): value is ApiFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  );
}
export function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      if (['INVALID_CREDENTIALS', 'ACCOUNT_DISABLED'].includes(error.failure.code)) {
        return error.message;
      }
      return '登录已过期，请重新进入；未提交的内容还在';
    }
    if (error.failure.code === 'CSRF_REJECTED') {
      return '页面验证已过期，请重新登录后操作';
    }
    if (error.status === 403) {
      return error.message || '这个操作需要管理员协助';
    }
    if (error.status >= 500 || error.status === 0) {
      return '暂时没有确认结果，请检查网络后查询原提交结果';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : '暂时无法完成，请稍后重试';
}
