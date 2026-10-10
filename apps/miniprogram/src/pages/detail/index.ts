import {
  ApiError,
  confirmSubmission,
  documentLabels,
  friendlyError,
  isDocumentResource,
  makeTicket,
  resourceKinds,
  statusLabels,
  type Archive,
  type DocumentDetail,
  type DocumentResource,
  type SubmissionResult,
} from '@warehouse/contracts';
import { api, allPages } from '../../services/api';
import { requireSession } from '../../services/session';
import { getDraft } from '../../services/drafts';
import { rememberForm, showSubmitted } from '../../services/forms';
import { removeDraft } from '../../services/drafts';
interface DetailLine {
  key: string;
  label: string;
  quantity: string;
  unit: string;
  display: string;
}
const route: Record<DocumentResource, string> = {
  dispatches: 'dispatch',
  'work-records': 'work',
  recoveries: 'recovery',
  outbounds: 'outbound',
  'stock-documents': '',
};
Page({
  data: {
    resource: 'dispatches' as DocumentResource,
    id: 0,
    ownerId: 0,
    title: '',
    detail: null as DocumentDetail | null,
    lines: [] as DetailLine[],
    success: false,
    statusText: '',
    loading: true,
    busy: false,
    pending: false,
    error: '',
    notice: '',
    creator: '',
    created: '',
    posted: '',
    modeText: '',
  },
  onLoad(query: Record<string, string>) {
    if (!isDocumentResource(query.resource) || !Number(query.id)) {
      this.setData({ error: '未找到记录', loading: false });
      return;
    }
    this.setData({
      resource: query.resource,
      id: Number(query.id),
      title: documentLabels[query.resource],
      success: query.success === '1',
    });
    void this.load();
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await requireSession();
      if (!session) {
        return;
      }
      const detail = await api.request<DocumentDetail>(
        'GET',
        `/api/${this.data.resource}/${this.data.id}`,
      );
      let lines: DetailLine[];
      if (detail.items.length) {
        lines = detail.items.map((item) => ({
          key: String(item.id),
          label: `${item.growerName ? item.growerName + ' · ' : ''}${item.itemName} · ${item.lineKind === 'OUTPUT' ? '装菜产出' : item.lineKind === 'CONSUMPTION' ? '包装消耗' : item.lineKind === 'RECEIVED' ? '实收蔬菜' : '本次数量'}`,
          quantity: item.actualQuantity,
          unit: item.unit,
          display: item.displayQuantity,
        }));
      } else {
        const archivePaths =
          this.data.resource === 'dispatches'
            ? ['growers', 'packaging-types']
            : this.data.resource === 'outbounds'
              ? ['vegetable-types']
              : ['packaging-types', 'vegetable-types'];
        const archives = (
          await Promise.all(archivePaths.map((path) => allPages<Archive>(`/api/${path}`)))
        ).flat();
        lines = [...detail.document.input.items, ...(detail.document.input.vegetables ?? [])].map(
          (line, index) => {
            const archive = archives.find((item) => item.id === line.itemId);
            const grower = archives.find((item) => item.id === line.growerId);
            return {
              key: String(index),
              label: `${grower ? grower.name + ' · ' : ''}${archive?.name ?? `停用品类#${line.itemId}`}`,
              quantity: line.quantity,
              unit: archive?.unit ?? '',
              display: line.quantity,
            };
          },
        );
      }
      const dateTime = (value?: string | null) =>
        value
          ? new Date(
              new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).getTime() +
                480 * 60000,
            )
              .toISOString()
              .replace('T', ' ')
              .slice(0, 19)
          : '尚未提交';
      this.setData({
        detail,
        ownerId: session.userId,
        lines,
        statusText: statusLabels[detail.document.status],
        creator: detail.document.creatorName ?? session.name,
        created: dateTime(detail.document.createdAt),
        posted: dateTime(detail.document.postedAt),
        pending: Boolean(getDraft(session.userId, this.data.resource, this.data.id)?.ticket),
        modeText:
          detail.document.input.mode === 'FINAL'
            ? '这户已经收完'
            : detail.document.input.mode === 'PARTIAL'
              ? '这户还没收完'
              : detail.document.input.mode === 'DIRECT'
                ? '手工出库：实际正数，报表显示负数'
                : '正常记账',
      });
    } catch (failure) {
      this.setData({ error: friendlyError(failure) });
    } finally {
      this.setData({ loading: false });
    }
  },
  edit() {
    if (!this.data.pending) {
      wx.navigateTo({ url: `/pages/${route[this.data.resource]}/index?id=${this.data.id}` });
    }
  },
  post() {
    if (this.data.busy || !this.data.detail) {
      return;
    }
    if (this.data.pending) {
      void this.submitOriginal();
      return;
    }
    wx.showModal({
      title: '确认这份草稿记账？',
      content: `请核对上方日期、品类和数量。${this.data.detail.document.input.mode === 'FINAL' ? '最终回收会结束这户任务并记录损耗。' : '确认后才改变库存。'}`,
      confirmText: '确认记账',
      success: (choice) => {
        if (choice.confirm) {
          void this.submitOriginal();
        }
      },
    });
  },
  async submitOriginal() {
    if (this.data.busy || !this.data.detail) {
      return;
    }
    this.setData({ busy: true, error: '' });
    const saved = getDraft(this.data.ownerId, this.data.resource, this.data.id);
    const ticket =
      saved?.ticket ??
      makeTicket(
        `${resourceKinds[this.data.resource]}:${this.data.id}:post`,
        `/api/${this.data.resource}/${this.data.id}/post`,
        { version: this.data.detail.document.version },
      );
    rememberForm(
      this.data.ownerId,
      this.data.resource,
      this.data.detail.document.input,
      this.data.id,
      this.data.detail.document.version,
      ticket,
    );
    try {
      const outcome = await confirmSubmission(api, ticket);
      if (outcome.state === 'succeeded') {
        removeDraft(this.data.ownerId, this.data.resource, this.data.id);
        showSubmitted(this.data.resource, outcome.result);
      } else {
        this.setData({ pending: true, notice: outcome.message });
      }
    } catch (failure) {
      const known = failure instanceof ApiError && failure.status > 0 && failure.status < 500;
      if (known) {
        rememberForm(
          this.data.ownerId,
          this.data.resource,
          this.data.detail.document.input,
          this.data.id,
          this.data.detail.document.version,
        );
      }
      this.setData({ error: friendlyError(failure), pending: !known });
    } finally {
      this.setData({ busy: false });
    }
  },
  deleteDraft() {
    if (this.data.pending || this.data.busy) {
      return;
    }
    wx.showModal({
      title: '删除这份未记账草稿？',
      content: '草稿尚未影响库存，删除后不会产生流水。',
      success: async (choice) => {
        if (!choice.confirm) {
          return;
        }
        this.setData({ busy: true });
        try {
          await api.request('DELETE', `/api/${this.data.resource}/${this.data.id}`);
          removeDraft(this.data.ownerId, this.data.resource, this.data.id);
          wx.disableAlertBeforeUnload();
          wx.navigateBack();
        } catch (failure) {
          this.setData({ error: friendlyError(failure) });
        } finally {
          this.setData({ busy: false });
        }
      },
    });
  },
  again() {
    const value: SubmissionResult | null = this.data.detail?.document ?? null;
    if (value && value.status === 'POSTED') {
      wx.redirectTo({ url: `/pages/${route[this.data.resource]}/index` });
    }
  },
  home() {
    wx.reLaunch({ url: '/pages/home/index' });
  },
});
