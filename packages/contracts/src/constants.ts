import type { ArchiveResource, DocumentResource, ReportName, Role } from './types';
export const roleLabels: Record<Role, string> = {
  ADMIN: '管理员',
  ACCOUNTANT: '后台管理员',
  DRIVER: '司机',
  WORKER: '装菜人员',
  OUTBOUND: '出库员',
};
export const resourceKinds = {
  dispatches: 'DISPATCH',
  'work-records': 'WORK',
  recoveries: 'RECOVERY',
  outbounds: 'OUTBOUND',
  'stock-documents': 'STOCK',
} as const;
export const documentLabels: Record<DocumentResource, string> = {
  dispatches: '包装下发',
  'work-records': '装菜登记',
  recoveries: '运回登记',
  outbounds: '蔬菜出库',
  'stock-documents': '库存入库与调整',
};
export const archiveLabels: Record<ArchiveResource, string> = {
  growers: '棚户',
  'packaging-types': '包装类型',
  'vegetable-types': '蔬菜品类',
  customers: '客户',
};
export const reportLabels: Record<ReportName, string> = {
  'packaging-ledger': '包装流水',
  'vegetable-inbound': '蔬菜入库',
  'vegetable-outbound': '蔬菜出库',
  'external-packaging': '在外包装',
  'monthly-loss': '包装损耗月报',
  'vegetable-differences': '产出与实收差异',
  'inventory-ledger': '完整库存流水',
};
export const statusLabels: Record<string, string> = {
  DRAFT: '草稿',
  POSTED: '已提交',
  REVERSED: '已冲销',
  OPEN: '还没收完',
  CLOSED: '已经收完',
  PENDING_APPROVAL: '等待管理员核实',
  APPROVED: '已批准，等待本人确认',
  REJECTED: '未批准',
  PENDING_CONFIRM: '等待本人确认',
};
export const sourceLabels: Record<string, string> = {
  OPENING: '期初库存',
  REPLENISHMENT: '包装补充',
  EXTERNAL: '外来菜入库',
  ADJUSTMENT: '库存调整',
};
export function isDocumentResource(value: string): value is DocumentResource {
  return Object.prototype.hasOwnProperty.call(documentLabels, value);
}
export function isRole(value: string): value is Role {
  return Object.prototype.hasOwnProperty.call(roleLabels, value);
}
export function queryString(query: Record<string, string | number | undefined> | object): string {
  const entries = Object.entries(query).filter(
    (entry) => entry[1] !== undefined && entry[1] !== '',
  );
  return entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}
export function businessDateNow(offsetMinutes = 480): string {
  return new Date(Date.now() + offsetMinutes * 60000).toISOString().slice(0, 10);
}
