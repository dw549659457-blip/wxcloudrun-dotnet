import { roleLabels } from '@warehouse/contracts';
import { appState } from '../../types';
Page({
  data: { role: '', roleName: '' },
  onShow() {
    const role = appState().globalData.session?.selectedRole;
    this.setData({ role: role ?? '', roleName: role ? roleLabels[role] : '' });
  },
  home() {
    wx.reLaunch({ url: '/pages/home/index' });
  },
});
