import { useState } from 'react';
import { Button, Descriptions, Input, Modal, Table } from 'antd';
import type { AuditRecord, PageQuery } from '@warehouse/contracts';
import { ErrorNotice, PageControls, PageHeading, timeText } from '../components/Common';
import { usePagedQuery } from '../hooks/usePagedQuery';
export function AuditPage() {
  const [filters, setFilters] = useState<PageQuery>({});
  const data = usePagedQuery<AuditRecord>('/api/audit-logs', filters);
  const [detail, setDetail] = useState<AuditRecord | null>(null);
  return (
    <>
      <PageHeading
        title="管理审计"
        description="查询员工、档案、绑定、单据冲销与修正记录。时间按上海业务时区显示。"
      />
      <div className="filter-bar">
        <Input
          aria-label="开始日期"
          type="date"
          value={filters.from}
          onChange={(event) => setFilters({ ...filters, from: event.target.value })}
        />
        <Input
          aria-label="结束日期"
          type="date"
          value={filters.to}
          onChange={(event) => setFilters({ ...filters, to: event.target.value })}
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
          { title: '操作者ID', dataIndex: 'actorId' },
          {
            title: '操作',
            dataIndex: 'action',
            render: (value: string) =>
              (
                ({
                  CREATE_USER: '创建用户',
                  UPDATE_USER: '修改用户',
                  CREATE_ARCHIVE: '新增档案',
                  UPDATE_ARCHIVE: '修改档案',
                  REVERSE: '冲销单据',
                  CORRECT: '修正单据',
                  APPROVE_BINDING: '批准绑定',
                  REJECT_BINDING: '拒绝绑定',
                  UNBIND: '解除绑定',
                }) as Record<string, string>
              )[value] ?? value,
          },
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
        open={detail !== null}
        onCancel={() => setDetail(null)}
        footer={null}
        width={760}
      >
        <Descriptions
          column={1}
          items={[
            { key: 'request', label: '请求ID', children: detail?.requestId },
            {
              key: 'before',
              label: '变更前',
              children: <pre className="json-detail">{detail?.beforeJson || '无'}</pre>,
            },
            {
              key: 'after',
              label: '变更后',
              children: <pre className="json-detail">{detail?.afterJson || '无'}</pre>,
            },
          ]}
        />
      </Modal>
    </>
  );
}
