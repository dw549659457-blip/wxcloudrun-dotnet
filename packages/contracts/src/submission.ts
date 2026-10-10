import { ApiError } from './errors';
import type { ApiTransport, SubmissionResult, SubmissionStatus } from './types';
export interface SubmissionTicket {
  key: string;
  operation: string;
  path: string;
  body: unknown;
}
export type ConfirmedSubmission =
  { state: 'succeeded'; result: SubmissionResult } | { state: 'pending'; message: string };
export function newSubmissionKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
export function makeTicket(operation: string, path: string, body: unknown): SubmissionTicket {
  return {
    key: newSubmissionKey(),
    operation,
    path,
    body: JSON.parse(JSON.stringify(body)) as unknown,
  };
}
// 超时后先查询原key；只有确认成功才显示成功，不自动更换key或后台补记。
export async function confirmSubmission(
  client: ApiTransport,
  ticket: SubmissionTicket,
): Promise<ConfirmedSubmission> {
  try {
    const result = await client.request<SubmissionResult>('POST', ticket.path, ticket.body, {
      'Idempotency-Key': ticket.key,
    });
    return { state: 'succeeded', result };
  } catch (error) {
    if (error instanceof ApiError && error.status > 0 && error.status < 500) {
      throw error;
    }
    try {
      const status = await client.request<SubmissionStatus>(
        'GET',
        `/api/submissions/status?operation=${encodeURIComponent(ticket.operation)}&key=${encodeURIComponent(ticket.key)}`,
      );
      if (status.status === 'SUCCEEDED' && status.result) {
        return { state: 'succeeded', result: status.result };
      }
      if (status.status === 'FAILED') {
        throw new ApiError(409, {
          code: status.failureCode ?? 'SUBMISSION_FAILED',
          message: '这次尚未记账，请检查输入后用原标识再试',
        });
      }
    } catch (queryError) {
      if (queryError instanceof ApiError && queryError.status > 0 && queryError.status < 500) {
        throw queryError;
      }
    }
    return {
      state: 'pending',
      message: '暂时没查到结果。内容已保留，请用“确认原提交结果”继续，不要新建一笔。',
    };
  }
}
