import { useState } from 'react';
import { Button, Drawer, Input, Table } from 'antd';
import { friendlyError, type Batch, type BatchSummary, type PageQuery } from '@warehouse/contracts';
import { api } from '../api/client';
import { DataExportButton } from '../components/DataExportButton';
import { ErrorNotice, PageControls, PageHeading } from '../components/Common';
import { usePagedQuery } from '../hooks/usePagedQuery';
export function BatchesPage() {
  const [filters, setFilters] = useState<PageQuery>({});
  const rows = usePagedQuery<Batch>('/api/batches', filters);
  const [detail, setDetail] = useState<BatchSummary | null>(null);
  const [error, setError] = useState('');
  async function show(id: number) {
    setError('');
    try {
      setDetail(await api.request<BatchSummary>('GET', `/api/batches/${id}/summary`));
    } catch (failure) {
      setError(friendlyError(failure));
    }
  }
  return (
    <>
      <PageHeading
        title="业务批次查询"
        description="查询司机下发批次、在外包装及产出与实收差异。已结清批次保留历史。"
        extra={<DataExportButton resource="batches" module="batches" filters={filters} />}
      />
      <div className="filter-bar">
        <Input
          aria-label="查询棚户"
          placeholder="棚户名称"
          value={filters.search}
          onChange={(event) => setFilters({ ...filters, search: event.target.value || undefined })}
        />
        <Input
          aria-label="批次开始日期"
          type="date"
          value={filters.from}
          onChange={(event) => setFilters({ ...filters, from: event.target.value || undefined })}
        />
        <Input
          aria-label="批次结束日期"
          type="date"
          value={filters.to}
          onChange={(event) => setFilters({ ...filters, to: event.target.value || undefined })}
        />
        <Button onClick={rows.reload}>刷新</Button>
      </div>
      <ErrorNotice message={error || rows.error} />
      <Table
        rowKey="id"
        dataSource={rows.rows}
        loading={rows.loading}
        pagination={false}
        scroll={{ x: 800 }}
        columns={[
          { title: '下发单号', dataIndex: 'number' },
          { title: '日期', dataIndex: 'businessDate' },
          { title: '棚户', dataIndex: 'growerName' },
          { title: '司机', dataIndex: 'driverName' },
          { title: '状态', render: (_, row) => (row.status === 'OPEN' ? '未结清' : '已结清') },
          {
            title: '明细',
            render: (_, row) => <Button onClick={() => show(row.id)}>查看批次</Button>,
          },
        ]}
      />
      <PageControls
        page={rows.page}
        count={rows.rows.length}
        loading={rows.loading}
        onPage={rows.setPage}
      />
      <Drawer
        title={`${detail?.batch.growerName ?? ''} · 批次明细`}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        size={760}
      >
        <h3>包装流转（按单位核对）</h3>
        <Table
          rowKey="itemId"
          dataSource={detail?.packaging ?? []}
          pagination={false}
          columns={[
            { title: '品类', dataIndex: 'name' },
            { title: '单位', dataIndex: 'unit' },
            { title: '下发', dataIndex: 'dispatched' },
            { title: '消耗', dataIndex: 'consumed' },
            { title: '回收', dataIndex: 'recovered' },
            { title: '损耗', dataIndex: 'lost' },
            { title: '在外', dataIndex: 'outstanding' },
          ]}
        />
        <h3>蔬菜产出与实收</h3>
        <Table
          rowKey="itemId"
          dataSource={detail?.vegetables ?? []}
          pagination={false}
          columns={[
            { title: '品类', dataIndex: 'name' },
            { title: '单位', dataIndex: 'unit' },
            { title: '现场产出', dataIndex: 'output' },
            { title: '实际运回', dataIndex: 'received' },
            { title: '差异', dataIndex: 'difference' },
          ]}
        />
      </Drawer>
    </>
  );
}
