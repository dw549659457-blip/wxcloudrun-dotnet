import {
  friendlyError,
  queryString,
  type InventoryRow,
  type PageResult,
} from '@warehouse/contracts';
import { api } from '../../services/api';
import { requireSession } from '../../services/session';
Page({
  data: { rows: [] as InventoryRow[], page: 1, canNext: false, loading: false, error: '' },
  onShow() {
    void this.load();
  },
  async load() {
    if (this.data.loading) {
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const session = await requireSession();
      if (!session) {
        return;
      }
      if (session.selectedRole !== 'OUTBOUND') {
        throw new Error('请先选择出库员身份');
      }
      const result = await api.request<PageResult<InventoryRow>>(
        'GET',
        `/api/inventory/vegetables?${queryString({ page: this.data.page, pageSize: 20 })}`,
      );
      this.setData({ rows: result.items, canNext: result.items.length === 20 });
    } catch (failure) {
      this.setData({ rows: [], error: friendlyError(failure) });
    } finally {
      this.setData({ loading: false });
    }
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
});
