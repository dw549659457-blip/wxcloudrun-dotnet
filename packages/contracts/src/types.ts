export type Role = 'ADMIN' | 'ACCOUNTANT' | 'DRIVER' | 'WORKER' | 'OUTBOUND';
export type DocumentResource =
  'dispatches' | 'work-records' | 'recoveries' | 'outbounds' | 'stock-documents';
export type DocumentKind = 'DISPATCH' | 'WORK' | 'RECOVERY' | 'OUTBOUND' | 'STOCK';
export type DocumentStatus = 'DRAFT' | 'POSTED' | 'REVERSED';
export type ArchiveResource = 'growers' | 'packaging-types' | 'vegetable-types' | 'customers';
export type ReportName =
  | 'packaging-ledger'
  | 'vegetable-inbound'
  | 'vegetable-outbound'
  | 'external-packaging'
  | 'monthly-loss'
  | 'vegetable-differences'
  | 'inventory-ledger';
export interface Identity {
  id: number;
  name: string;
  roles: Role[];
  sessionType: 'WEB_ADMIN' | 'MINIPROGRAM';
  selectedRole?: Role | null;
  permissions?: string[];
}
export interface EmployeeSession {
  userId: number;
  name: string;
  roles: Role[];
  token: string;
  selectedRole?: Role | null;
}
export interface AdminLogin {
  userId: number;
  name: string;
  roles: Role[];
  csrfToken: string;
  permissions: string[];
}
export interface BindingResponse {
  bindingToken: string;
  status: string;
  expiresInSeconds: number;
}
export interface Candidate {
  name: string;
  roles: Role[];
}
export interface BindingStatus {
  status: string;
  candidate?: Candidate | null;
}
export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
}
export interface PageQuery {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  sort?: 'asc' | 'desc';
  itemId?: number;
  growerId?: number;
  driverId?: number;
  source?: string;
  search?: string;
  actorId?: number;
  action?: string;
  module?: string;
  statusCode?: number;
  role?: Role;
  requestId?: string;
}
export interface PermissionDefinition {
  key: string;
  module: string;
  label: string;
  defaultGranted: boolean;
  fixed?: boolean;
}
export interface PermissionPolicy {
  role: 'ACCOUNTANT';
  version: number;
  catalog: PermissionDefinition[];
  permissions: string[];
}
export interface OperationLog {
  id: number;
  actorId: number;
  username: string;
  actorName: string;
  actorRoles: string;
  action: string;
  module: string;
  method: string;
  path: string;
  queryJson: string;
  requestId: string;
  statusCode: number | null;
  state: 'STARTED' | 'COMPLETED';
  errorCode: string | null;
  durationMs: number | null;
  createdAt: string;
  completedAt: string | null;
}
export interface Archive {
  id: number;
  kind: string;
  name: string;
  unit: string;
  specification: string;
  enabled: boolean;
  contact?: string;
  phone?: string;
}
export interface ArchiveInput {
  name: string;
  unit: string;
  specification: string;
  contact: string;
  phone: string;
  enabled: boolean;
}
export interface UserRecord {
  id: number;
  username: string;
  name: string;
  phone: string | null;
  enabled: boolean;
  bound: boolean;
  roles: string;
}
export interface UserInput {
  username: string;
  name: string;
  phone: string;
  roles: Role[];
  enabled: boolean;
  password?: string;
}
// 所有业务数量使用十进制字符串；前端不把数量转成 Number 或浮点库存。
export interface QuantityLine {
  itemId: number;
  quantity: string;
  growerId?: number | null;
  direction?: 'IN' | 'OUT';
}
export interface DocumentInput {
  businessDate: string;
  items: QuantityLine[];
  vegetables?: QuantityLine[];
  batchId?: number | null;
  customerId?: number | null;
  mode?: string;
  source?: string;
  remark?: string;
  confirmFinal?: boolean;
  lossReason?: string;
  differenceReason?: string;
}
export interface DisplayLine {
  itemId: number;
  actualQuantity: string;
  displayQuantity: string;
}
export interface DocumentRecord {
  id: number;
  number: string;
  kind: DocumentKind;
  creatorId: number;
  status: DocumentStatus;
  version: number;
  input: DocumentInput;
  replacesId?: number | null;
  displayItems: DisplayLine[];
  customerName?: string | null;
  creatorName?: string;
  createdAt?: string | null;
  postedAt?: string | null;
}
export interface DocumentItem {
  growerName?: string | null;
  id: number;
  itemId: number;
  lineKind: string;
  itemName: string;
  unit: string;
  specification: string;
  quantity: string;
  actualQuantity: string;
  displayQuantity: string;
  growerId?: number | null;
  batchId?: number | null;
}
export interface DocumentDetail {
  document: DocumentRecord;
  items: DocumentItem[];
  context?: { growerName?: string | null; driverName?: string | null };
}
export interface SubmissionResult {
  id: number;
  number: string;
  status: DocumentStatus;
  version: number;
}
export interface SubmissionStatus {
  status: 'SUCCEEDED' | 'FAILED' | 'PENDING' | 'NOT_SUBMITTED';
  result?: SubmissionResult | null;
  failureCode?: string;
}
export interface Batch {
  id: number;
  dispatchId: number;
  growerId: number;
  growerName: string;
  status: 'OPEN' | 'CLOSED' | 'REVERSED';
  version: number;
  number: string;
  businessDate: string;
  driverName: string;
}
export interface PackagingBalance {
  itemId: number;
  name: string;
  unit: string;
  outstanding: string;
  dispatched?: string;
  consumed?: string;
  recovered?: string;
  lost?: string;
}
export interface VegetableBalance {
  itemId: number;
  name: string;
  unit: string;
  output: string;
  received: string;
  difference: string;
}
export interface BatchSummary {
  batch: Batch;
  packaging: PackagingBalance[];
  vegetables: VegetableBalance[];
}
export interface InventoryRow {
  id: number;
  name: string;
  unit: string;
  specification: string;
  enabled: boolean;
  quantity: string;
  version: number;
}
export type ReportRow = Record<string, string | number | boolean | null>;
export interface BindingRequest {
  id: number;
  status: string;
  candidateUserId?: number | null;
  reason: string;
  createdAt: string;
  expiresAt: string;
}
export interface AuditRecord {
  id: number;
  actorId: number;
  actorName?: string;
  username?: string;
  action: string;
  entityType: string;
  entityId: number;
  beforeJson: string | null;
  afterJson: string | null;
  reason: string;
  requestId: string;
  createdAt: string;
}
export interface ApiFailure {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}
export type RequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export interface ApiTransport {
  request<T>(
    method: RequestMethod,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T>;
}
