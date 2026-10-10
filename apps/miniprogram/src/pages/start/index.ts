import {
  friendlyError,
  roleLabels,
  type Candidate,
  type BindingStatus,
  type EmployeeSession,
} from '@warehouse/contracts';
import { api } from '../../services/api';
import { settings } from '../../config/settings';
import { appState, type InputEvent, type PhoneEvent } from '../../types';
import { requireSession, saveSession, startWechatLogin } from '../../services/session';
function candidateText(candidate: Candidate): string {
  return `${candidate.name} · ${candidate.roles.map((role) => roleLabels[role]).join('、')}`;
}
Page({
  data: {
    loading: false,
    stage: 'START',
    error: '',
    candidate: '',
    assistance: false,
    notice: '',
    development: settings.mode === 'local' && settings.developmentLogin,
    username: '',
    password: '',
    administratorPhone: settings.administratorPhone,
  },
  onLoad() {
    if (appState().globalData.session) {
      void requireSession()
        .then((session) => {
          if (session) {
            wx.reLaunch({ url: '/pages/home/index' });
          }
        })
        .catch((failure: unknown) => this.setData({ error: friendlyError(failure) }));
    } else if (appState().globalData.bindingToken) {
      this.setData({ stage: 'PHONE' });
    }
    if (settings.mode === 'cloud' && !settings.envId) {
      this.setData({ error: '管理员尚未填写云托管环境 ID，请先完成小程序配置。' });
    }
  },
  async begin() {
    if (this.data.loading) {
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const result = await startWechatLogin();
      if ('token' in result) {
        wx.reLaunch({ url: '/pages/home/index' });
      } else {
        this.setData({ stage: 'PHONE' });
      }
    } catch (failure) {
      this.setData({ error: friendlyError(failure) });
    } finally {
      this.setData({ loading: false });
    }
  },
  async phone(event: PhoneEvent) {
    if (this.data.loading) {
      return;
    }
    if (!event.detail.code) {
      this.setData({
        stage: 'ASSIST',
        assistance: true,
        error: '手机号没有授权成功。可以请管理员协助开通。',
      });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.request<BindingStatus>('POST', '/api/auth/bind-phone', {
        bindingToken: appState().globalData.bindingToken,
        phoneCode: event.detail.code,
      });
      const candidate = result.candidate ?? (result as BindingStatus & Candidate);
      this.setData({ stage: 'CONFIRM', candidate: candidateText(candidate) });
    } catch (failure) {
      this.setData({ error: friendlyError(failure), assistance: true, stage: 'ASSIST' });
    } finally {
      this.setData({ loading: false });
    }
  },
  async confirm() {
    if (this.data.loading) {
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const session = await api.request<EmployeeSession>('POST', '/api/auth/confirm-binding', {
        bindingToken: appState().globalData.bindingToken,
      });
      saveSession(session);
      wx.reLaunch({ url: '/pages/home/index' });
    } catch (failure) {
      this.setData({ error: friendlyError(failure) });
    } finally {
      this.setData({ loading: false });
    }
  },
  notMe() {
    this.setData({
      assistance: true,
      stage: 'ASSIST',
      candidate: '',
      notice: '请联系管理员核实姓名与手机号，批准后仍需要您本人确认。',
    });
  },
  async requestHelp() {
    if (this.data.loading) {
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      if (!appState().globalData.bindingToken) {
        const result = await startWechatLogin();
        if ('token' in result) {
          wx.reLaunch({ url: '/pages/home/index' });
          return;
        }
      }
      await api.request('POST', '/api/auth/binding-requests', {
        bindingToken: appState().globalData.bindingToken,
      });
      this.setData({
        stage: 'WAITING',
        notice: '已申请，请告诉管理员您的姓名。管理员核实后，点下面按钮查看结果。',
      });
    } catch (failure) {
      this.setData({ error: friendlyError(failure) });
    } finally {
      this.setData({ loading: false });
    }
  },
  async checkHelp() {
    if (this.data.loading) {
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.request<BindingStatus>('POST', '/api/auth/binding-status', {
        bindingToken: appState().globalData.bindingToken,
      });
      if (result.candidate && ['APPROVED', 'PENDING_CONFIRM'].includes(result.status)) {
        this.setData({
          stage: 'CONFIRM',
          candidate: candidateText(result.candidate),
          notice: '管理员已核实，请本人确认。',
        });
      } else {
        this.setData({
          notice:
            result.status === 'REJECTED'
              ? '管理员未批准，请联系管理员核实后重新申请。'
              : '仍在等待管理员核实，请稍后再查看。',
          assistance: result.status === 'REJECTED',
        });
      }
    } catch (failure) {
      this.setData({ error: friendlyError(failure) });
    } finally {
      this.setData({ loading: false });
    }
  },
  contact() {
    if (settings.administratorPhone) {
      wx.makePhoneCall({ phoneNumber: settings.administratorPhone });
    } else {
      this.setData({
        notice: '请联系为您登记账号的管理员，告知姓名和手机号，请他在管理后台核实。',
      });
    }
  },
  field(event: InputEvent) {
    const field = event.currentTarget.dataset.field;
    if (field === 'username') {
      this.setData({ username: event.detail.value });
    }
    if (field === 'password') {
      this.setData({ password: event.detail.value });
    }
  },
  async developmentLogin() {
    if (!this.data.development || this.data.loading) {
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const session = await api.request<EmployeeSession>('POST', '/api/auth/dev-login', {
        username: this.data.username,
        password: this.data.password,
      });
      this.setData({ password: '' });
      saveSession(session);
      wx.reLaunch({ url: '/pages/home/index' });
    } catch (failure) {
      this.setData({ error: friendlyError(failure) });
    } finally {
      this.setData({ loading: false });
    }
  },
});
