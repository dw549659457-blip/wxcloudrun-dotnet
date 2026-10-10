import { useState } from 'react';
import { Button, Checkbox, Form, Input, Modal, Space, Switch, Table, Tag } from 'antd';
import {
  friendlyError,
  roleLabels,
  type Role,
  type UserInput,
  type UserRecord,
} from '@warehouse/contracts';
import { api } from '../api/client';
import { ErrorNotice, PageControls, PageHeading } from '../components/Common';
import { usePagedQuery } from '../hooks/usePagedQuery';
export function UsersPage() {
  const data = usePagedQuery<UserRecord>('/api/users');
  const [editing, setEditing] = useState<UserRecord | 'new' | null>(null);
  const [form] = Form.useForm<UserInput>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [unbinding, setUnbinding] = useState<UserRecord | null>(null);
  const [reason, setReason] = useState('');
  function open(item: UserRecord | 'new') {
    setError('');
    setEditing(item);
    form.resetFields();
    form.setFieldsValue(
      item === 'new'
        ? { username: '', name: '', phone: '', roles: ['WORKER'], enabled: true }
        : {
            username: item.username,
            name: item.name,
            phone: item.phone ?? '',
            roles: item.roles.split(',') as Role[],
            enabled: item.enabled,
          },
    );
  }
  async function save(input: UserInput) {
    setSaving(true);
    setError('');
    try {
      if (!input.password) {
        delete input.password;
      }
      await api.request(
        editing === 'new' ? 'POST' : 'PUT',
        editing === 'new' ? '/api/users' : `/api/users/${editing?.id}`,
        input,
      );
      setEditing(null);
      await data.reload();
    } catch (failure) {
      setError(friendlyError(failure));
    } finally {
      setSaving(false);
    }
  }
  async function unbind() {
    if (!unbinding || !reason.trim()) {
      setError('请填写本人核实原因');
      return;
    }
    setSaving(true);
    try {
      await api.request('POST', `/api/auth/users/${unbinding.id}/unbind`, { reason });
      setUnbinding(null);
      await data.reload();
    } catch (failure) {
      setError(friendlyError(failure));
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <PageHeading
        title="员工与角色"
        description="先登记员工本人姓名、手机号和岗位。员工首次使用小程序只需确认身份，不用设置密码。修改账号会撤销旧会话。"
        extra={
          <Button type="primary" onClick={() => open('new')}>
            新增员工
          </Button>
        }
      />
      <ErrorNotice message={data.error} />
      <Table
        rowKey="id"
        dataSource={data.rows}
        loading={data.loading}
        pagination={false}
        scroll={{ x: 1000 }}
        columns={[
          { title: '姓名', dataIndex: 'name' },
          { title: '账号', dataIndex: 'username' },
          { title: '手机号', dataIndex: 'phone' },
          {
            title: '岗位',
            render: (_, item) =>
              item.roles.split(',').map((role) => <Tag key={role}>{roleLabels[role as Role]}</Tag>),
          },
          { title: '状态', render: (_, item) => (item.enabled ? '启用' : '停用') },
          { title: '微信', render: (_, item) => (item.bound ? '已绑定' : '未绑定') },
          {
            title: '操作',
            render: (_, item) => (
              <Space>
                <Button onClick={() => open(item)}>编辑</Button>
                <Button
                  disabled={!item.bound}
                  onClick={() => {
                    setUnbinding(item);
                    setReason('');
                    setError('');
                  }}
                >
                  解除绑定
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
        title={editing === 'new' ? '新增员工' : '编辑员工'}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        footer={null}
        destroyOnHidden
      >
        <ErrorNotice message={error} />
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item
            name="name"
            label="本人姓名 / 称呼"
            rules={[{ required: true, message: '请输入姓名' }]}
          >
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item
            name="username"
            label="唯一账号"
            rules={[{ required: true, message: '请输入账号' }]}
          >
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item
            name="phone"
            label="本人手机号"
            rules={[
              { required: true, message: '请输入手机号' },
              { pattern: /^1[3-9]\d{9}$/, message: '请输入11位大陆手机号' },
            ]}
          >
            <Input inputMode="tel" maxLength={11} />
          </Form.Item>
          <Form.Item
            name="roles"
            label="岗位（可多选）"
            rules={[{ required: true, message: '至少选择一个岗位' }]}
          >
            <Checkbox.Group
              options={Object.entries(roleLabels).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item
            name="password"
            label="管理员密码（普通员工不用填，编辑留空则保持原密码）"
            rules={[{ min: 12, max: 128, message: '密码需12—128字符' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="enabled" label="账号启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>
            保存员工
          </Button>
        </Form>
      </Modal>
      <Modal
        title={`解除 ${unbinding?.name ?? ''} 的微信绑定`}
        open={unbinding !== null}
        onCancel={() => setUnbinding(null)}
        onOk={unbind}
        confirmLoading={saving}
        okText="确认解除"
      >
        <p>请在线下核实本人身份。旧微信会话将失效，员工需要在本人微信重新确认。</p>
        <Input.TextArea
          aria-label="解除绑定原因"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
        />
        <ErrorNotice message={error} />
      </Modal>
    </>
  );
}
