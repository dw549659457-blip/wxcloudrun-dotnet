import {
  confirmSubmission,
  makeTicket,
  resourceKinds,
  type DocumentInput,
  type DocumentResource,
  type SubmissionResult,
  type SubmissionTicket,
} from '@warehouse/contracts';
import { api } from './api';
import { saveDraft, removeDraft } from './drafts';
export async function submitDocument(
  ownerId: number,
  resource: DocumentResource,
  document: DocumentInput,
  existingTicket?: SubmissionTicket,
  editingId?: number,
  version?: number,
): Promise<{ ticket: SubmissionTicket; result?: SubmissionResult; pending: boolean }> {
  let ticket = existingTicket;
  if (!ticket) {
    if (editingId) {
      const updated = await api.request<SubmissionResult>(
        'PUT',
        `/api/${resource}/${editingId}?version=${version}`,
        document,
      );
      ticket = makeTicket(
        `${resourceKinds[resource]}:${editingId}:post`,
        `/api/${resource}/${editingId}/post`,
        { version: updated.version },
      );
    } else {
      ticket = makeTicket(`${resourceKinds[resource]}:create`, `/api/${resource}`, {
        post: true,
        document,
      });
    }
  }
  // 必须先保存原key再发请求；响应丢失、返回页面或恢复草稿均沿用同一个请求内容。
  saveDraft({
    ownerId,
    resource,
    document,
    editingId,
    version,
    ticket,
    updatedAt: new Date().toISOString(),
  });
  const outcome = await confirmSubmission(api, ticket);
  if (outcome.state === 'succeeded') {
    removeDraft(ownerId, resource, editingId);
    return { ticket, result: outcome.result, pending: false };
  }
  return { ticket, pending: true };
}
export function rememberForm(
  ownerId: number,
  resource: DocumentResource,
  document: DocumentInput,
  editingId?: number,
  version?: number,
  ticket?: SubmissionTicket,
): void {
  saveDraft({
    ownerId,
    resource,
    document,
    editingId,
    version,
    ticket,
    updatedAt: new Date().toISOString(),
  });
  wx.enableAlertBeforeUnload({ message: '还没记账，内容已保存草稿。要离开吗？' });
}
export function leaveAfterSave(): void {
  wx.disableAlertBeforeUnload();
  wx.navigateBack();
}
export function showSubmitted(resource: DocumentResource, result: SubmissionResult): void {
  wx.disableAlertBeforeUnload();
  wx.redirectTo({ url: `/pages/detail/index?resource=${resource}&id=${result.id}&success=1` });
}
