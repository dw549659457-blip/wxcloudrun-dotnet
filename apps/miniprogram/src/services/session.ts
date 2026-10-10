import {
  ApiError,
  type BindingResponse,
  type EmployeeSession,
  type Identity,
} from '@warehouse/contracts';
import { appState } from '../types';
import { api } from './api';
import { settings } from '../config/settings';
export function clearDrafts(): void {
  for (const key of wx.getStorageInfoSync().keys) {
    if (key.startsWith('warehouse:draft:')) {
      wx.removeStorageSync(key);
    }
  }
}
export function saveSession(session: EmployeeSession): void {
  const previousOwner =
    appState().globalData.session?.userId ?? Number(wx.getStorageSync('warehouse:owner') || 0);
  if (previousOwner && previousOwner !== session.userId) {
    clearDrafts();
  }
  appState().globalData.session = session;
  appState().globalData.bindingToken = '';
  wx.setStorageSync('warehouse:session', session);
  wx.setStorageSync('warehouse:owner', session.userId);
}
export async function startWechatLogin(): Promise<EmployeeSession | BindingResponse> {
  const login = await new Promise<WechatMiniprogram.LoginSuccessCallbackResult>(
    (resolve, reject) => {
      wx.login({
        success: resolve,
        fail: () => reject(new Error('微信暂时没能确认身份，请点“重新进入”')),
      });
    },
  );
  const result = await api.request<EmployeeSession | BindingResponse>(
    'POST',
    '/api/auth/wechat-login',
    { code: login.code },
  );
  if ('token' in result) {
    saveSession(result);
  } else {
    appState().globalData.session = null;
    wx.removeStorageSync('warehouse:session');
    appState().globalData.bindingToken = result.bindingToken;
  }
  return result;
}
export async function requireSession(): Promise<EmployeeSession | null> {
  const session = appState().globalData.session;
  if (session) {
    try {
      const identity = await api.request<Identity>('GET', '/api/auth/me');
      const refreshed = {
        ...session,
        name: identity.name,
        roles: identity.roles,
        selectedRole: identity.selectedRole,
      };
      saveSession(refreshed);
      return refreshed;
    } catch (failure) {
      if (!(failure instanceof ApiError) || failure.status !== 401) {
        throw failure;
      }
      appState().globalData.session = null;
      wx.removeStorageSync('warehouse:session');
      if (settings.mode === 'local') {
        wx.reLaunch({ url: '/pages/start/index' });
        return null;
      }
    }
  }
  if (settings.mode === 'cloud') {
    const result = await startWechatLogin();
    if ('token' in result) {
      return result;
    }
  }
  wx.reLaunch({ url: '/pages/start/index' });
  return null;
}
export async function logout(): Promise<void> {
  try {
    await api.request('POST', '/api/auth/logout');
  } finally {
    clearDrafts();
    wx.removeStorageSync('warehouse:session');
    wx.removeStorageSync('warehouse:owner');
    appState().globalData.session = null;
    appState().globalData.bindingToken = '';
    wx.reLaunch({ url: '/pages/start/index' });
  }
}
