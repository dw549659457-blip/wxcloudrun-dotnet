import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Space, Table } from 'antd';
import { friendlyError, type PermissionPolicy } from '@warehouse/contracts';
import { api } from '../api/client';
import { ErrorNotice, PageHeading } from '../components/Common';
export function PermissionsPage() {
  const [policy, setPolicy] = useState<PermissionPolicy | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState('');
  const [confirming, setConfirming] = useState(false);
  async function reload() {
    setPending(true);
    setError('');
    try {
      const result = await api.request<PermissionPolicy>('GET', '/api/backoffice-permissions');
      setPolicy(result);
      setSelected(result.permissions);
      setReason('');
    } catch (failure) {
      setError(friendlyError(failure));
    } finally {
      setPending(false);
    }
  }
  useEffect(() => {
    void reload();
  }, []);
  function toggle(key: string, granted: boolean) {
    setSelected((current) => {
      const module = key.split('.')[0];
      if (granted) {
        return [...new Set([...current, key, `${module}.read`])];
      }
      return current.filter(
        (value) => value !== key && !(key.endsWith('.read') && value.startsWith(`${module}.`)),
      );
    });
  }
  async function save() {
    if (!policy || !reason.trim()) {
      setError('请填写权限调整原因');
      return;
    }
    setPending(true);
    setError('');
    try {
      await api.request('PUT', '/api/backoffice-permissions', {
        version: policy.version,
        permissions: selected,
        reason,
      });
      setConfirming(false);
      setSuccess('后台管理员权限已更新，现有会话从下一次请求起使用新权限。');
      await reload();
    } catch (failure) {
      setError(friendlyError(failure));
    } finally {
      setPending(false);
    }
  }
  const groups = [...new Set(policy?.catalog.map((entry) => entry.module) ?? [])].map((module) => ({
    module,
    entries: policy?.catalog.filter((entry) => entry.module === module) ?? [],
  }));
  return (
    <>
      <PageHeading
        title="后台管理员权限配置"
        description="管理员拥有最高权限。以下配置适用于全部后台管理员账号，后台接口实时校验并记录每次权限调整。"
      />
      <Alert
        type="info"
        showIcon
        title="默认允许查询和导出；下级员工管理与开通审批为后台管理员固定职责；后台账号、权限配置和审计查询由管理员维护。"
        className="section-card"
      />
      {success && <Alert type="success" showIcon title={success} className="section-card" />}
      <ErrorNotice message={error} />
      <Table
        rowKey="module"
        dataSource={groups}
        loading={pending}
        pagination={false}
        columns={[
          { title: '模块', dataIndex: 'module' },
          {
            title: '后台管理员可用操作',
            render: (_, row) => (
              <Space wrap>
                {row.entries.map((entry) => (
                  <Checkbox
                    key={entry.key}
                    checked={selected.includes(entry.key)}
                    disabled={pending || entry.fixed}
                    onChange={(event) => toggle(entry.key, event.target.checked)}
                  >
                    {entry.label}
                  </Checkbox>
                ))}
              </Space>
            ),
          },
        ]}
      />
      <div className="section-card">
        <label>
          调整原因
          <Input.TextArea
            aria-label="权限调整原因"
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      </div>
      <Space wrap>
        <Button
          type="primary"
          disabled={!policy || pending || !reason.trim()}
          onClick={() => setConfirming(true)}
        >
          保存后台管理员权限
        </Button>
        <Button
          disabled={!policy || pending}
          onClick={() =>
            setSelected(
              policy?.catalog.filter((entry) => entry.defaultGranted).map((entry) => entry.key) ??
                [],
            )
          }
        >
          恢复默认查询与导出
        </Button>
        <Button loading={pending} onClick={reload}>
          重新读取配置
        </Button>
      </Space>
      <Modal
        title="确认调整全部后台管理员权限"
        open={confirming}
        onCancel={() => setConfirming(false)}
        onOk={save}
        confirmLoading={pending}
        okText="确认保存"
      >
        <p>选中的权限将应用于所有后台管理员账号。后台管理员无法授予自己管理员身份或修改本配置。</p>
        <p>调整原因：{reason}</p>
        <ErrorNotice message={error} />
      </Modal>
    </>
  );
}
