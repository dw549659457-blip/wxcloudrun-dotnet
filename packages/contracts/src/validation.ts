import { quantityError } from './quantity';
import type { Archive, DocumentInput, DocumentResource } from './types';
export function validateDocument(
  document: DocumentInput,
  resource: DocumentResource,
  archives: Archive[],
  posting = true,
): string[] {
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(document.businessDate)) {
    errors.push('请选择业务日期');
  }
  if (resource === 'work-records' && (!document.items.length || !document.vegetables?.length)) {
    errors.push('装菜登记需要填写包装消耗和蔬菜产出');
  }
  if (resource === 'outbounds' && !['NORMAL', 'DIRECT'].includes(document.mode ?? '')) {
    errors.push('请选择正常出库或手工出库');
  }
  if (
    resource === 'stock-documents' &&
    !['OPENING', 'REPLENISHMENT', 'EXTERNAL', 'ADJUSTMENT'].includes(document.source ?? '')
  ) {
    errors.push('请选择库存来源');
  }
  if ((document.lossReason?.length ?? 0) > 500 || (document.differenceReason?.length ?? 0) > 500) {
    errors.push('原因最多500字');
  }
  if ((document.remark?.length ?? 0) > 500) {
    errors.push('备注最多500字');
  }
  const lines = [...document.items, ...(document.vegetables ?? [])];
  if (lines.length === 0 && !(resource === 'recoveries' && document.mode === 'FINAL')) {
    errors.push('请填写本次的品类和数量');
  }
  if (document.items.length > 200 || (document.vegetables?.length ?? 0) > 200) {
    errors.push('每组最多填写200行');
  }
  for (const line of lines) {
    const archive = archives.find((item) => item.id === line.itemId);
    if (!archive || !archive.enabled) {
      errors.push('请选择有效且启用的品类');
      continue;
    }
    const error = quantityError(line.quantity, archive.unit);
    if (error) {
      errors.push(`${archive.name}：${error}`);
    }
    if (resource === 'dispatches' && !line.growerId) {
      errors.push('每种包装都要选定棚户');
    }
  }
  if ((resource === 'work-records' || resource === 'recoveries') && !document.batchId) {
    errors.push('请选择棚户作业批次');
  }
  if (resource === 'recoveries' && !['PARTIAL', 'FINAL'].includes(document.mode ?? '')) {
    errors.push('请选择这户还没收完，或这户已经收完');
  }
  if (resource === 'recoveries' && document.mode === 'FINAL' && posting && !document.confirmFinal) {
    errors.push('请确认本次结束这个棚户任务');
  }
  if (resource === 'outbounds' && !document.customerId) {
    errors.push('请选择客户');
  }
  if (resource === 'outbounds' && document.mode === 'DIRECT' && !document.remark?.trim()) {
    errors.push('请说明手工出库的蔬菜来源');
  }
  if (
    resource === 'stock-documents' &&
    document.source === 'ADJUSTMENT' &&
    !document.remark?.trim()
  ) {
    errors.push('请填写库存调整原因');
  }
  return [...new Set(errors)];
}
