import {
  documentLabels,
  friendlyError,
  isDocumentResource,
  queryString,
  statusLabels,
  type DocumentRecord,
  type DocumentResource,
  type PageResult,
} from '@warehouse/contracts';
import { api } from '../../services/api';
import { requireSession } from '../../services/session';
import type { PickerEvent, TapEvent } from '../../types';
interface RecordCard extends DocumentRecord {
  statusText: string;
  createdText: string;
  postedText: string;
}
function time(value?: string | null): string {
  if (!value) {
    return '—';
  }
  return new Date(
    new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).getTime() + 480 * 60000,
  )
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
}
Page({
  data: {
    resource: 'dispatches' as DocumentResource,
    title: '',
    page: 1,
    from: '',
    to: '',
    rows: [] as RecordCard[],
    canNext: false,
    loading: false,
    error: '',
  },
  onLoad(query: Record<string, string>) {
    if (!isDocumentResource(query.resource)) {
      this.setData({ error: '未找到这种记录' });
      return;
    }
    this.setData({ resource: query.resource, title: documentLabels[query.resource] });
    void this.load();
  },
  onShow() {
    if (this.data.title) {
      void this.load();
    }
  },
  async load() {
    if (this.data.loading) {
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      if (!(await requireSession())) {
        return;
      }
      const result = await api.request<PageResult<DocumentRecord>>(
        'GET',
        `/api/${this.data.resource}?${queryString({ page: this.data.page, pageSize: 20, from: this.data.from || undefined, to: this.data.to || undefined })}`,
      );
      this.setData({
        rows: result.items.map((item) => ({
          ...item,
          statusText: statusLabels[item.status],
          createdText: time(item.createdAt),
          postedText: time(item.postedAt),
        })),
        canNext: result.items.length === 20,
      });
    } catch (failure) {
      this.setData({ rows: [], error: friendlyError(failure) });
    } finally {
      this.setData({ loading: false });
    }
  },
  date(event: PickerEvent) {
    const field = event.currentTarget.dataset.field;
    if (field === 'from') {
      this.setData({ from: event.detail.value, page: 1 });
    }
    if (field === 'to') {
      this.setData({ to: event.detail.value, page: 1 });
    }
    void this.load();
  },
  clear() {
    this.setData({ from: '', to: '', page: 1 });
    void this.load();
  },
  previous() {
    if (this.data.page > 1) {
      this.setData({ page: this.data.page - 1 });
      void this.load();
    }
  },
  next() {
    if (this.data.canNext) {
      this.setData({ page: this.data.page + 1 });
      void this.load();
    }
  },
  detail(event: TapEvent) {
    wx.navigateTo({
      url: `/pages/detail/index?resource=${this.data.resource}&id=${event.currentTarget.dataset.id}`,
    });
  },
});
