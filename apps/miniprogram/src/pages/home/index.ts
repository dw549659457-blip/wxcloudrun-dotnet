import {
  friendlyError,
  roleLabels,
  type Batch,
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
    overviewLoading: false,
    overviewError: '',
  },
  async onShow() {
    this.setData({ loading: true, error: '', pendingCount: 0, pendingBatches: [], overviewLoading: false, overviewError: '' });
    try {
      const session = await requireSession();
      if (!session) {
        return;
      }
      const roles = session.roles.filter((role) =>
        ['ADMIN', 'DRIVER', 'WORKER', 'OUTBOUND'].includes(role),
      );
      if (roles.length === 0) {
        this.setData({
          name: session.name,
          roles: [],
          role: '',
          roleName: '',
          selecting: false,
          error: '当前账号请使用管理后台；小程序支持管理员、司机、装菜人员或出库员岗位。',
        });
        return;
      }
      const selected = roles.some((role) => role === session.selectedRole)
        ? session.selectedRole
        : roles.length === 1
          ? roles[0]
          : null;
      if (selected && selected !== session.selectedRole) {
        await api.request('POST', '/api/auth/select-role', { role: selected });
        saveSession({ ...session, selectedRole: selected });
      }
      if (selected === 'ADMIN') {
        wx.redirectTo({ url: '/pages/admin/index' });
        return;
      }
      this.setData({
        name: session.name,
        roles: roles.map((role) => ({ value: role, label: roleLabels[role] })),
        role: selected ?? '',
        roleName: selected ? roleLabels[selected] : '',
        selecting: !selected,
        loading: false,
        overviewLoading: selected === 'DRIVER' || selected === 'WORKER',
      });
      if (selected === 'DRIVER' || selected === 'WORKER') {
        try {
          const batches = await allPages<Batch>('/api/batches');
          const open = batches.filter((batch) => batch.status === 'OPEN');
          this.setData({
            pendingCount: open.length,
            pendingBatches: open
              .slice(0, 3)
              .map((batch) => ({ ...batch, date: batch.businessDate.slice(0, 10) })),
          });
        } catch (failure) {
          this.setData({ overviewError: `任务概览暂时无法读取：${friendlyError(failure)}` });
        } finally {
          this.setData({ overviewLoading: false });
        }
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
  retry() {
    void this.onShow();
  },
});
