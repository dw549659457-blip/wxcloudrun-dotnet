import {
  friendlyError,
  queryString,
  type Batch,
  type BatchSummary,
  type PageResult,
} from '@warehouse/contracts';
import { api } from '../../services/api';
import { requireSession } from '../../services/session';
import type { InputEvent, TapEvent } from '../../types';
interface BatchCard extends Batch {
  date: string;
  packagingText: string;
  statusText: string;
}
Page({
  data: {
    target: 'view',
    page: 1,
    search: '',
    rows: [] as BatchCard[],
    selected: null as BatchSummary | null,
    loading: false,
    error: '',
    canNext: false,
  },
  onLoad(query: Record<string, string>) {
    this.setData({ target: ['work', 'recovery'].includes(query.for) ? query.for : 'view' });
    void this.load();
  },
  async load() {
    if (this.data.loading) {
      return;
    }
    this.setData({ loading: true, error: '', selected: null });
    try {
      if (!(await requireSession())) {
        return;
      }
      const result = await api.request<PageResult<Batch>>(
        'GET',
        `/api/batches?${queryString({ page: this.data.page, pageSize: 20, search: this.data.search || undefined })}`,
      );
      const summaries = await Promise.all(
        result.items.map((batch) =>
          api.request<BatchSummary>('GET', `/api/batches/${batch.id}/summary`),
        ),
      );
      this.setData({
        rows: result.items.map((batch, index) => ({
          ...batch,
          date: batch.businessDate.slice(0, 10),
          statusText: batch.status === 'OPEN' ? '还没收完' : '已经收完',
          packagingText: summaries[index].packaging
            .map((line) => `${line.name} ${line.outstanding}${line.unit}可用`)
            .join('；'),
        })),
        canNext: result.items.length === 20,
      });
    } catch (failure) {
      this.setData({ rows: [], error: friendlyError(failure) });
    } finally {
      this.setData({ loading: false });
    }
  },
  searchInput(event: InputEvent) {
    this.setData({ search: event.detail.value });
  },
  search() {
    this.setData({ page: 1 });
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
  async choose(event: TapEvent) {
    const id = Number(event.currentTarget.dataset.id);
    const batch = this.data.rows.find((item) => item.id === id);
    if (!batch) {
      return;
    }
    if (this.data.target === 'view') {
      try {
        this.setData({
          selected: await api.request<BatchSummary>('GET', `/api/batches/${id}/summary`),
        });
        wx.pageScrollTo({ selector: '#batch-detail', duration: 250 });
      } catch (failure) {
        this.setData({ error: friendlyError(failure) });
      }
    } else if (batch.status === 'OPEN') {
      wx.redirectTo({
        url: `/pages/${this.data.target === 'work' ? 'work' : 'recovery'}/index?batchId=${id}`,
      });
    } else {
      this.setData({ error: '这户已经收完，请选择仍在进行的任务。' });
    }
  },
});
