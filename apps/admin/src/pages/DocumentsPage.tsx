import { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Input, Modal, Space, Table } from 'antd';
import {
  ApiError,
  sourceLabels,
  documentLabels,
  friendlyError,
  queryString,
  resourceKinds,
  type DocumentDetail,
  type DocumentInput,
  type DocumentRecord,
  type DocumentResource,
  type PageQuery,
} from '@warehouse/contracts';
import { api } from '../api/client';
import { DocumentSummary } from '../components/DocumentSummary';
import { DocumentEditor } from '../components/DocumentEditor';
import { ErrorNotice, PageControls, PageHeading, StatusTag, timeText } from '../components/Common';
import { usePagedQuery } from '../hooks/usePagedQuery';
import { useSubmission } from '../hooks/useSubmission';

function DependencyNotice({ error }: { error: unknown }) {
  if (
    !(error instanceof ApiError) ||
    error.failure.code !== 'DEPENDENCY_BLOCKS_REVERSAL' ||
    !Array.isArray(error.failure.details)
  ) {
    return null;
  }
  return (
    <Alert
      type="warning"
      title="先按逆序处理以下依赖单据"
      description={
        <ul>
          {error.failure.details.map((value: unknown) => {
            if (
              typeof value !== 'object' ||
              value === null ||
              !('id' in value) ||
              !('number' in value) ||
              !('kind' in value)
            ) {
              return null;
            }
            const resource = Object.entries(resourceKinds).find(
              (entry) => entry[1] === value.kind,
            )?.[0];
            return (
              <li key={String(value.id)}>
                <a href={`/admin/documents/${resource}?document=${String(value.id)}`}>
                  {String(value.number)}
                </a>
              </li>
            );
          })}
        </ul>
      }
    />
  );
}
export function DocumentsPage({ resource }: { resource: DocumentResource }) {
  const [filters, setFilters] = useState<PageQuery>({});
  const data = usePagedQuery<DocumentRecord>(`/api/${resource}`, filters);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [action, setAction] = useState<'new' | 'edit' | 'correct' | 'reverse' | null>(null);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState<DocumentInput | null>(null);
  const [draftIntent, setDraftIntent] = useState(false);
  const submission = useSubmission(`documents:${resource}`, (result) => {
    setAction(null);
    setConfirmation(null);
    setDetail(null);
    setError('');
    void data.reload();
    if (result.status === 'DRAFT') {
      setError('');
    }
  });
  async function showDetail(id: number) {
    setLoadingDetail(true);
    setError('');
    try {
      setDetail(await api.request<DocumentDetail>('GET', `/api/${resource}/${id}`));
    } catch (failure) {
      setError(friendlyError(failure));
    } finally {
      setLoadingDetail(false);
    }
  }
  useEffect(() => {
    const id = Number(new URLSearchParams(location.search).get('document'));
    if (id > 0) {
      void showDetail(id);
    }
  }, [resource]);
  function openAction(value: typeof action) {
    if (submission.pending) {
      setError('请先确认原提交结果');
      return;
    }
    setAction(value);
    setReason('');
    setConfirmation(null);
    setError('');
  }
  async function finish() {
    if (!confirmation) {
      return;
    }
    if (action === 'correct') {
      await submission.submit(
        `${resourceKinds[resource]}:${detail?.document.id}:correct`,
        `/api/admin/documents/${resource}/${detail?.document.id}/correct`,
        { reason, document: confirmation },
      );
    } else if (action === 'edit' && detail) {
      try {
        const edited = await api.request<{ version: number }>(
          'PUT',
          `/api/${resource}/${detail.document.id}?${queryString({ version: detail.document.version })}`,
          confirmation,
        );
        setDetail({
          ...detail,
          document: { ...detail.document, input: confirmation, version: edited.version },
        });
        if (draftIntent) {
          setAction(null);
          setConfirmation(null);
          await data.reload();
          await showDetail(detail.document.id);
        } else {
          await submission.submit(
            `${resourceKinds[resource]}:${detail.document.id}:post`,
            `/api/${resource}/${detail.document.id}/post`,
            { version: edited.version },
          );
        }
      } catch (failure) {
        setError(friendlyError(failure));
      }
    } else {
      await submission.submit(`${resourceKinds[resource]}:create`, `/api/${resource}`, {
        post: !draftIntent,
        document: confirmation,
      });
    }
  }
  async function reverse() {
    if (!reason.trim()) {
      setError('请填写冲销原因');
      return;
    }
    await submission.submit(
      `${resourceKinds[resource]}:${detail?.document.id}:reverse`,
      `/api/admin/documents/${resource}/${detail?.document.id}/reverse`,
      { reason },
    );
  }
  async function deleteDraft() {
    if (!detail) {
      return;
    }
    try {
      await api.request('DELETE', `/api/${resource}/${detail.document.id}`);
      setDetail(null);
      await data.reload();
    } catch (failure) {
      setError(friendlyError(failure));
    }
  }
  return (
    <>
      <PageHeading
        title={`${documentLabels[resource]}单据`}
        description="查看全部业务单据。草稿尚未入账；已提交单据通过冲销或原子重建更正并保留历史。"
        extra={
          <Button
            type="primary"
            onClick={() => {
              setDetail(null);
              openAction('new');
            }}
          >
            新建{documentLabels[resource]}
          </Button>
        }
      />
      <div className="filter-bar">
        <label>
          起始日期
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
        <Button onClick={data.reload}>刷新</Button>
      </div>
      <ErrorNotice message={data.error || error || submission.errorMessage} />
      {submission.pending && (
        <Alert
          type="warning"
          title={submission.message || '有一笔原提交等待确认'}
          action={
            <Button loading={submission.loading} onClick={submission.retry}>
              继续确认原提交
            </Button>
          }
        />
      )}
      <Table
        rowKey="id"
        dataSource={data.rows}
        loading={data.loading || loadingDetail}
        pagination={false}
        scroll={{ x: 1000 }}
        columns={[
          {
            title: '单据号',
            dataIndex: 'number',
            render: (number: string, item) => (
              <Button type="link" onClick={() => showDetail(item.id)}>
                {number}
              </Button>
            ),
          },
          { title: '业务日期', render: (_, item) => item.input.businessDate },
          { title: '操作者', render: (_, item) => item.creatorName ?? `员工 ${item.creatorId}` },
          { title: '状态', render: (_, item) => <StatusTag status={item.status} /> },
          {
            title: '模式 / 来源',
            render: (_, item) =>
              resource === 'outbounds'
                ? item.input.mode === 'DIRECT'
                  ? '手工直接出库 · 展示负数'
                  : '正常出库'
                : item.input.mode === 'FINAL'
                  ? '最终回收'
                  : item.input.mode === 'PARTIAL'
                    ? '部分回收'
                    : (sourceLabels[item.input.source ?? ''] ?? '—'),
          },
          { title: '创建时间', render: (_, item) => timeText(item.createdAt) },
          { title: '备注', render: (_, item) => item.input.remark || '—' },
        ]}
      />
      <PageControls
        page={data.page}
        count={data.rows.length}
        loading={data.loading}
        onPage={data.setPage}
      />
      <Drawer
        title={detail?.document.number}
        open={detail !== null && action === null}
        onClose={() => setDetail(null)}
        size="large"
      >
        <Descriptions
          column={1}
          items={[
            { key: 'date', label: '业务日期', children: detail?.document.input.businessDate },
            {
              key: 'status',
              label: '状态',
              children: detail && <StatusTag status={detail.document.status} />,
            },
            {
              key: 'creator',
              label: '创建者',
              children: detail?.document.creatorName ?? detail?.document.creatorId,
            },
            { key: 'created', label: '创建时间', children: timeText(detail?.document.createdAt) },
            { key: 'remark', label: '备注', children: detail?.document.input.remark },
          ]}
        />
        {detail?.document.input.mode === 'DIRECT' && (
          <Alert title="手工直接出库：实际出库量为正，展示数量为负，库存按实际量扣减。" />
        )}
        <Table
          rowKey="id"
          dataSource={detail?.items ?? []}
          pagination={false}
          columns={[
            { title: '品类快照', dataIndex: 'itemName' },
            { title: '单位', dataIndex: 'unit' },
            { title: '实际数量', dataIndex: 'actualQuantity' },
            { title: '展示数量', dataIndex: 'displayQuantity' },
            { title: '棚户', dataIndex: 'growerName' },
            {
              title: '明细用途',
              dataIndex: 'lineKind',
              render: (value: string) =>
                ({
                  PACKAGING: '派发包装',
                  CONSUMPTION: '包装消耗',
                  OUTPUT: '装菜产出',
                  RECOVERY_PACKAGING: '空包装回收',
                  RECEIVED: '实收蔬菜',
                  OUTBOUND: '蔬菜出库',
                  STOCK: '库存变更',
                })[value as 'PACKAGING'] ?? value,
            },
          ]}
        />
        <Space wrap className="section-card">
          {detail?.document.status === 'DRAFT' && (
            <>
              <Button type="primary" onClick={() => openAction('edit')}>
                编辑草稿 / 提交
              </Button>
              <Button
                danger
                onClick={() =>
                  Modal.confirm({
                    title: '删除此草稿？',
                    content: '尚未入账的草稿将被作废。',
                    onOk: deleteDraft,
                  })
                }
              >
                删除草稿
              </Button>
            </>
          )}
          {detail?.document.status === 'POSTED' && (
            <>
              <Button onClick={() => openAction('correct')}>冲销并重建修正</Button>
              <Button danger onClick={() => openAction('reverse')}>
                冲销原单
              </Button>
            </>
          )}
        </Space>
      </Drawer>
      <Modal
        title={
          action === 'new'
            ? `新建${documentLabels[resource]}`
            : action === 'edit'
              ? '编辑业务草稿'
              : '冲销并重建修正'
        }
        open={action !== null && action !== 'reverse'}
        onCancel={() => {
          if (!submission.pending) {
            setAction(null);
          }
        }}
        footer={null}
        width={960}
        destroyOnHidden
      >
        <ErrorNotice message={submission.errorMessage || error} />
        <DependencyNotice error={submission.error} />
        {submission.pending && (
          <Alert
            type="warning"
            title={submission.message || '原提交等待确认'}
            action={
              <Button loading={submission.loading} onClick={submission.retry}>
                确认原提交结果
              </Button>
            }
          />
        )}
        {action === 'correct' && (
          <>
            <Alert
              title="将先冲销原单，再按新内容原子重建。原单、创建者、修正原因及逆转流水全部保留；存在依赖时整体拒绝。"
              type="warning"
            />
            <label>
              修正原因
              <Input.TextArea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
              />
            </label>
          </>
        )}
        {action !== null && (
          <DocumentEditor
            resource={resource}
            initial={action === 'new' ? undefined : detail?.document.input}
            correction={action === 'correct'}
            disabled={submission.pending || submission.loading}
            onSubmit={(document) => {
              if (action === 'correct' && !reason.trim()) {
                setError('请填写修正原因');
                return;
              }
              setDraftIntent(false);
              setConfirmation(document);
            }}
            onSaveDraft={
              action === 'correct'
                ? undefined
                : (document) => {
                    setDraftIntent(true);
                    setConfirmation(document);
                  }
            }
          />
        )}
      </Modal>
      <Modal
        width={800}
        title="确认本次操作"
        open={confirmation !== null}
        onCancel={() => {
          if (!submission.pending) {
            setConfirmation(null);
          }
        }}
        onOk={finish}
        confirmLoading={submission.loading}
        okButtonProps={{ disabled: submission.pending }}
        okText={draftIntent ? '保存草稿' : '确认记账'}
      >
        <>
          {confirmation && (
            <DocumentSummary
              document={confirmation}
              resource={resource}
              correction={action === 'correct'}
            />
          )}
        </>
        <p>
          {draftIntent
            ? '只保存草稿，不改变库存。'
            : '提交后库存与流水立即生效，修改需走管理员冲销流程。'}
        </p>
        <ErrorNotice message={error || submission.errorMessage} />
        <DependencyNotice error={submission.error} />
      </Modal>
      <Modal
        title="确认冲销"
        open={action === 'reverse'}
        onCancel={() => {
          if (!submission.pending) {
            setAction(null);
          }
        }}
        onOk={reverse}
        confirmLoading={submission.loading}
        okButtonProps={{ disabled: submission.pending }}
        okText="确认冲销"
      >
        <p>原单将保留，库存变化由逆转流水抵消。若有依赖，先处理被列出的单号。</p>
        <Input.TextArea
          aria-label="冲销原因"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="填写核实原因"
          maxLength={500}
        />
        <ErrorNotice message={error || submission.errorMessage} />
        <DependencyNotice error={submission.error} />
        {submission.pending && <Button onClick={submission.retry}>确认原提交结果</Button>}
      </Modal>
    </>
  );
}
