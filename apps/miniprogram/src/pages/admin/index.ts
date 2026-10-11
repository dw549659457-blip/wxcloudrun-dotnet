import {
  ApiError,
  type InventoryRow,
  type PageResult,
  type StockNotificationFeed,
  type NotificationSubscription,
} from '@warehouse/contracts';
import { api } from '../../services/api';
import { requireSession } from '../../services/session';
import {
  notificationError,
  notificationTime,
  notificationView,
  pendingSubscription,
  rememberSubscription,
  syncSubscription,
  discardSubscription,
  deliveryStatus,
} from '../../services/notifications';
import type { TapEvent } from '../../types';

const base = '/api/admin/stock-notifications';
Page({
  timer: null as ReturnType<typeof setTimeout> | null,
  visible: false,
  generation: 0,
  fetching: false,
  ownerId: 0,
  data: {
    name: '',
    loading: true,
    busy: false,
    error: '',
    notice: '',
    lastUpdated: '',
    unreadCount: 0,
    latestId: 0,
    displayedLatest: 0,
    newCount: 0,
    expanded: false,
    hasMore: false,
    items: [] as {
      id: number;
      notification: ReturnType<typeof notificationView>;
      isRead: boolean;
    }[],
    vegetables: [] as InventoryRow[],
    packaging: [] as InventoryRow[],
    subscription: null as NotificationSubscription | null,
    pendingSubscription: false,
    deliveryText: '',
  },
  async onShow() {
    this.visible = true;
    const generation = ++this.generation;
    this.setData({ loading: true, error: '' });
    try {
      const session = await requireSession();
      if (!this.visible || generation !== this.generation) {
        return;
      }
      if (!session) {
        this.setData({ items: [], vegetables: [], packaging: [], subscription: null });
        this.visible = false;
        return;
      }
      if (!session.roles.includes('ADMIN')) {
        throw new ApiError(403, { code: 'FORBIDDEN', message: '仅管理员可以查看库存动态。' });
      }
      if (this.ownerId && this.ownerId !== session.userId) {
        this.setData({
          items: [],
          vegetables: [],
          packaging: [],
          subscription: null,
          expanded: false,
        });
      }
      this.ownerId = session.userId;
      this.setData({
        name: session.name,
        pendingSubscription: Boolean(pendingSubscription(session.userId)),
      });
      await this.refresh(true);
    } catch (failure) {
      this.fail(failure);
    } finally {
      if (generation === this.generation) {
        this.setData({ loading: false });
      }
      this.schedule();
    }
  },
  onHide() {
    this.stop();
  },
  onUnload() {
    this.stop();
  },
  stop() {
    this.visible = false;
    this.generation++;
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = null;
  },
  schedule() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    if (!this.visible) {
      return;
    }
    this.timer = setTimeout(async () => {
      await this.refresh();
      this.schedule();
    }, 5000);
  },
  fail(failure: unknown) {
    if (failure instanceof ApiError && [401, 403].includes(failure.status)) {
      this.stop();
      this.setData({
        items: [],
        vegetables: [],
        packaging: [],
        subscription: null,
        unreadCount: 0,
        latestId: 0,
      });
    }
    this.setData({ error: notificationError(failure), loading: false });
  },
  async refresh(reset = false) {
    if (!this.visible || this.fetching) {
      return;
    }
    const generation = this.generation;
    this.fetching = true;
    try {
      const [feed, vegetables, packaging] = await Promise.all([
        api.request<StockNotificationFeed>('GET', base),
        api.request<PageResult<InventoryRow>>('GET', '/api/inventory/vegetables?pageSize=5'),
        api.request<PageResult<InventoryRow>>('GET', '/api/inventory/packaging?pageSize=5'),
      ]);
      if (!this.visible || generation !== this.generation) {
        return;
      }
      const replace = reset || !this.data.expanded;
      this.setData({
        unreadCount: feed.unreadCount,
        latestId: feed.latestId,
        subscription: feed.subscription,
        deliveryText: deliveryStatus(feed.subscription),
        vegetables: vegetables.items,
        packaging: packaging.items,
        lastUpdated: notificationTime(feed.updatedAt),
        error: '',
        ...(replace
          ? {
              items: feed.items.map((row) => ({
                ...row,
                id: row.notification.id,
                notification: notificationView(row.notification),
              })),
              hasMore: feed.hasMore,
              expanded: false,
              displayedLatest: feed.latestId,
              newCount: 0,
            }
          : {
              newCount:
                feed.latestId > this.data.displayedLatest
                  ? feed.items.filter((row) => row.notification.id > this.data.displayedLatest)
                      .length
                  : 0,
            }),
      });
    } catch (failure) {
      if (this.visible && generation === this.generation) {
        this.fail(failure);
      }
    } finally {
      this.fetching = false;
    }
  },
  reload() {
    void this.refresh(true);
  },
  async more() {
    if (this.data.busy || !this.data.hasMore || this.fetching) {
      return;
    }
    const generation = this.generation;
    const before = this.data.items[this.data.items.length - 1]?.notification.id;
    if (!before) {
      return;
    }
    this.setData({ busy: true });
    this.fetching = true;
    try {
      const feed = await api.request<StockNotificationFeed>('GET', `${base}?before=${before}`);
      if (!this.visible || generation !== this.generation) {
        return;
      }
      this.setData({
        items: [
          ...this.data.items,
          ...feed.items.map((row) => ({
            ...row,
            id: row.notification.id,
            notification: notificationView(row.notification),
          })),
        ],
        hasMore: feed.hasMore,
        expanded: true,
      });
    } catch (failure) {
      if (this.visible && generation === this.generation) {
        this.fail(failure);
      }
    } finally {
      this.fetching = false;
      this.setData({ busy: false });
    }
  },
  async readAll() {
    if (this.data.busy || !this.data.latestId) {
      return;
    }
    this.setData({ busy: true, notice: '' });
    try {
      await api.request('POST', `${base}/read`, { throughId: this.data.latestId });
      this.setData({ expanded: false });
      await this.refresh(true);
    } catch (failure) {
      this.fail(failure);
    } finally {
      this.setData({ busy: false });
    }
  },
  detail(event: TapEvent) {
    wx.navigateTo({
      url: `/pages/notification/index?id=${Number(event.currentTarget.dataset.id)}`,
    });
  },
  inventory(event: TapEvent) {
    wx.navigateTo({
      url: `/pages/inventory/index?domain=${String(event.currentTarget.dataset.domain)}`,
    });
  },
  profile() {
    wx.navigateTo({ url: '/pages/profile/index' });
  },
  subscribe() {
    const templateId = this.data.subscription?.templateId;
    if (
      !templateId ||
      !this.data.subscription?.configured ||
      this.data.busy ||
      this.data.pendingSubscription
    ) {
      return;
    }
    if (typeof wx.requestSubscribeMessage !== 'function') {
      this.setData({ error: '请更新微信后订阅提醒。' });
      return;
    }
    this.setData({ busy: true, error: '', notice: '' });
    // 在用户点击时直接请求授权，不在后台轮询、onShow或网络请求之后弹出授权。
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: async (result) => {
        const decision = result[templateId];
        if (!['accept', 'reject', 'ban'].includes(String(decision))) {
          this.setData({ busy: false, error: '没有收到有效的微信订阅结果，请重新操作。' });
          return;
        }
        const request = {
          templateId,
          decision: decision as 'accept' | 'reject' | 'ban',
          key: `notify-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        };
        rememberSubscription(this.ownerId, request);
        this.setData({ pendingSubscription: true });
        await this.sync();
      },
      fail: () =>
        this.setData({ busy: false, error: '未完成微信订阅，可稍后重试；小程序内动态照常保留。' }),
    });
  },
  async sync() {
    const request = pendingSubscription(this.ownerId);
    if (!request) {
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      await syncSubscription(this.ownerId, request);
      this.setData({
        pendingSubscription: false,
        notice:
          request.decision === 'accept'
            ? '已登记本次订阅。下一次变动以微信实际授权为准；更多记录可在此查看。'
            : '本次没有订阅微信提醒，小程序内动态照常保留。',
      });
      await this.refresh();
    } catch (failure) {
      this.setData({
        error: `${notificationError(failure)} 订阅登记尚未确认，请点击“同步订阅结果”。`,
      });
    } finally {
      this.setData({ busy: false });
    }
  },
  async pause() {
    if (!this.data.subscription || this.data.busy) {
      return;
    }
    this.setData({ busy: true });
    try {
      await api.request('POST', `${base}/preference`, { paused: !this.data.subscription.paused });
      await this.refresh();
    } catch (failure) {
      this.fail(failure);
    } finally {
      this.setData({ busy: false });
    }
  },
  discardPending() {
    if (this.data.busy) {
      return;
    }
    discardSubscription(this.ownerId);
    this.setData({
      pendingSubscription: false,
      notice: '已清除本机待同步登记。如需新提醒，请主动订阅。',
    });
  },
});
