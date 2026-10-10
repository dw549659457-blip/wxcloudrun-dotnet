import { useEffect, useState } from 'react';
import { Alert, Descriptions, Table } from 'antd';
import {
  sourceLabels,
  signedOutbound,
  subtractQuantities,
  addQuantities,
  type Archive,
  type BatchSummary,
  type DocumentInput,
  type DocumentResource,
} from '@warehouse/contracts';
import { allPages, api } from '../api/client';
import { friendlyError } from '@warehouse/contracts';
import { ErrorNotice } from './Common';
export function DocumentSummary({
  document,
  resource,
  correction = false,
}: {
  document: DocumentInput;
  resource: DocumentResource;
  correction?: boolean;
}) {
  const [archives, setArchives] = useState<Archive[]>([]);
  const [batch, setBatch] = useState<BatchSummary | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const values = await Promise.all(
          ['packaging-types', 'vegetable-types', 'growers', 'customers'].map((name) =>
            allPages<Archive>(`/api/${name}`),
          ),
        );
        const summary = document.batchId
          ? await api.request<BatchSummary>('GET', `/api/batches/${document.batchId}/summary`)
          : null;
        if (active) {
          setArchives(values.flat());
          setBatch(summary);
        }
      } catch (failure) {
        if (active) {
          setError(friendlyError(failure));
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [document.batchId]);
  const rows = [
    ...document.items.map((line) => ({
      ...line,
      purpose:
        resource === 'work-records'
          ? '包装消耗'
          : resource === 'recoveries'
            ? '空包装回收'
            : '本次数量',
    })),
    ...(document.vegetables ?? []).map((line) => ({
      ...line,
      purpose: resource === 'work-records' ? '装菜产出' : '实收蔬菜',
    })),
  ].map((line, index) => ({
    key: index,
    purpose: line.purpose,
    grower: archives.find((item) => item.id === line.growerId)?.name,
    name: archives.find((item) => item.id === line.itemId)?.name ?? `品类#${line.itemId}`,
    unit: archives.find((item) => item.id === line.itemId)?.unit ?? '',
    quantity: line.quantity,
    display:
      resource === 'outbounds' ? signedOutbound(line.quantity, document.mode) : line.quantity,
    direction: line.direction === 'OUT' ? '减少' : '增加',
  }));
  return (
    <>
      <ErrorNotice message={error} />
      <Descriptions
        column={1}
        items={[
          { key: 'date', label: '业务日期', children: document.businessDate },
          {
            key: 'batch',
            label: '棚户 / 任务',
            children: batch
              ? `${batch.batch.growerName} · ${batch.batch.businessDate.slice(0, 10)}`
              : '—',
          },
          {
            key: 'customer',
            label: '客户',
            children: archives.find((item) => item.id === document.customerId)?.name ?? '—',
          },
          {
            key: 'mode',
            label: '业务方式',
            children:
              resource === 'recoveries'
                ? document.mode === 'FINAL'
                  ? '最终回收，结束任务'
                  : '部分回收，任务继续'
                : resource === 'outbounds'
                  ? document.mode === 'DIRECT'
                    ? '手工出库，报表展示负数'
                    : '正常出库'
                  : resource === 'stock-documents'
                    ? sourceLabels[document.source ?? '']
                    : '正常记账',
          },
          { key: 'remark', label: '备注 / 来源', children: document.remark || '—' },
        ]}
      />
      <Table
        rowKey="key"
        size="small"
        dataSource={rows}
        pagination={false}
        scroll={{ x: 520 }}
        columns={[
          { title: '用途', dataIndex: 'purpose' },
          { title: '棚户', dataIndex: 'grower' },
          { title: '品类', dataIndex: 'name' },
          { title: '单位', dataIndex: 'unit' },
          { title: '实际数量', dataIndex: 'quantity' },
          ...(resource === 'outbounds' ? [{ title: '展示数量', dataIndex: 'display' }] : []),
          ...(resource === 'stock-documents' ? [{ title: '方向', dataIndex: 'direction' }] : []),
        ]}
      />
      {resource === 'recoveries' && document.mode === 'FINAL' && (
        <>
          <Alert
            type="warning"
            title="本次结束该棚户任务。未收回包装记为损耗；服务器提交时再次核对。"
          />
          <p>损耗原因：{document.lossReason || '未填写'}</p>
          <p>差异原因：{document.differenceReason || '未填写'}</p>
          {batch && !correction && (
            <ul>
              {batch.packaging.map((balance) => {
                const returned = document.items
                  .filter((line) => line.itemId === balance.itemId)
                  .reduce((sum, line) => addQuantities(sum, line.quantity), '0');
                return (
                  <li key={balance.itemId}>
                    {balance.name}：当前在外 {balance.outstanding} − 本次回收 {returned} = 损耗{' '}
                    {subtractQuantities(balance.outstanding, returned)} {balance.unit}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );
}
