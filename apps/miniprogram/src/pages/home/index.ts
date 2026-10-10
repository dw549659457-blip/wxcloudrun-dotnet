import {
  friendlyError,
  roleLabels,
  type Batch,
  type EmployeeSession,
  type Role,
} from '@warehouse/contracts';
import { requireSession, saveSession } from '../../services/session';
import { allPages, api } from '../../services/api';
import type { TapEvent } from '../../types';
Page({
  data: {
    name: '',
    role: '' as Role | '',
    roleName: '',
    roles: [] as { value: Role; label: string }[],
    selecting: false,
    loading: true,
    error: '',
    pendingCount: 0,
    pendingBatches: [] as (Batch & { date: string })[],
    guided: false,
  },
  async onShow() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await requireSession();
      if (!session) {
        return;
      }
      const roles = session.roles.filter((role) => role !== 'ADMIN');
      const selected = roles.some((role) => role === session.selectedRole)
        ? session.selectedRole
        : roles.length === 1
          ? roles[0]
          : null;
      if (selected && selected !== session.selectedRole) {
        await api.request('POST', '/api/auth/select-role', { role: selected });
        saveSession({ ...session, selectedRole: selected });
      }
      this.setData({
        name: session.name,
        roles: roles.map((role) => ({ value: role, label: roleLabels[role] })),
        role: selected ?? '',
        roleName: selected ? roleLabels[selected] : '',
        selecting: !selected,
        guided: selected
          ? !wx.getStorageSync(`warehouse:guide:${session.userId}:${selected}`)
          : false,
      });
      if (selected === 'DRIVER' || selected === 'WORKER') {
        const batches = await allPages<Batch>('/api/batches');
        this.setData({
          pendingCount: batches.filter((batch) => batch.status === 'OPEN').length,
          pendingBatches: batches
            .filter((batch) => batch.status === 'OPEN')
            .slice(0, 3)
            .map((batch) => ({ ...batch, date: batch.businessDate.slice(0, 10) })),
        });
      }
    } catch (failure) {
      this.setData({ error: friendlyError(failure) });
    } finally {
      this.setData({ loading: false });
    }
  },
  async chooseRole(event: TapEvent) {
    const role = String(event.currentTarget.dataset.role) as Role;
    if (this.data.loading) {
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      await api.request('POST', '/api/auth/select-role', { role });
      const session = await requireSession();
      if (session) {
        saveSession({ ...session, selectedRole: role });
      }
      await this.onShow();
    } catch (failure) {
      this.setData({ error: friendlyError(failure), loading: false });
    }
  },
  navigate(event: TapEvent) {
    wx.navigateTo({ url: String(event.currentTarget.dataset.url) });
  },
  dismissGuide() {
    const session = getApp<{ globalData: { session: EmployeeSession | null } }>().globalData
      .session;
    if (session) {
      wx.setStorageSync(`warehouse:guide:${session.userId}:${this.data.role}`, true);
    }
    this.setData({ guided: false });
  },
  retry() {
    void this.onShow();
  },
});
