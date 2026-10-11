import { ApiError, type StockNotification } from '@warehouse/contracts';
import { requireSession } from '../../services/session';
import { api } from '../../services/api';
import { notificationError, notificationView } from '../../services/notifications';
Page({
  data: {
    id: 0,
    loading: true,
    error: '',
    notice: '',
    detail: null as ReturnType<typeof notificationView> | null,
  },
  onLoad(options: Record<string, string>) {
    this.setData({ id: Number(options.id) });
  },
  onShow() {
    void this.load();
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await requireSession();
      if (!session) {
        return;
      }
      if (!session.roles.includes('ADMIN')) {
        throw new ApiError(403, { code: 'FORBIDDEN', message: '仅管理员可以查看这条动态。' });
      }
      if (!Number.isSafeInteger(this.data.id) || this.data.id < 1) {
        throw new Error('动态编号无效，请从管理员工作台重新进入。');
      }
      const detail = await api.request<StockNotification>(
        'GET',
        `/api/admin/stock-notifications/${this.data.id}`,
      );
      this.setData({ detail: notificationView(detail) });
      try {
        await api.request('POST', `/api/admin/stock-notifications/${this.data.id}/read`);
      } catch (failure) {
        if (failure instanceof ApiError && [401, 403].includes(failure.status)) {
          throw failure;
        }
        this.setData({ notice: '动态已加载，已读状态暂时没有同步。返回工作台后可重试。' });
      }
    } catch (failure) {
      this.setData({ detail: null, error: notificationError(failure) });
    } finally {
      this.setData({ loading: false });
    }
  },
  inventory() {
    wx.navigateTo({ url: '/pages/inventory/index?domain=vegetables' });
  },
  home() {
    wx.reLaunch({ url: '/pages/home/index' });
  },
});
