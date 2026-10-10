import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, Space, Table } from 'antd';
import { friendlyError, type BindingRequest, type UserRecord } from '@warehouse/contracts';
import { allPages, api } from '../api/client';
import { ErrorNotice, PageControls, PageHeading, StatusTag, timeText } from '../components/Common';
import { usePagedQuery } from '../hooks/usePagedQuery';
export function BindingsPage() {
  const data = usePagedQuery<BindingRequest>('/api/auth/binding-requests');
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [selection, setSelection] = useState<{ request: BindingRequest; approve: boolean } | null>(
    null,
  );
  const [userId, setUserId] = useState<number | undefined>();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    async function load() {
      try {
        setUsers(await allPages<UserRecord>('/api/users'));
      } catch (failure) {
        setError(friendlyError(failure));
      }
    }
    void load();
  }, []);
  async function decide() {
    if (!selection || !reason.trim() || (selection.approve && !userId)) {
      setError('请指定已核实的员工并填写核实原因');
      return;
    }
    setLoading(true);
    try {
      await api.request(
        'POST',
        `/api/auth/binding-requests/${selection.request.id}/${selection.approve ? 'approve' : 'reject'}`,
        { userId: userId ?? 0, reason },
      );
      setSelection(null);
      await data.reload();
      setUsers(await allPages<UserRecord>('/api/users'));
    } catch (failure) {
      setError(friendlyError(failure));
    } finally {
      setLoading(false);
    }
  }
  function open(request: BindingRequest, approve: boolean) {
    setSelection({ request, approve });
    setUserId(undefined);
    setReason('');
    setError('');
  }
  return (
    <>
      <PageHeading
        title="员工开通协助"
        description="员工本人微信发起申请后，管理员在线下核实本人。批准后仍需员工点“是我，进入”，申请本身没有业务权限。"
        extra={<Button onClick={data.reload}>刷新申请</Button>}
      />
      <ErrorNotice message={data.error || error} />
      <Table
        rowKey="id"
        dataSource={data.rows}
        pagination={false}
        loading={data.loading}
        columns={[
          { title: '申请编号', dataIndex: 'id' },
          { title: '申请时间', render: (_, item) => timeText(item.createdAt) },
          { title: '状态', render: (_, item) => <StatusTag status={item.status} /> },
          { title: '核实原因', dataIndex: 'reason' },
          {
            title: '操作',
            render: (_, item) => (
              <Space>
                <Button
                  disabled={item.status !== 'PENDING_APPROVAL'}
                  onClick={() => open(item, true)}
                >
                  核实并批准
                </Button>
                <Button
                  disabled={item.status !== 'PENDING_APPROVAL'}
                  onClick={() => open(item, false)}
                >
                  拒绝
                </Button>
              </Space>
            ),
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
        title={selection?.approve ? '批准本人开通申请' : '拒绝开通申请'}
        open={selection !== null}
        onCancel={() => setSelection(null)}
        onOk={decide}
        confirmLoading={loading}
        okText="提交决定"
      >
        {selection?.approve && (
          <label>
            已核实的预录员工
            <Select
              showSearch
              optionFilterProp="label"
              style={{ width: '100%' }}
              value={userId}
              onChange={setUserId}
              options={users
                .filter((user) => user.enabled && !user.bound)
                .map((user) => ({ value: user.id, label: `${user.name} · ${user.phone}` }))}
            />
          </label>
        )}
        <label>
          核实 / 拒绝原因
          <Input.TextArea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
          />
        </label>
        <ErrorNotice message={error} />
      </Modal>
    </>
  );
}
