import { useEffect, useState } from 'react';
import { Button, Card, Col, Row, Table, Typography } from 'antd';
import {
  friendlyError,
  summarizeInventory,
  type InventoryRow,
  type ReportRow,
} from '@warehouse/contracts';
import { allPages, api, list } from '../api/client';
import { ErrorNotice, PageHeading, ReportTable } from '../components/Common';
import { DataExportButton } from '../components/DataExportButton';
import { useAuth } from '../hooks/useAuth';
export function DashboardPage({ navigate }: { navigate(path: string): void }) {
  const { can } = useAuth();
  const [packaging, setPackaging] = useState<InventoryRow[]>([]);
  const [vegetables, setVegetables] = useState<InventoryRow[]>([]);
  const [outside, setOutside] = useState<ReportRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [consistency, setConsistency] = useState<string>('');
  async function reload() {
    setLoading(true);
    setError('');
    try {
      const [packagingRows, vegetableRows, external] = await Promise.all([
        can('inventory.read')
          ? allPages<InventoryRow>('/api/inventory/packaging')
          : Promise.resolve([]),
        can('inventory.read')
          ? allPages<InventoryRow>('/api/inventory/vegetables')
          : Promise.resolve([]),
        can('reports.read')
          ? list<ReportRow>('/api/reports/external-packaging')
          : Promise.resolve({ items: [] }),
      ]);
      setPackaging(packagingRows);
      setVegetables(vegetableRows);
      setOutside(external.items);
    } catch (failure) {
      setError(friendlyError(failure));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, []);
  async function reconcile() {
    setConsistency('正在检查');
    try {
      const result = await api.request<{ consistent: boolean; errors: unknown[] }>(
        'GET',
        '/api/admin/reconcile',
      );
      setConsistency(
        result.consistent
          ? '余额与流水一致'
          : `发现 ${result.errors.length} 项差异，请检查库存流水`,
      );
    } catch (failure) {
      setConsistency(friendlyError(failure));
    }
  }
  const inventoryColumns = [
    { title: '品类', dataIndex: 'name' },
    { title: '规格', dataIndex: 'specification' },
    { title: '当前可用量', dataIndex: 'quantity' },
    { title: '单位', dataIndex: 'unit' },
  ];
  return (
    <>
      <PageHeading
        title="仓库概览"
        description="查看当前实物库存与仍在外的包装。不同单位分别统计。"
        extra={<Button onClick={reload}>刷新数据</Button>}
      />
      <ErrorNotice message={error} />
      <Row gutter={[20, 20]} style={{ display: can('inventory.read') ? undefined : 'none' }}>
        <Col xs={24} md={12}>
          <Card title="仓库包装" loading={loading}>
            <div className="quantity-summary">
              {summarizeInventory(packaging).map((item) => (
                <span key={item.unit}>
                  <b>{item.quantity}</b> {item.unit}
                </span>
              ))}
            </div>
            <Typography.Text type="secondary">共 {packaging.length} 个包装档案</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="蔬菜可用库存" loading={loading}>
            <div className="quantity-summary">
              {summarizeInventory(vegetables).map((item) => (
                <span key={item.unit}>
                  <b>{item.quantity}</b> {item.unit}
                </span>
              ))}
            </div>
            <Typography.Text type="secondary">只包含已实际入仓的数量</Typography.Text>
          </Card>
        </Col>
      </Row>
      <div className="quick-actions">
        <Button
          style={{ display: can('documents.create') ? undefined : 'none' }}
          type="primary"
          onClick={() => navigate('/admin/stock')}
        >
          登记入库 / 库存调整
        </Button>
        <Button
          style={{ display: can('reports.read') ? undefined : 'none' }}
          onClick={() => navigate('/admin/reports/inventory-ledger')}
        >
          查看库存流水
        </Button>
        <Button style={{ display: can('reconcile.read') ? undefined : 'none' }} onClick={reconcile}>
          只读账本对账
        </Button>
        <span role="status">{consistency}</span>
      </div>
      <Row gutter={[20, 20]} style={{ display: can('inventory.read') ? undefined : 'none' }}>
        <Col xs={24} lg={12}>
          <Card
            title="包装库存明细"
            extra={<DataExportButton resource="inventory-packaging" module="inventory" />}
          >
            <Table
              rowKey="id"
              columns={inventoryColumns}
              dataSource={packaging}
              loading={loading}
              pagination={{ pageSize: 10 }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title="蔬菜库存明细"
            extra={<DataExportButton resource="inventory-vegetables" module="inventory" />}
          >
            <Table
              rowKey="id"
              columns={inventoryColumns}
              dataSource={vegetables}
              loading={loading}
              pagination={{ pageSize: 10 }}
            />
          </Card>
        </Col>
      </Row>
      <Card
        style={{ display: can('reports.read') ? undefined : 'none' }}
        title="近期在外包装 · 当前页"
        className="section-card"
        extra={
          <Button
            style={{ display: can('reports.read') ? undefined : 'none' }}
            onClick={() => navigate('/admin/reports/external-packaging')}
          >
            查看全部
          </Button>
        }
      >
        <ReportTable rows={outside} loading={loading} />
      </Card>
    </>
  );
}
