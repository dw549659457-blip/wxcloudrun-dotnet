export interface StockNotificationLine {
  itemId: number;
  name: string;
  unit: string;
  domain: 'WAREHOUSE_PACKAGING' | 'EXTERNAL_PACKAGING' | 'VEGETABLE' | 'OUTPUT';
  delta: string;
  balance: string | null;
}
export interface StockNotification {
  id: number;
  documentId: number;
  number: string;
  kind: string;
  action: 'POST' | 'REVERSE';
  title: string;
  actor: string;
  party: string;
  businessDate: string;
  occurredAt: string;
  lines: StockNotificationLine[];
  lineCount: number;
}
export interface NotificationSubscription {
  configured: boolean;
  templateId: string;
  configurationError: string;
  bound: boolean;
  paused: boolean;
  recordedSubscriptions: number;
  lastDelivery: { state: string; errorCode: number | null; createdAt: string } | null;
}
export interface StockNotificationFeed {
  items: { notification: StockNotification; isRead: boolean }[];
  latestId: number;
  unreadCount: number;
  hasMore: boolean;
  subscription: NotificationSubscription;
  updatedAt: string;
}
