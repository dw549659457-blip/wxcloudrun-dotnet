import type { EmployeeSession } from '@warehouse/contracts';
export interface WarehouseApp {
  globalData: { session: EmployeeSession | null; bindingToken: string; configurationError: string };
}
export interface InputEvent {
  detail: { value: string };
  currentTarget: { dataset: Record<string, string | number> };
}
export interface PickerEvent {
  detail: { value: string };
  currentTarget: { dataset: Record<string, string | number> };
}
export interface TapEvent {
  currentTarget: { dataset: Record<string, string | number> };
}
export interface PhoneEvent {
  detail: { code?: string; errMsg?: string };
}
export function appState(): WarehouseApp {
  return getApp<WarehouseApp>();
}
