import { Alert, Button, Empty, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { statusLabels, type ReportRow } from '@warehouse/contracts';
import type { ReactNode } from 'react';
export function PageHeading({
  title,
  description,
  extra,
}: {
  title: string;
  description: string;
  extra?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <Typography.Title level={2}>{title}</Typography.Title>
        <p>{description}</p>
      </div>
      {extra}
    </div>
  );
}
export function ErrorNotice({ message }: { message: string }) {
  return message ? <Alert type="error" showIcon title={message} className="error-notice" /> : null;
}
export function StatusTag({ status }: { status: string }) {
  return (
    <Tag
      color={
        status === 'POSTED' || status === 'CLOSED'
          ? 'green'
          : status === 'DRAFT' || status === 'OPEN'
            ? 'gold'
            : 'default'
      }
    >
      {statusLabels[status] ?? status}
    </Tag>
  );
}
export function PageControls({
  page,
  count,
  loading,
  onPage,
}: {
  page: number;
  count: number;
  loading: boolean;
  onPage(page: number): void;
}) {
  return (
    <div className="page-controls">
      <span>
        第 {page} 页 · 本页 {count} 条
      </span>
      <Space>
        <Button disabled={page === 1 || loading} onClick={() => onPage(page - 1)}>
          上一页
        </Button>
        <Button disabled={count < 20 || loading} onClick={() => onPage(page + 1)}>
          下一页
        </Button>
      </Space>
    </div>
  );
}
export function dateText(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 10) : '—';
}
export function timeText(value?: string | null): string {
  if (!value) {
    return '—';
  }
  const utc = /Z$|[+-]\d\d:\d\d$/.test(value) ? value : value + 'Z';
  return new Date(utc).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}
export const fieldLabels: Record<string, string> = {
  id: '记录ID',
  number: '单据号',
  businessDate: '业务日期',
  name: '品类',
  itemName: '品类快照',
  unit: '单位',
  specification: '规格',
  growerName: '棚户',
  driverName: '司机',
  customerName: '客户',
  domain: '库存范围',
  event: '流水来源',
  quantity: '数量',
  delta: '数量变化',
  source: '来源',
  mode: '出库模式',
  actualQuantity: '实际出库量',
  displayQuantity: '展示数量',
  remark: '备注',
  dispatched: '累计下发',
  consumed: '累计已用',
  recovered: '累计收回',
  lost: '确认损耗',
  outstanding: '仍在外',
  daysOutside: '在外天数',
  month: '结清月份',
  lossRate: '损耗率',
  output: '现场产出',
  received: '实际入仓',
  difference: '产出减实收',
  status: '单据状态',
  reversalOf: '逆转原流水ID',
  createdAt: '创建时间',
  actorId: '操作者ID',
  action: '操作',
  entityType: '对象类型',
  entityId: '对象ID',
  reason: '原因',
  requestId: '请求ID',
};
export function cellText(key: string, value: unknown): ReactNode {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (key === 'status') {
    return <StatusTag status={String(value)} />;
  }
  if (key === 'businessDate') {
    return dateText(value);
  }
  if (key === 'createdAt') {
    return timeText(String(value));
  }
  if (key === 'mode') {
    return value === 'DIRECT' ? '手工直接出库（展示负数）' : '正常出库';
  }
  const labels: Record<string, string> = {
    WAREHOUSE_PACKAGING: '仓库包装',
    EXTERNAL_PACKAGING: '在外包装',
    VEGETABLE: '蔬菜库存',
    OPENING: '期初入库',
    REPLENISHMENT: '包装补充',
    EXTERNAL: '外来菜入库',
    ADJUSTMENT: '库存调整',
    REVERSAL: '冲销逆转',
    DISPATCH: '包装下发',
    WORK: '装菜记录',
    RECOVERY: '司机回收',
    OUTBOUND: '蔬菜出库',
    STOCK: '库存单',
    CONSUMPTION: '包装消耗',
    LOSS: '确认损耗',
  };
  return labels[String(value)] ?? String(value);
}
export function ReportTable({ rows, loading }: { rows: ReportRow[]; loading: boolean }) {
  const keys = rows[0] ? Object.keys(rows[0]) : [];
  const columns: TableColumnsType<ReportRow> = keys.map((key) => ({
    title: fieldLabels[key] ?? key,
    dataIndex: key,
    key,
    render: (value: unknown) => cellText(key, value),
  }));
  return (
    <Table
      rowKey={(row) => `${row.id}-${row.name ?? ''}-${row.month ?? ''}`}
      dataSource={rows}
      columns={columns}
      loading={loading}
      pagination={false}
      scroll={{ x: 'max-content' }}
      locale={{ emptyText: <Empty description="当前筛选没有记录" /> }}
    />
  );
}
