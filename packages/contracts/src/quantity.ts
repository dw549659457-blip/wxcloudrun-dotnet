import Decimal from 'decimal.js';
import type { InventoryRow } from './types';
Decimal.set({ precision: 36, rounding: Decimal.ROUND_HALF_UP });
export function quantityError(value: string, unit: string): string | null {
  if (!/^[0-9]{1,15}(\.[0-9]{1,3})?$/.test(value)) {
    return '请输入正数，公斤最多保留三位小数';
  }
  const quantity = new Decimal(value);
  if (quantity.lessThanOrEqualTo(0)) {
    return '本次数量要大于零';
  }
  if (unit !== '公斤' && !quantity.isInteger()) {
    return `${unit || '包装'}数量必须是整数`;
  }
  return null;
}
export function addQuantities(left: string, right: string): string {
  return new Decimal(left || '0').plus(right || '0').toFixed();
}
export function subtractQuantities(left: string, right: string): string {
  return new Decimal(left || '0').minus(right || '0').toFixed();
}
export function compareQuantities(left: string, right: string): number {
  return new Decimal(left || '0').comparedTo(right || '0');
}
export function displayQuantity(value: string): string {
  return new Decimal(value || '0').toFixed();
}
export function signedOutbound(value: string, mode?: string): string {
  return mode === 'DIRECT' ? new Decimal(value).negated().toFixed() : displayQuantity(value);
}
export function percentage(value: string): string {
  return new Decimal(value).times(100).toFixed(2) + '%';
}
export function summarizeInventory(rows: InventoryRow[]): { unit: string; quantity: string }[] {
  const totals = new Map<string, string>();
  for (const row of rows) {
    totals.set(row.unit, addQuantities(totals.get(row.unit) ?? '0', row.quantity));
  }
  return Array.from(totals, ([unit, quantity]) => ({ unit, quantity }));
}
