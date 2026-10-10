import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, Select, Space } from 'antd';
import {
  businessDateNow,
  friendlyError,
  sourceLabels,
  validateDocument,
  type Archive,
  type Batch,
  type DocumentInput,
  type DocumentResource,
} from '@warehouse/contracts';
import { allPages } from '../api/client';
import { ErrorNotice } from './Common';

export function DocumentEditor({
  resource,
  initial,
  correction = false,
  disabled = false,
  onSubmit,
  onSaveDraft,
  submitLabel = '检查并提交',
}: {
  resource: DocumentResource;
  initial?: DocumentInput;
  correction?: boolean;
  disabled?: boolean;
  onSubmit(document: DocumentInput): void;
  onSaveDraft?: (document: DocumentInput) => void;
  submitLabel?: string;
}) {
  const [form] = Form.useForm<DocumentInput>();
  const [archives, setArchives] = useState<Archive[]>([]);
  const [growers, setGrowers] = useState<Archive[]>([]);
  const [customers, setCustomers] = useState<Archive[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const mode = Form.useWatch('mode', form);
  const source = Form.useWatch('source', form);
  useEffect(() => {
    let active = true;
    async function loadOptions() {
      setLoading(true);
      try {
        const [packaging, vegetables, growerRows, customerRows, batchRows] = await Promise.all([
          allPages<Archive>('/api/packaging-types'),
          allPages<Archive>('/api/vegetable-types'),
          allPages<Archive>('/api/growers'),
          allPages<Archive>('/api/customers'),
          allPages<Batch>('/api/batches'),
        ]);
        if (active) {
          setArchives([...packaging, ...vegetables]);
          setGrowers(growerRows);
          setCustomers(customerRows);
          setBatches(batchRows);
        }
      } catch (failure) {
        if (active) {
          setError(friendlyError(failure));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    void loadOptions();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    form.resetFields();
    form.setFieldsValue(
      initial ?? {
        businessDate: businessDateNow(),
        items: [{}],
        vegetables: [],
        mode: resource === 'recoveries' ? undefined : 'NORMAL',
        source: 'OPENING',
        remark: '',
        confirmFinal: false,
      },
    );
  }, [form, resource, initial]);
  function submit(document: DocumentInput) {
    const issues = validateDocument(document, resource, archives);
    if (issues.length > 0) {
      setError(issues.join('；'));
      return;
    }
    setError('');
    onSubmit(document);
  }
  const itemOptions = archives
    .filter(
      (item) =>
        item.enabled &&
        (resource === 'stock-documents' ||
          (resource === 'outbounds' ? item.kind === 'VEGETABLE' : item.kind === 'PACKAGING')),
    )
    .map((item) => ({
      value: item.id,
      label: `${item.name} · ${item.specification || item.unit} (${item.unit})`,
    }));
  const vegetableOptions = archives
    .filter((item) => item.enabled && item.kind === 'VEGETABLE')
    .map((item) => ({ value: item.id, label: `${item.name} (${item.unit})` }));
  return (
    <>
      <ErrorNotice message={error} />
      <Form
        form={form}
        layout="vertical"
        disabled={disabled || loading}
        onFinish={submit}
        requiredMark={false}
      >
        <div className="form-grid">
          <Form.Item
            label="业务日期"
            name="businessDate"
            rules={[{ required: true, message: '请选择业务日期' }]}
          >
            <Input type="date" />
          </Form.Item>
          {resource === 'stock-documents' && (
            <Form.Item label="库存来源" name="source">
              <Select
                options={Object.entries(sourceLabels).map(([value, label]) => ({ value, label }))}
              />
            </Form.Item>
          )}
          {resource === 'outbounds' && (
            <>
              <Form.Item
                label="客户"
                name="customerId"
                rules={[{ required: true, message: '请选择客户' }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={customers
                    .filter((item) => item.enabled)
                    .map((item) => ({ value: item.id, label: item.name }))}
                />
              </Form.Item>
              <Form.Item label="出库模式" name="mode">
                <Select
                  options={[
                    { value: 'NORMAL', label: '正常出库' },
                    { value: 'DIRECT', label: '手工直接出库' },
                  ]}
                />
              </Form.Item>
            </>
          )}
          {(resource === 'work-records' || resource === 'recoveries') && (
            <Form.Item
              label="棚户作业批次"
              name="batchId"
              rules={[{ required: true, message: '请选择已有批次' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={batches.map((batch) => ({
                  value: batch.id,
                  label: `${batch.growerName} · ${batch.businessDate.slice(0, 10)} · ${batch.number} · ${batch.status === 'OPEN' ? '开放' : '已关闭'}`,
                  disabled: !correction && batch.status !== 'OPEN',
                }))}
              />
            </Form.Item>
          )}
          {resource === 'recoveries' && (
            <Form.Item
              label="回收方式"
              name="mode"
              rules={[{ required: true, message: '请选择回收方式' }]}
            >
              <Select
                options={[
                  { value: 'PARTIAL', label: '部分回收：这户还没收完' },
                  { value: 'FINAL', label: '最终回收：这户已经收完' },
                ]}
              />
            </Form.Item>
          )}
        </div>
        {mode === 'DIRECT' && (
          <Alert
            title="输入实际正数。此模式扣减库存，单据及导出展示数量为负数。"
            type="info"
            showIcon
          />
        )}
        <h3>
          {resource === 'work-records'
            ? '本次消耗的包装'
            : resource === 'recoveries'
              ? '本次收回的包装'
              : '本次数量明细'}
        </h3>
        <Form.List name="items">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <div className="line-grid" key={field.key}>
                  {resource === 'dispatches' && (
                    <Form.Item
                      label="棚户"
                      name={[field.name, 'growerId']}
                      rules={[{ required: true, message: '请选择棚户' }]}
                    >
                      <Select
                        showSearch
                        optionFilterProp="label"
                        options={growers
                          .filter((item) => item.enabled)
                          .map((item) => ({ value: item.id, label: item.name }))}
                      />
                    </Form.Item>
                  )}
                  <Form.Item
                    label="品类 / 单位"
                    name={[field.name, 'itemId']}
                    rules={[{ required: true, message: '请选择品类' }]}
                  >
                    <Select showSearch optionFilterProp="label" options={itemOptions} />
                  </Form.Item>
                  <Form.Item
                    label="本次数量（正数）"
                    name={[field.name, 'quantity']}
                    rules={[{ required: true, message: '请输入本次数量' }]}
                  >
                    <Input inputMode="decimal" placeholder="例如 20 或 12.500" />
                  </Form.Item>
                  {resource === 'stock-documents' && source === 'ADJUSTMENT' && (
                    <Form.Item label="调整方向" name={[field.name, 'direction']} initialValue="IN">
                      <Select
                        options={[
                          { value: 'IN', label: '增加库存' },
                          { value: 'OUT', label: '减少库存' },
                        ]}
                      />
                    </Form.Item>
                  )}
                  <Button onClick={() => remove(field.name)} danger>
                    删除此行
                  </Button>
                </div>
              ))}
              <Button onClick={() => add({ direction: 'IN' })}>再加一行</Button>
            </>
          )}
        </Form.List>
        {(resource === 'work-records' || resource === 'recoveries') && (
          <>
            <h3>
              {resource === 'work-records'
                ? '本次现场蔬菜产出（尚未入仓）'
                : '本次实际运回蔬菜（增加仓库库存）'}
            </h3>
            <Form.List name="vegetables">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((field) => (
                    <div className="line-grid" key={field.key}>
                      <Form.Item
                        label="蔬菜 / 单位"
                        name={[field.name, 'itemId']}
                        rules={[{ required: true, message: '请选择蔬菜' }]}
                      >
                        <Select options={vegetableOptions} />
                      </Form.Item>
                      <Form.Item
                        label="本次数量"
                        name={[field.name, 'quantity']}
                        rules={[{ required: true, message: '请输入数量' }]}
                      >
                        <Input inputMode="decimal" />
                      </Form.Item>
                      <Button onClick={() => remove(field.name)} danger>
                        删除此行
                      </Button>
                    </div>
                  ))}
                  <Button onClick={() => add({})}>再加一种蔬菜</Button>
                </>
              )}
            </Form.List>
          </>
        )}
        {resource === 'recoveries' && (
          <div className="form-grid">
            <Form.Item label="包装损耗原因（有损耗时必填）" name="lossReason">
              <Input maxLength={500} />
            </Form.Item>
            <Form.Item label="产出与实收差异原因（有差异时必填）" name="differenceReason">
              <Input maxLength={500} />
            </Form.Item>
          </div>
        )}
        {resource === 'recoveries' && mode === 'FINAL' && (
          <Form.Item name="confirmFinal" valuePropName="checked">
            <Checkbox>确认结束该棚户批次，未收回包装记为损耗；后续不能继续装菜</Checkbox>
          </Form.Item>
        )}
        <Form.Item
          label={
            mode === 'DIRECT'
              ? '蔬菜来源说明（必填）'
              : source === 'ADJUSTMENT'
                ? '调整原因（必填）'
                : '备注'
          }
          name="remark"
        >
          <Input.TextArea maxLength={500} showCount rows={3} />
        </Form.Item>
        <Space wrap>
          <Button type="primary" htmlType="submit">
            {submitLabel}
          </Button>
          {onSaveDraft && (
            <Button
              onClick={async () => {
                try {
                  const document = await form.validateFields();
                  const issues = validateDocument(document, resource, archives, false);
                  if (issues.length) {
                    setError(issues.join('；'));
                    return;
                  }
                  onSaveDraft(document);
                } catch {
                  setError('请检查草稿必填字段');
                }
              }}
            >
              保存服务端草稿
            </Button>
          )}
        </Space>
      </Form>
    </>
  );
}
