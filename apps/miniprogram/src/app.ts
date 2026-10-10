import { settings } from './config/settings';
import type { EmployeeSession } from '@warehouse/contracts';
import type { WarehouseApp } from './types';
App<WarehouseApp>({
  globalData: { session: null, bindingToken: '', configurationError: '' },
  onLaunch() {
    const saved: unknown = wx.getStorageSync('warehouse:session');
    if (
      typeof saved === 'object' &&
      saved !== null &&
      'token' in saved &&
      typeof saved.token === 'string' &&
      'userId' in saved
    ) {
      this.globalData.session = saved as EmployeeSession;
    }
    if (settings.mode === 'cloud') {
      if (settings.envId) {
        wx.cloud.init({ env: settings.envId, traceUser: false });
      } else {
        this.globalData.configurationError = '请管理员先填写云托管环境配置，再重新打开小程序';
      }
    }
  },
});
