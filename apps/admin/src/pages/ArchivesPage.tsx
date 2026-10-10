import { useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, Switch, Table, Tag } from 'antd';
import {
  archiveLabels,
  friendlyError,
  type Archive,
  type ArchiveInput,
  type ArchiveResource,
} from '@warehouse/contracts';
import { api } from '../api/client';
import { ErrorNotice, PageControls, PageHeading } from '../components/Common';
import { usePagedQuery } from '../hooks/usePagedQuery';
export function ArchivesPage({ resource }: { resource: ArchiveResource }) {
  const [search, setSearch] = useState('');
  const data = usePagedQuery<Archive>(`/api/${resource}`, { search: search || undefined });
  const [editing, setEditing] = useState<Archive | 'new' | null>(null);
  const [form] = Form.useForm<ArchiveInput>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  function open(item: Archive | 'new') {
    setError('');
    setEditing(item);
    form.resetFields();
    form.setFieldsValue(
      item === 'new'
        ? {
            name: '',
            unit:
              resource === 'vegetable-types' ? '箱' : resource === 'packaging-types' ? '个' : '',
            specification: '',
            contact: '',
            phone: '',
            enabled: true,
          }
        : { ...item, contact: item.contact ?? '', phone: item.phone ?? '' },
    );
  }
  async function save(input: ArchiveInput) {
    setSaving(true);
    setError('');
    try {
      await api.request(
        editing === 'new' ? 'POST' : 'PUT',
        editing === 'new' ? `/api/${resource}` : `/api/${resource}/${editing?.id}`,
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
  const rows = data.rows;
  return (
    <>
      <PageHeading
        title={`${archiveLabels[resource]}档案`}
        description="维护名称、规格和启用状态。历史单据保留快照，已使用品类不能更改单位。"
        extra={
          <Button type="primary" onClick={() => open('new')}>
            新增{archiveLabels[resource]}
          </Button>
        }
      />
      <ErrorNotice message={data.error} />
      <Input.Search
        aria-label="搜索档案名称"
        placeholder="查询所有页的名称"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="search-input"
      />
      <Table
        rowKey="id"
        dataSource={rows}
        loading={data.loading}
        pagination={false}
        scroll={{ x: 750 }}
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: '规格', dataIndex: 'specification' },
          { title: '单位', dataIndex: 'unit' },
          { title: '联系人', dataIndex: 'contact' },
          { title: '手机号', dataIndex: 'phone' },
          {
            title: '状态',
            render: (_, item) => (
              <Tag color={item.enabled ? 'green' : 'default'}>{item.enabled ? '启用' : '停用'}</Tag>
            ),
          },
          { title: '操作', render: (_, item) => <Button onClick={() => open(item)}>编辑</Button> },
        ]}
      />
      <PageControls
        page={data.page}
        count={data.rows.length}
        loading={data.loading}
        onPage={data.setPage}
      />
      <Modal
        title={`${editing === 'new' ? '新增' : '编辑'}${archiveLabels[resource]}`}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        footer={null}
        destroyOnHidden
      >
        <ErrorNotice message={error} />
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }, { max: 100 }]}
          >
            <Input />
          </Form.Item>
          {(resource === 'packaging-types' || resource === 'vegetable-types') && (
            <Space align="start">
              <Form.Item
                name="unit"
                label="库存单位"
                rules={[{ required: true, message: '请选择或输入单位' }]}
              >
                {resource === 'vegetable-types' ? (
                  <Select style={{ width: 140 }} options={[{ value: '箱' }, { value: '公斤' }]} />
                ) : (
                  <Input />
                )}
              </Form.Item>
              <Form.Item name="specification" label="规格">
                <Input maxLength={200} />
              </Form.Item>
            </Space>
          )}
          <Form.Item name="contact" label="联系人">
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item name="phone" label="手机号">
            <Input maxLength={32} />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>
            保存档案
          </Button>
        </Form>
      </Modal>
    </>
  );
}
