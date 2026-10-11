import { useEffect, useState } from 'react';
import { Button, Card, Input, Select } from 'antd';
import {
  friendlyError,
  percentage,
  queryString,
  reportLabels,
  sourceLabels,
  type Archive,
  type PageQuery,
  type ReportName,
  type ReportRow,
  type UserRecord,
} from '@warehouse/contracts';
import { useAuth } from '../hooks/useAuth';
import { allPages, downloadReport } from '../api/client';
import { ErrorNotice, PageControls, PageHeading, ReportTable } from '../components/Common';
import { usePagedQuery } from '../hooks/usePagedQuery';
export function ReportsPage({ name }: { name: ReportName }) {
  const { can } = useAuth();
  const [filters, setFilters] = useState<PageQuery>({});
  const data = usePagedQuery<ReportRow>(`/api/reports/${name}`, filters);
  const [archives, setArchives] = useState<Archive[]>([]);
  const [growers, setGrowers] = useState<Archive[]>([]);
  const [drivers, setDrivers] = useState<UserRecord[]>([]);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    async function load() {
      try {
        const [packaging, vegetables, growerRows, users] = await Promise.all([
          can('archives.read') ? allPages<Archive>('/api/packaging-types') : Promise.resolve([]),
          can('archives.read') ? allPages<Archive>('/api/vegetable-types') : Promise.resolve([]),
          can('archives.read') ? allPages<Archive>('/api/growers') : Promise.resolve([]),
          can('users.read') ? allPages<UserRecord>('/api/users') : Promise.resolve([]),
        ]);
        setArchives([...packaging, ...vegetables]);
        setGrowers(growerRows);
        setDrivers(users.filter((user) => user.roles.split(',').includes('DRIVER')));
      } catch (failure) {
        setError(friendlyError(failure));
      }
    }
    void load();
  }, []);
  async function exportExcel() {
    setExporting(true);
    setError('');
    try {
      await downloadReport(
        `/api/reports/${name}/excel?${queryString(filters)}`,
        `${reportLabels[name]}.xlsx`,
      );
    } catch (failure) {
      setError(friendlyError(failure));
    } finally {
      setExporting(false);
    }
  }
  const rows =
    name === 'monthly-loss'
      ? data.rows.map((row) => ({
          ...row,
          lossRate: row.lossRate === null ? '—' : percentage(String(row.lossRate)),
        }))
      : data.rows;
  return (
    <>
      <PageHeading
        title={reportLabels[name]}
        description={
          name === 'monthly-loss'
            ? '按最终回收的业务月份统计：损耗 ÷ 同月结清批次累计下发。未结批次不进入分母。'
            : name === 'inventory-ledger'
              ? '保留原始及冲销逆转记录，便于追溯。'
              : name === 'vegetable-outbound'
                ? '实际出库量为正；手工直接出库展示为负。不同单位分别核对。'
                : '只统计有效业务效果，按业务日期筛选。Excel导出包括全部筛选结果，不仅当前页。'
        }
        extra={
          <Button
            style={{ display: can('reports.export') ? undefined : 'none' }}
            type="primary"
            loading={exporting}
            onClick={exportExcel}
          >
            导出全部筛选结果 Excel
          </Button>
        }
      />
      <div className="filter-bar">
        <label>
          开始日期
          <Input
            type="date"
            value={filters.from}
            onChange={(event) => setFilters({ ...filters, from: event.target.value })}
          />
        </label>
        <label>
          结束日期
          <Input
            type="date"
            value={filters.to}
            onChange={(event) => setFilters({ ...filters, to: event.target.value })}
          />
        </label>
        <label>
          品类
          <Select
            allowClear
            style={{ width: 190 }}
            value={filters.itemId}
            onChange={(itemId: number | undefined) => setFilters({ ...filters, itemId })}
            options={archives.map((item) => ({
              value: item.id,
              label: `${item.name} (${item.unit})`,
            }))}
          />
        </label>
        {name !== 'vegetable-outbound' && (
          <>
            <label>
              棚户
              <Select
                allowClear
                style={{ width: 170 }}
                value={filters.growerId}
                onChange={(growerId: number | undefined) => setFilters({ ...filters, growerId })}
                options={growers.map((item) => ({ value: item.id, label: item.name }))}
              />
            </label>
            <label>
              司机
              <Select
                allowClear
                style={{ width: 150 }}
                value={filters.driverId}
                onChange={(driverId: number | undefined) => setFilters({ ...filters, driverId })}
                options={drivers.map((item) => ({ value: item.id, label: item.name }))}
              />
            </label>
          </>
        )}
        {!['external-packaging', 'monthly-loss', 'vegetable-differences'].includes(name) && (
          <label>
            流水来源
            <Select
              allowClear
              style={{ width: 170 }}
              value={filters.source}
              onChange={(source: string | undefined) => setFilters({ ...filters, source })}
              options={Object.entries({
                ...sourceLabels,
                DISPATCH: '包装下发',
                CONSUMPTION: '包装消耗',
                RECOVERY: '司机回收',
                LOSS: '确认损耗',
                OUTBOUND: '蔬菜出库',
                REVERSAL: '冲销逆转',
              }).map(([value, label]) => ({ value, label }))}
            />
          </label>
        )}
        <Button onClick={() => setFilters({})}>清除筛选</Button>
      </div>
      <ErrorNotice message={data.error || error} />
      <Card>
        <ReportTable rows={rows} loading={data.loading} />
        <PageControls
          page={data.page}
          count={data.rows.length}
          loading={data.loading}
          onPage={data.setPage}
        />
      </Card>
    </>
  );
}
