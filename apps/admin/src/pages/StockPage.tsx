import { useState } from 'react';
import { Alert, Button, Card, Modal } from 'antd';
import type { DocumentInput } from '@warehouse/contracts';
import { DocumentSummary } from '../components/DocumentSummary';
import { DocumentEditor } from '../components/DocumentEditor';
import { ErrorNotice, PageHeading } from '../components/Common';
import { useAuth } from '../hooks/useAuth';
import { useSubmission } from '../hooks/useSubmission';
export function StockPage() {
  const { can } = useAuth();
  const [confirmation, setConfirmation] = useState<DocumentInput | null>(null);
  const [success, setSuccess] = useState('');
  const [formKey, setFormKey] = useState(0);
  const submission = useSubmission('stock-entry', (result) => {
    setSuccess(
      `${result.status === 'DRAFT' ? '草稿已保存，尚未入账' : '库存已入账'}：${result.number}`,
    );
    setConfirmation(null);
    setFormKey((value) => value + 1);
  });
  async function post() {
    if (confirmation) {
      await submission.submit('STOCK:create', '/api/stock-documents', {
        post: true,
        document: confirmation,
      });
    }
  }
  return (
    <>
      <PageHeading
        title="库存入库与调整"
        description="期初、包装补充、外来菜与库存调整全部生成单据和库存流水，不直接覆盖余额。"
      />
      <ErrorNotice message={submission.errorMessage} />
      {success && <Alert type="success" showIcon title={success} className="section-card" />}
      {submission.pending && (
        <Alert
          type="warning"
          title={submission.message || '有一笔待确认提交，先处理原提交'}
          action={
            <Button loading={submission.loading} onClick={submission.retry}>
              确认原提交结果
            </Button>
          }
        />
      )}
      <Card>
        <DocumentEditor
          key={formKey}
          resource="stock-documents"
          submitDisabled={!can('documents.post')}
          disabled={submission.pending || submission.loading}
          onSubmit={setConfirmation}
          onSaveDraft={(document) => {
            void submission.submit('STOCK:create', '/api/stock-documents', {
              post: false,
              document,
            });
          }}
        />
      </Card>
      <Modal
        width={800}
        title="确认库存变更"
        open={confirmation !== null}
        onCancel={() => {
          if (!submission.pending) {
            setConfirmation(null);
          }
        }}
        onOk={post}
        confirmLoading={submission.loading}
        okButtonProps={{ disabled: submission.pending }}
        okText="确认记账"
      >
        <>
          {confirmation && <DocumentSummary document={confirmation} resource="stock-documents" />}
        </>
        <ErrorNotice message={submission.errorMessage} />
      </Modal>
    </>
  );
}
