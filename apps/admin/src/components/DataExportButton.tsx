import { useState } from 'react';
import { Button, message } from 'antd';
import { friendlyError, queryString, type PageQuery } from '@warehouse/contracts';
import { downloadReport } from '../api/client';
import { useAuth } from '../hooks/useAuth';
export function DataExportButton({
  resource,
  module,
  filters = {},
  label = '导出全部 Excel',
}: {
  resource: string;
  module: string;
  filters?: PageQuery;
  label?: string;
}) {
  const { can } = useAuth();
  const [pending, setPending] = useState(false);
  const [messages, context] = message.useMessage();
  if (!can(`${module}.export`)) {
    return null;
  }
  async function download() {
    setPending(true);
    try {
      await downloadReport(`/api/exports/${resource}?${queryString(filters)}`, `${resource}.xlsx`);
    } catch (error) {
      void messages.error(friendlyError(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      {context}
      <Button loading={pending} onClick={download}>
        {label}
      </Button>
    </>
  );
}
