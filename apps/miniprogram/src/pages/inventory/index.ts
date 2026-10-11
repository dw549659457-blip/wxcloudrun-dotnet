import {
  friendlyError,
  queryString,
  type InventoryRow,
  type PageResult,
} from '@warehouse/contracts';
import { api } from '../../services/api';
import { requireSession } from '../../services/session';
Page({
  data: {
    rows: [] as InventoryRow[],
    page: 1,
    canNext: false,
    loading: false,
    error: '',
    domain: 'vegetables',
    title: '蔬菜库存',
  },
  onLoad(options: Record<string, string>) {
    const domain = options.domain === 'packaging' ? 'packaging' : 'vegetables';
    this.setData({ domain, title: domain === 'packaging' ? '仓库包装库存' : '蔬菜库存' });
    wx.setNavigationBarTitle({ title: this.data.title });
  },
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
      if (
        !session.roles.includes('ADMIN') &&
        (session.selectedRole !== 'OUTBOUND' || this.data.domain !== 'vegetables')
      ) {
        throw new Error('当前岗位不能查询此类库存');
      }
      const result = await api.request<PageResult<InventoryRow>>(
        'GET',
        `/api/inventory/${this.data.domain}?${queryString({ page: this.data.page, pageSize: 20 })}`,
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
