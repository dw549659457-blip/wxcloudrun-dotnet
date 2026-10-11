import {
  ApiError,
  displayQuantity,
  type StockNotificationLine,
  type StockNotification,
  type NotificationSubscription,
} from '@warehouse/contracts';
import { api } from './api';

export const notificationTime = (value: string) =>
  new Date(new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).getTime() + 480 * 60000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
export function notificationError(failure: unknown): string {
  if (failure instanceof ApiError) {
    if (['NOTIFICATIONS_NOT_READY', 'NOTIFICATION_NOT_CONFIGURED'].includes(failure.failure.code)) {
      return failure.message;
    }
    if (failure.status === 0) {
      return '网络暂时没有连上，当前显示上次更新的数据。';
    }
    if (failure.status >= 500) {
      return '动态服务暂时不可用，请稍后刷新。';
    }
    return failure.message;
  }
  return failure instanceof Error ? failure.message : '暂时没有更新，请稍后刷新。';
}
export function notificationLine(line: StockNotificationLine) {
  const quantity = displayQuantity(line.delta);
  const label = {
    WAREHOUSE_PACKAGING: '仓库包装',
    EXTERNAL_PACKAGING: '在外包装',
    VEGETABLE: '仓库蔬菜',
    OUTPUT: '装菜产出（未入库）',
  }[line.domain];
  return {
    ...line,
    key: `${line.domain}:${line.itemId}`,
    deltaText: `${quantity.startsWith('-') ? '' : '+'}${quantity}`,
    label,
    balanceText: line.balance === null ? '' : displayQuantity(line.balance),
  };
}
export function notificationView(notification: StockNotification) {
  return {
    ...notification,
    time: notificationTime(notification.occurredAt),
    lines: notification.lines.map(notificationLine),
  };
}
export function deliveryStatus(subscription: NotificationSubscription): string {
  if (!subscription.lastDelivery) {
    return '';
  }
  const messages: Record<string, string> = {
    PENDING: '微信提醒已排队',
    SENDING: '微信提醒正在发送',
    SENT: '上一条提醒已被微信接收',
    FAILED: '上一条微信提醒发送失败，请核对模板及授权',
    UNCERTAIN: '上一条微信提醒送达结果未确认',
    CANCELLED: '上一条微信提醒已取消',
  };
  return messages[subscription.lastDelivery.state] ?? '微信提醒状态正在更新';
}
export interface PendingSubscription {
  templateId: string;
  decision: 'accept' | 'reject' | 'ban';
  key: string;
}
const pendingKey = (userId: number) => `warehouse:notification-subscription:${userId}`;
export function pendingSubscription(userId: number): PendingSubscription | null {
  return (wx.getStorageSync(pendingKey(userId)) as PendingSubscription | undefined) ?? null;
}
export function rememberSubscription(userId: number, result: PendingSubscription): void {
  wx.setStorageSync(pendingKey(userId), result);
}
export function discardSubscription(userId: number): void {
  wx.removeStorageSync(pendingKey(userId));
}
export async function syncSubscription(userId: number, result: PendingSubscription): Promise<void> {
  await api.request(
    'POST',
    '/api/admin/stock-notifications/subscribe',
    { templateId: result.templateId, decision: result.decision },
    { 'Idempotency-Key': result.key },
  );
  wx.removeStorageSync(pendingKey(userId));
}
