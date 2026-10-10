import type { DocumentInput, DocumentResource, SubmissionTicket } from '@warehouse/contracts';
export interface LocalDraft {
  ownerId: number;
  resource: DocumentResource;
  document: DocumentInput;
  editingId?: number;
  version?: number;
  ticket?: SubmissionTicket;
  updatedAt: string;
}
function key(ownerId: number, resource: DocumentResource, editingId?: number): string {
  return `warehouse:draft:${ownerId}:${resource}:${editingId ?? 'new'}`;
}
export function saveDraft(draft: LocalDraft): void {
  wx.setStorageSync(key(draft.ownerId, draft.resource, draft.editingId), draft);
}
export function getDraft(
  ownerId: number,
  resource: DocumentResource,
  editingId?: number,
): LocalDraft | null {
  const value: unknown = wx.getStorageSync(key(ownerId, resource, editingId));
  if (
    typeof value !== 'object' ||
    value === null ||
    !('ownerId' in value) ||
    value.ownerId !== ownerId ||
    !('resource' in value) ||
    value.resource !== resource ||
    !('document' in value)
  ) {
    return null;
  }
  return value as LocalDraft;
}
export function removeDraft(ownerId: number, resource: DocumentResource, editingId?: number): void {
  wx.removeStorageSync(key(ownerId, resource, editingId));
}
export async function offerDraft(
  ownerId: number,
  resource: DocumentResource,
  editingId?: number,
  targetBatchId?: number,
): Promise<LocalDraft | null> {
  const draft = getDraft(ownerId, resource, editingId);
  if (!draft) {
    return null;
  }
  const choice = await new Promise<WechatMiniprogram.ShowModalSuccessCallbackResult>((resolve) => {
    wx.showModal({
      title: draft.ticket ? '上一笔还在确认结果' : '上次还没提交',
      content: draft.ticket
        ? '保留原提交标识，继续确认是否已记好，避免重复记账。'
        : targetBatchId && draft.document.batchId !== targetBatchId
          ? '您刚选了另一户任务。继续填写会返回上次草稿；重新填写会使用刚选的棚户，请核对顶部姓名。'
          : '继续填写上次保存的内容吗？会重新检查当前账号、棚户与可用包装。',
      confirmText: '继续填写',
      cancelText: draft.ticket ? '稍后处理' : '重新填写',
      success: resolve,
    });
  });
  if (choice.confirm) {
    return draft;
  }
  if (!draft.ticket) {
    removeDraft(ownerId, resource, editingId);
  } else {
    wx.navigateBack();
  }
  return null;
}
