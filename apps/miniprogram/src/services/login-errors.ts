import { ApiError, friendlyError } from '@warehouse/contracts';

// 身份核实失败没有业务单据需要查询，不能使用记账待确认文案。
export function loginError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return friendlyError(error);
  }
  if (
    ['WECHAT_NOT_CONFIGURED', 'WECHAT_REQUEST_FAILED', 'WECHAT_UNAVAILABLE'].includes(
      error.failure.code,
    )
  ) {
    return error.message;
  }
  if (error.status === 0) {
    return '未连接到云托管登录服务，请检查网络；管理员可检查小程序与云环境的关联权限。';
  }
  if (error.failure.code === 'INVALID_RESPONSE') {
    return '登录服务返回了无法识别的结果，请稍后重试或联系管理员。';
  }
  if (error.status >= 500) {
    return '登录服务暂时不可用，请稍后重试或联系管理员查看服务日志。';
  }
  return friendlyError(error);
}
