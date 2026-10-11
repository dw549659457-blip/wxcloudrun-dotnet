import { friendlyError, roleLabels, type Role } from '@warehouse/contracts';
import { requireSession, logout } from '../../services/session';
import { api } from '../../services/api';
import type { TapEvent } from '../../types';
import release from '../../release.json';
Page({
  data: {
    name: '',
    role: '',
    roles: [] as { value: Role; label: string }[],
    error: '',
    busy: false,
    version: release.version,
  },
  async onShow() {
    try {
      const session = await requireSession();
      if (session) {
        this.setData({
          name: session.name,
          role: session.selectedRole ?? '',
          roles: session.roles
            .filter((role) => ['ADMIN', 'DRIVER', 'WORKER', 'OUTBOUND'].includes(role))
            .map((role) => ({ value: role, label: roleLabels[role] })),
        });
      }
    } catch (failure) {
      this.setData({ error: friendlyError(failure) });
    }
  },
  async select(event: TapEvent) {
    if (this.data.busy) {
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      await api.request('POST', '/api/auth/select-role', {
        role: String(event.currentTarget.dataset.role),
      });
      wx.reLaunch({ url: '/pages/home/index' });
    } catch (failure) {
      this.setData({ error: friendlyError(failure) });
    } finally {
      this.setData({ busy: false });
    }
  },
  help() {
    wx.navigateTo({ url: '/pages/help/index' });
  },
  exit() {
    wx.showModal({
      title: '退出当前账号？',
      content: '本机草稿会清除。未确认的提交请先确认结果。',
      success: async (choice) => {
        if (choice.confirm) {
          try {
            await logout();
          } catch {
            /* 即使网络断开，也已在本机退出。 */
          }
        }
      },
    });
  },
});
