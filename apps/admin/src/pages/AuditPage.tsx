import { useState } from 'react';
import {
  Button,
  Descriptions,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from 'antd';
import {
  friendlyError,
  queryString,
  roleLabels,
  type AuditRecord,
  type OperationLog,
  type PageQuery,
} from '@warehouse/contracts';
import { downloadReport, list } from '../api/client';
import { ErrorNotice, PageControls, PageHeading, timeText } from '../components/Common';
import { usePagedQuery } from '../hooks/usePagedQuery';
const actions: Record<string, string> = {
  READ: '查询',
  CREATE: '新增',
  UPDATE: '修改',
  DELETE: '删除',
  EXPORT: '导出',
  POST: '提交入账',
  REVERSE: '冲销单据',
  CORRECT: '修正单据',
  LOGIN: '登录',
  LOGOUT: '退出',
  CONFIGURE: '调整权限',
  CREATE_USER: '创建用户',
  UPDATE_USER: '修改用户',
  CREATE_ARCHIVE: '新增档案',
  UPDATE_ARCHIVE: '修改档案',
  CREATE_DRAFT: '创建草稿',
  EDIT_DRAFT: '修改草稿',
  DELETE_DRAFT: '删除草稿',
  CONFIGURE_PERMISSIONS: '调整会计权限',
  APPROVE_BINDING: '批准绑定',
  REJECT_BINDING: '拒绝绑定',
  UNBIND: '解除绑定',
  CONFIRM_BINDING: '确认绑定',
};
const modules: Record<string, string> = {
  auth: '登录与身份',
  users: '员工资料',
  growers: '棚户档案',
  'packaging-types': '包装档案',
  'vegetable-types': '蔬菜档案',
  customers: '客户档案',
  inventory: '库存',
  batches: '业务批次',
  dispatches: '包装下发',
  'work-records': '装菜加工',
  recoveries: '司机回收',
  outbounds: '蔬菜出库',
  'stock-documents': '入库与调整',
  reports: '台账报表',
  documents: '单据冲销与修正',
  reconcile: '库存对账',
  'backoffice-permissions': '权限配置',
  'backoffice-operation-logs': '操作日志',
  'audit-logs': '变更审计',
};
function prettyJson(value?: string | null): string {
  if (!value) {
    return '无';
  }
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
function ChangeDetails({ rows }: { rows: AuditRecord[] }) {
  return (
    <>
      {rows.length === 0 ? (
        <p>此请求没有业务变更明细（查询、导出或被拒绝的操作不会修改业务数据）。</p>
      ) : (
        rows.map((row) => (
          <Descriptions
            key={row.id}
            column={1}
            bordered
            size="small"
            className="section-card"
            items={[
              {
                key: 'action',
                label: '操作对象',
                children: `${actions[row.action] ?? row.action} · ${row.entityType} #${row.entityId}`,
              },
              { key: 'reason', label: '原因', children: row.reason || '—' },
              {
                key: 'before',
                label: '变更前',
                children: <pre className="json-detail">{prettyJson(row.beforeJson)}</pre>,
              },
              {
                key: 'after',
                label: '变更后',
                children: <pre className="json-detail">{prettyJson(row.afterJson)}</pre>,
              },
            ]}
          />
        ))
      )}
    </>
  );
}
function Operations() {
  const [filters, setFilters] = useState<PageQuery>({});
  const data = usePagedQuery<OperationLog>('/api/backoffice-operation-logs', filters);
  const [detail, setDetail] = useState<OperationLog | null>(null);
  const [changes, setChanges] = useState<AuditRecord[]>([]);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  async function show(item: OperationLog) {
    setDetail(item);
    setChanges([]);
    setError('');
    try {
      setChanges(
        (await list<AuditRecord>('/api/audit-logs', { requestId: item.requestId, pageSize: 100 }))
          .items,
      );
    } catch (failure) {
      setError(friendlyError(failure));
    }
  }
  async function exportExcel() {
    setExporting(true);
    setError('');
    try {
      await downloadReport(
        `/api/backoffice-operation-logs/excel?${queryString(filters)}`,
        '后台操作记录.xlsx',
      );
    } catch (failure) {
      setError(friendlyError(failure));
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <div className="filter-bar">
        <Input
          aria-label="查询操作者或接口"
          placeholder="姓名、账号或接口路径"
          value={filters.search}
          onChange={(event) => setFilters({ ...filters, search: event.target.value || undefined })}
        />
        <InputNumber
          aria-label="操作者ID"
          placeholder="操作者ID"
          min={1}
          value={filters.actorId}
          onChange={(value) => setFilters({ ...filters, actorId: value ?? undefined })}
        />
        <Select
          aria-label="后台角色"
          placeholder="后台角色"
          allowClear
          style={{ width: 140 }}
          value={filters.role}
          onChange={(role) => setFilters({ ...filters, role })}
          options={['ADMIN', 'ACCOUNTANT'].map((value) => ({
            value,
            label: roleLabels[value as 'ADMIN'],
          }))}
        />
        <Select
          aria-label="操作类型"
          placeholder="操作类型"
          allowClear
          style={{ width: 150 }}
          value={filters.action}
          onChange={(action) => setFilters({ ...filters, action })}
          options={[
            'READ',
            'CREATE',
            'UPDATE',
            'DELETE',
            'EXPORT',
            'POST',
            'REVERSE',
            'CORRECT',
            'CONFIGURE',
            'LOGIN',
            'LOGOUT',
          ].map((value) => ({ value, label: actions[value] }))}
        />
        <Select
          aria-label="操作模块"
          placeholder="操作模块"
          allowClear
          style={{ width: 160 }}
          value={filters.module}
          onChange={(module) => setFilters({ ...filters, module })}
          options={Object.entries(modules).map(([value, label]) => ({ value, label }))}
        />
        <Select
          aria-label="HTTP结果"
          placeholder="HTTP结果"
          allowClear
          style={{ width: 150 }}
          value={filters.statusCode}
          onChange={(statusCode) => setFilters({ ...filters, statusCode })}
          options={[200, 204, 400, 401, 403, 404, 409, 422, 429, 500, 503, 504].map((value) => ({
            value,
            label: `${value} ${value < 400 ? '成功' : '失败'}`,
          }))}
        />
        <Input
          aria-label="请求ID筛选"
          placeholder="请求ID"
          value={filters.requestId}
          maxLength={64}
          onChange={(event) =>
            setFilters({ ...filters, requestId: event.target.value || undefined })
          }
        />
        <Input
          aria-label="操作开始日期"
          type="date"
          value={filters.from}
          onChange={(event) => setFilters({ ...filters, from: event.target.value || undefined })}
        />
        <Input
          aria-label="操作结束日期"
          type="date"
          value={filters.to}
          onChange={(event) => setFilters({ ...filters, to: event.target.value || undefined })}
        />
        <Space>
          <Button onClick={data.reload}>刷新操作记录</Button>
          <Button onClick={() => setFilters({})}>清除筛选</Button>
          <Button loading={exporting} onClick={exportExcel}>
            导出操作记录 Excel
          </Button>
        </Space>
      </div>
      <ErrorNotice message={data.error || error} />
      <Table
        rowKey="id"
        dataSource={data.rows}
        loading={data.loading}
        pagination={false}
        scroll={{ x: 1300 }}
        columns={[
          { title: '时间', render: (_, item) => timeText(item.createdAt) },
          {
            title: '操作者',
            render: (_, item) => `${item.actorName} (${item.username}) #${item.actorId}`,
          },
          {
            title: '角色',
            render: (_, item) =>
              item.actorRoles
                .split(',')
                .map((role) => roleLabels[role as 'ADMIN'] ?? role)
                .join('、'),
          },
          { title: '操作', render: (_, item) => actions[item.action] ?? item.action },
          { title: '模块', render: (_, item) => modules[item.module] ?? item.module },
          { title: '对象 / 接口', dataIndex: 'path' },
          {
            title: '结果',
            render: (_, item) => (
              <Tag
                color={
                  item.statusCode === null ? 'orange' : item.statusCode < 400 ? 'green' : 'red'
                }
              >
                {item.statusCode === null
                  ? '进行中 / 结果未确认'
                  : `${item.statusCode} ${item.statusCode < 400 ? '成功' : '失败'}`}
              </Tag>
            ),
          },
          {
            title: '详情',
            render: (_, item) => <Button onClick={() => show(item)}>查看操作</Button>,
          },
        ]}
      />
      <PageControls
        page={data.page}
        count={data.rows.length}
        loading={data.loading}
        onPage={data.setPage}
      />
      <Modal
        title="后台操作详情"
        open={Boolean(detail)}
        onCancel={() => setDetail(null)}
        footer={null}
        width={900}
      >
        <Descriptions
          column={1}
          items={[
            {
              key: 'actor',
              label: '操作者',
              children: `${detail?.actorName ?? ''} (${detail?.username ?? ''})`,
            },
            { key: 'request', label: '请求ID', children: detail?.requestId },
            {
              key: 'path',
              label: '操作对象',
              children: `${detail?.method ?? ''} ${detail?.path ?? ''}`,
            },
            { key: 'time', label: '执行时间', children: timeText(detail?.createdAt) },
            {
              key: 'result',
              label: '结果',
              children: `${detail?.statusCode ?? '结果未确认'} ${detail?.errorCode ?? ''}`,
            },
            { key: 'duration', label: '耗时', children: `${detail?.durationMs ?? '—'} 毫秒` },
            {
              key: 'filters',
              label: '查询条件',
              children: <pre className="json-detail">{prettyJson(detail?.queryJson)}</pre>,
            },
          ]}
        />
        <ChangeDetails rows={changes} />
        <ErrorNotice message={error} />
      </Modal>
    </>
  );
}
function Changes() {
  const [filters, setFilters] = useState<PageQuery>({});
  const data = usePagedQuery<AuditRecord>('/api/audit-logs', filters);
  const [detail, setDetail] = useState<AuditRecord | null>(null);
  return (
    <>
      <div className="filter-bar">
        <InputNumber
          aria-label="变更操作者ID"
          placeholder="操作者ID"
          min={1}
          value={filters.actorId}
          onChange={(value) => setFilters({ ...filters, actorId: value ?? undefined })}
        />
        <Input
          aria-label="变更请求ID"
          placeholder="请求ID"
          value={filters.requestId}
          onChange={(event) =>
            setFilters({ ...filters, requestId: event.target.value || undefined })
          }
        />
        <Input
          aria-label="开始日期"
          type="date"
          value={filters.from}
          onChange={(event) => setFilters({ ...filters, from: event.target.value || undefined })}
        />
        <Input
          aria-label="结束日期"
          type="date"
          value={filters.to}
          onChange={(event) => setFilters({ ...filters, to: event.target.value || undefined })}
        />
      </div>
      <ErrorNotice message={data.error} />
      <Table
        rowKey="id"
        dataSource={data.rows}
        loading={data.loading}
        pagination={false}
        scroll={{ x: 850 }}
        columns={[
          { title: '时间', render: (_, item) => timeText(item.createdAt) },
          {
            title: '操作者',
            render: (_, item) => `${item.actorName ?? ''} (${item.username ?? item.actorId})`,
          },
          { title: '操作', render: (_, item) => actions[item.action] ?? item.action },
          { title: '对象类型', dataIndex: 'entityType' },
          { title: '对象ID', dataIndex: 'entityId' },
          { title: '原因', dataIndex: 'reason' },
          {
            title: '变更明细',
            render: (_, item) => <Button onClick={() => setDetail(item)}>查看</Button>,
          },
        ]}
      />
      <PageControls
        page={data.page}
        count={data.rows.length}
        loading={data.loading}
        onPage={data.setPage}
      />
      <Modal
        title="审计详情"
        open={Boolean(detail)}
        onCancel={() => setDetail(null)}
        footer={null}
        width={800}
      >
        <p>请求ID：{detail?.requestId}</p>
        <ChangeDetails rows={detail ? [detail] : []} />
      </Modal>
    </>
  );
}
export function AuditPage() {
  return (
    <>
      <PageHeading
        title="管理审计"
        description="管理员查询全部后台用户的查询、导出、修改和删除操作，包含成功及失败结果；变更明细保留修改前后内容。时间按上海业务时区显示。"
      />
      <Tabs
        destroyOnHidden
        items={[
          { key: 'operations', label: '后台操作记录', children: <Operations /> },
          { key: 'changes', label: '业务变更明细', children: <Changes /> },
        ]}
      />
    </>
  );
}
