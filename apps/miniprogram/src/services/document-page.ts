import {
  ApiError,
  addQuantities,
  businessDateNow,
  compareQuantities,
  friendlyError,
  roleLabels,
  subtractQuantities,
  validateDocument,
  type Archive,
  type Batch,
  type BatchSummary,
  type DocumentDetail,
  type DocumentInput,
  type DocumentResource,
  type EmployeeSession,
  type InventoryRow,
  type QuantityLine,
  type Role,
} from '@warehouse/contracts';
import { api, allPages } from './api';
import { getDraft, offerDraft, removeDraft } from './drafts';
import { rememberForm, showSubmitted, submitDocument } from './forms';
import { requireSession } from './session';
import type { InputEvent, PickerEvent, TapEvent } from '../types';
interface Group {
  key: number;
  growerId: number;
  growerName: string;
  lines: QuantityLine[];
}
interface SummaryRow {
  key: string;
  label: string;
  value: string;
}
interface RowEvent {
  detail: { index: number; line: QuantityLine };
  currentTarget: { dataset: { group?: number; section?: string } };
}
export interface DocumentFormState {
  resource: DocumentResource;
  role: Role;
  ownerId: number;
  editingId: number;
  version: number;
  document: DocumentInput;
  archives: Archive[];
  growers: Archive[];
  customers: Archive[];
  packaging: Archive[];
  vegetables: Archive[];
  groups: Group[];
  batch: BatchSummary | null;
  batchLabel: string;
  customerName: string;
  inventory: InventoryRow[];
  loading: boolean;
  saving: boolean;
  locked: boolean;
  pending: boolean;
  confirming: boolean;
  error: string;
  notice: string;
  summary: SummaryRow[];
  lossRows: SummaryRow[];
  differenceRows: SummaryRow[];
  stepTitle: string;
  lossChoice: string;
  showRemark: boolean;
}
interface FormHost {
  data: DocumentFormState;
  setData(value: Partial<DocumentFormState>): void;
}
const emptyLine = (options: Archive[]): QuantityLine => ({
  itemId: options.length === 1 ? options[0].id : 0,
  quantity: '',
});
const cleanLines = (lines: QuantityLine[]): QuantityLine[] =>
  lines.filter((line) => line.quantity.trim() !== '');
export function lineTotal(lines: QuantityLine[], itemId: number): string {
  return lines
    .filter((line) => line.itemId === itemId)
    .reduce((sum, line) => addQuantities(sum, line.quantity || '0'), '0');
}
function rawInput(host: FormHost): DocumentInput {
  const value = host.data.document;
  return {
    ...value,
    items:
      host.data.resource === 'dispatches'
        ? host.data.groups.flatMap((group) =>
            group.lines.map((line) => ({ ...line, growerId: group.growerId })),
          )
        : value.items,
  };
}
function inputFor(host: FormHost): DocumentInput {
  const value = rawInput(host);
  return {
    ...value,
    items: cleanLines(value.items),
    vegetables: cleanLines(value.vegetables ?? []),
  };
}
function save(host: FormHost): void {
  if (host.data.ownerId && !host.data.locked && !host.data.confirming) {
    rememberForm(
      host.data.ownerId,
      host.data.resource,
      rawInput(host),
      host.data.editingId || undefined,
      host.data.version || undefined,
    );
  }
}
function reconstructGroups(document: DocumentInput, growers: Archive[]): Group[] {
  const groups = new Map<number, Group>();
  for (const line of document.items) {
    const growerId = line.growerId ?? 0;
    const group = groups.get(growerId) ?? {
      key: growerId,
      growerId,
      growerName: growers.find((item) => item.id === growerId)?.name ?? '请选择棚户',
      lines: [],
    };
    group.lines.push(line);
    groups.set(growerId, group);
  }
  return [...groups.values()];
}
async function refreshContext(host: FormHost): Promise<void> {
  const resource = host.data.resource;
  const paths =
    resource === 'dispatches'
      ? ['growers', 'packaging-types']
      : resource === 'outbounds'
        ? ['customers', 'vegetable-types']
        : ['packaging-types', 'vegetable-types'];
  const groups = await Promise.all(paths.map((path) => allPages<Archive>(`/api/${path}`)));
  const archives = groups.flat().filter((item) => item.enabled);
  const packaging = archives.filter((item) => item.kind === 'PACKAGING');
  host.setData({
    archives,
    growers: archives.filter((item) => item.kind === 'GROWER'),
    customers: archives.filter((item) => item.kind === 'CUSTOMER'),
    packaging,
    vegetables: archives.filter((item) => item.kind === 'VEGETABLE'),
  });
  if (host.data.document.batchId) {
    const batch = await api.request<BatchSummary>(
      'GET',
      `/api/batches/${host.data.document.batchId}/summary`,
    );
    const options = packaging.filter((item) =>
      batch.packaging.some((balance) => balance.itemId === item.id),
    );
    host.setData({
      batch,
      batchLabel: `${batch.batch.growerName} · ${batch.batch.businessDate.slice(0, 10)} · 司机${batch.batch.driverName}`,
      packaging: options,
    });
  }
  if ((resource === 'work-records' || resource === 'recoveries') && !host.data.document.batchId) {
    host.setData({ packaging: [] });
  }
  if (resource === 'outbounds') {
    host.setData({
      inventory: await allPages<InventoryRow>('/api/inventory/vegetables'),
      customerName:
        host.data.customers.find((item) => item.id === host.data.document.customerId)?.name ?? '',
    });
  }
}
function summary(host: FormHost, document: DocumentInput): SummaryRow[] {
  const rows: SummaryRow[] = [{ key: 'date', label: '业务日期', value: document.businessDate }];
  if (host.data.batch) {
    rows.push({ key: 'batch', label: '本次棚户', value: host.data.batchLabel });
  }
  if (document.customerId) {
    rows.push({ key: 'customer', label: '客户', value: host.data.customerName });
  }
  [...document.items, ...(document.vegetables ?? [])].forEach((line, index) => {
    const archive = host.data.archives.find((item) => item.id === line.itemId);
    const grower = host.data.growers.find((item) => item.id === line.growerId);
    rows.push({
      key: `line-${index}`,
      label: `${grower ? `${grower.name} · ` : ''}${archive?.name ?? '品类已停用'}`,
      value: `${line.quantity} ${archive?.unit ?? ''}`,
    });
  });
  if (host.data.resource === 'recoveries') {
    rows.push({
      key: 'mode',
      label: '本次回收',
      value:
        document.mode === 'FINAL' ? '这户已经收完，本次结束任务' : '这户还没收完，任务继续保留',
    });
  }
  if (host.data.resource === 'outbounds') {
    rows.push({
      key: 'mode',
      label: '出库方式',
      value: document.mode === 'DIRECT' ? '手工出库：实际扣库存，报表显示负数' : '正常出库',
    });
  }
  if (document.remark) {
    rows.push({ key: 'remark', label: '备注', value: document.remark });
  }
  if (document.lossReason) {
    rows.push({ key: 'lossReason', label: '包装损耗原因', value: document.lossReason });
  }
  if (document.differenceReason) {
    rows.push({ key: 'differenceReason', label: '蔬菜差异原因', value: document.differenceReason });
  }
  return rows;
}
export function recoveryPreview(
  batch: BatchSummary,
  document: DocumentInput,
): { lossRows: SummaryRow[]; differenceRows: SummaryRow[]; errors: string[] } {
  const lossRows: SummaryRow[] = [];
  const differenceRows: SummaryRow[] = [];
  const errors: string[] = [];
  for (const balance of batch.packaging) {
    const returned = lineTotal(document.items, balance.itemId);
    const loss = subtractQuantities(balance.outstanding, returned);
    if (compareQuantities(loss, '0') < 0) {
      errors.push(`${balance.name}的回收量超过当前在外量`);
    }
    if (document.mode === 'FINAL') {
      lossRows.push({
        key: `loss-${balance.itemId}`,
        label: `${balance.name}：派发${balance.dispatched ?? '0'} − 消耗${balance.consumed ?? '0'} − 已回收${balance.recovered ?? '0'} − 本次${returned}`,
        value: `本次损耗 ${loss} ${balance.unit}`,
      });
      if (compareQuantities(loss, '0') > 0 && !document.lossReason?.trim()) {
        errors.push('有包装损耗，请选择或填写原因');
      }
    }
  }
  const vegetableIds = new Set([
    ...batch.vegetables.map((item) => item.itemId),
    ...(document.vegetables ?? []).map((line) => line.itemId),
  ]);
  for (const itemId of vegetableIds) {
    const balance = batch.vegetables.find((item) => item.itemId === itemId);
    const now = lineTotal(document.vegetables ?? [], itemId);
    const difference = subtractQuantities(
      balance?.output ?? '0',
      addQuantities(balance?.received ?? '0', now),
    );
    if (
      (document.mode === 'FINAL' || compareQuantities(difference, '0') < 0) &&
      compareQuantities(difference, '0') !== 0
    ) {
      differenceRows.push({
        key: `difference-${itemId}`,
        label: `${balance?.name ?? '本次蔬菜'}：装菜${balance?.output ?? '0'} − 已收${balance?.received ?? '0'} − 本次${now}`,
        value: `差异 ${difference} ${balance?.unit ?? ''}`,
      });
      if (!document.differenceReason?.trim()) {
        errors.push('装菜产出与司机实收有差异，请填写原因');
      }
    }
  }
  return { lossRows, differenceRows, errors: [...new Set(errors)] };
}
export function createDocumentPage(resource: DocumentResource, role: Role) {
  const titles: Partial<Record<DocumentResource, string>> = {
    dispatches: '派发包装',
    'work-records': '装菜登记',
    recoveries: '回收登记',
    outbounds: '出库登记',
  };
  // 每个原生页面复用保存、校验、确认与提交；业务输入仍在对应页面 WXML 中明确列出。
  const data: DocumentFormState = {
    resource,
    role,
    ownerId: 0,
    editingId: 0,
    version: 0,
    document: {
      businessDate: businessDateNow(),
      items: [],
      vegetables: [],
      mode: resource === 'recoveries' ? '' : 'NORMAL',
      remark: '',
      lossReason: '',
      differenceReason: '',
    },
    archives: [],
    growers: [],
    customers: [],
    packaging: [],
    vegetables: [],
    groups: [],
    batch: null,
    batchLabel: '',
    customerName: '',
    inventory: [],
    loading: true,
    saving: false,
    locked: false,
    pending: false,
    confirming: false,
    error: '',
    notice: '',
    summary: [],
    lossRows: [],
    differenceRows: [],
    stepTitle: titles[resource] ?? '',
    lossChoice: '',
    showRemark: false,
  };
  return {
    data,
    async onLoad(this: FormHost, query: Record<string, string | undefined>) {
      try {
        const session = await requireSession();
        if (!session) {
          return;
        }
        if (!session.roles.includes(role) || session.selectedRole !== role) {
          throw new Error(`请先在“我的”中选择${roleLabels[role]}身份`);
        }
        const editingId = query.id ? Number(query.id) : 0;
        this.setData({ ownerId: session.userId, editingId });
        let document: DocumentInput = {
          ...this.data.document,
          mode:
            resource === 'outbounds' && query.mode === 'DIRECT'
              ? 'DIRECT'
              : this.data.document.mode,
          batchId: query.batchId ? Number(query.batchId) : undefined,
        };
        if (editingId) {
          const detail = await api.request<DocumentDetail>('GET', `/api/${resource}/${editingId}`);
          if (detail.document.status !== 'DRAFT') {
            throw new Error('这条记录已经记好，不能在员工页面修改');
          }
          document = detail.document.input;
          this.setData({ version: detail.document.version });
        }
        const draft = await offerDraft(
          session.userId,
          resource,
          editingId || undefined,
          document.batchId ?? undefined,
        );
        if (!draft && getDraft(session.userId, resource, editingId || undefined)?.ticket) {
          this.setData({
            locked: true,
            pending: true,
            notice: '这笔仍在确认结果，请返回后继续处理原提交。',
          });
          return;
        }
        if (draft) {
          if (editingId && draft.version !== this.data.version && !draft.ticket) {
            throw new Error('这份草稿已在别处修改，请返回记录详情重新打开');
          }
          document = draft.document;
          this.setData({
            pending: Boolean(draft.ticket),
            locked: Boolean(draft.ticket),
            notice: draft.ticket
              ? '上次尚未确认结果，请点“继续确认原提交”。'
              : '已恢复草稿，尚未记账。请核对下方内容。',
          });
        }
        this.setData({ document });
        await refreshContext(this);
        if ((resource === 'work-records' || resource === 'recoveries') && !document.batchId) {
          const available = (await allPages<Batch>('/api/batches')).filter(
            (batch) => batch.status === 'OPEN',
          );
          if (available.length === 1) {
            document = { ...document, batchId: available[0].id };
            this.setData({ document });
            await refreshContext(this);
            this.setData({
              notice: `当前只有一个未结束任务，已选中${available[0].growerName}，请核对。`,
            });
          }
        }
        if (resource === 'dispatches') {
          const groups = reconstructGroups(document, this.data.growers);
          this.setData({
            groups: groups.length
              ? groups
              : [
                  {
                    key: Date.now(),
                    growerId: 0,
                    growerName: '请选择棚户',
                    lines: [emptyLine(this.data.packaging)],
                  },
                ],
          });
        } else if (!document.items.length && resource !== 'recoveries') {
          this.setData({
            document: {
              ...document,
              items: [
                emptyLine(resource === 'outbounds' ? this.data.vegetables : this.data.packaging),
              ],
            },
          });
        }
        if (resource === 'work-records' && !document.vegetables?.length) {
          this.setData({
            document: { ...this.data.document, vegetables: [emptyLine(this.data.vegetables)] },
          });
        }
        if (resource === 'recoveries' && !document.items.length) {
          this.setData({
            document: {
              ...this.data.document,
              items: this.data.packaging.map((item) => ({ itemId: item.id, quantity: '' })),
            },
          });
        }
        if (this.data.batch?.batch.status !== 'OPEN' && this.data.batch && !this.data.pending) {
          this.setData({ locked: true, error: '这户任务已经结束。请返回选择仍在进行的任务。' });
        }
      } catch (failure) {
        this.setData({ error: friendlyError(failure), locked: true });
      } finally {
        this.setData({ loading: false });
      }
    },
    field(this: FormHost, event: InputEvent | PickerEvent) {
      if (this.data.locked) {
        return;
      }
      const field = event.currentTarget.dataset.field;
      if (typeof field !== 'string') {
        return;
      }
      this.setData({
        document: { ...this.data.document, [field]: event.detail.value },
        confirming: false,
        error: '',
      });
      save(this);
    },
    toggleRemark(this: FormHost) {
      this.setData({ showRemark: !this.data.showRemark });
    },
    chooseGrower(this: FormHost, event: PickerEvent) {
      if (this.data.locked) {
        return;
      }
      const index = Number(event.currentTarget.dataset.group);
      const grower = this.data.growers[Number(event.detail.value)];
      if (!grower) {
        return;
      }
      const groups = this.data.groups.map((group, current) =>
        current === index ? { ...group, growerId: grower.id, growerName: grower.name } : group,
      );
      this.setData({ groups, confirming: false });
      save(this);
    },
    chooseCustomer(this: FormHost, event: PickerEvent) {
      if (this.data.locked) {
        return;
      }
      const customer = this.data.customers[Number(event.detail.value)];
      if (!customer) {
        return;
      }
      this.setData({
        document: { ...this.data.document, customerId: customer.id },
        customerName: customer.name,
        confirming: false,
      });
      save(this);
    },
    chooseBatch(this: FormHost) {
      if (this.data.locked) {
        return;
      }
      const open = () => {
        removeDraft(this.data.ownerId, resource, this.data.editingId || undefined);
        wx.disableAlertBeforeUnload();
        wx.navigateTo({
          url: `/pages/batches/index?for=${resource === 'work-records' ? 'work' : 'recovery'}`,
        });
      };
      if (this.data.document.batchId || this.data.document.items.some((line) => line.quantity)) {
        wx.showModal({
          title: '更换棚户任务？',
          content: '会清空本次填写的数量，请选择新任务后重新填写。',
          success: (choice) => {
            if (choice.confirm) {
              open();
            }
          },
        });
      } else {
        open();
      }
    },
    lineChange(this: FormHost, event: RowEvent) {
      if (this.data.locked) {
        return;
      }
      const { index, line } = event.detail;
      if (resource === 'dispatches') {
        const groups = this.data.groups.map((group, current) =>
          current === Number(event.currentTarget.dataset.group)
            ? {
                ...group,
                lines: group.lines.map((value, position) => (position === index ? line : value)),
              }
            : group,
        );
        this.setData({ groups, confirming: false, error: '' });
      } else {
        const section =
          event.currentTarget.dataset.section === 'vegetables' ? 'vegetables' : 'items';
        const lines = (this.data.document[section] ?? []).map((value, current) =>
          current === index ? line : value,
        );
        this.setData({
          document: { ...this.data.document, [section]: lines },
          confirming: false,
          error: '',
        });
      }
      save(this);
    },
    addLine(this: FormHost, event: TapEvent) {
      if (this.data.locked) {
        return;
      }
      if (resource === 'dispatches') {
        const groups = this.data.groups.map((group, current) =>
          current === Number(event.currentTarget.dataset.group)
            ? { ...group, lines: [...group.lines, emptyLine(this.data.packaging)] }
            : group,
        );
        this.setData({ groups });
      } else {
        const section =
          event.currentTarget.dataset.section === 'vegetables' ? 'vegetables' : 'items';
        const options =
          section === 'vegetables' || resource === 'outbounds'
            ? this.data.vegetables
            : this.data.packaging;
        this.setData({
          document: {
            ...this.data.document,
            [section]: [...(this.data.document[section] ?? []), emptyLine(options)],
          },
        });
      }
      this.setData({ confirming: false });
      save(this);
    },
    removeLine(this: FormHost, event: RowEvent) {
      if (this.data.locked) {
        return;
      }
      if (resource === 'dispatches') {
        const groups = this.data.groups.map((group, current) =>
          current === Number(event.currentTarget.dataset.group)
            ? {
                ...group,
                lines: group.lines.filter((_, position) => position !== event.detail.index),
              }
            : group,
        );
        this.setData({ groups });
      } else {
        const section =
          event.currentTarget.dataset.section === 'vegetables' ? 'vegetables' : 'items';
        this.setData({
          document: {
            ...this.data.document,
            [section]: (this.data.document[section] ?? []).filter(
              (_, position) => position !== event.detail.index,
            ),
          },
        });
      }
      this.setData({ confirming: false });
      save(this);
    },
    addGrower(this: FormHost) {
      if (!this.data.locked) {
        this.setData({
          groups: [
            ...this.data.groups,
            {
              key: Date.now(),
              growerId: 0,
              growerName: '请选择棚户',
              lines: [emptyLine(this.data.packaging)],
            },
          ],
          confirming: false,
        });
        save(this);
      }
    },
    removeGrower(this: FormHost, event: TapEvent) {
      if (!this.data.locked) {
        this.setData({
          groups: this.data.groups.filter(
            (_, index) => index !== Number(event.currentTarget.dataset.group),
          ),
          confirming: false,
        });
        save(this);
      }
    },
    chooseMode(this: FormHost, event: TapEvent) {
      if (this.data.locked) {
        return;
      }
      this.setData({
        document: {
          ...this.data.document,
          mode: String(event.currentTarget.dataset.mode),
          confirmFinal: false,
        },
        confirming: false,
      });
      save(this);
    },
    chooseLoss(this: FormHost, event: TapEvent) {
      if (this.data.locked) {
        return;
      }
      const reason = String(event.currentTarget.dataset.reason);
      this.setData({
        lossChoice: reason,
        document: { ...this.data.document, lossReason: reason === '其他' ? '' : reason },
        confirming: false,
      });
      save(this);
    },
    async preview(this: FormHost) {
      if (this.data.saving || this.data.locked) {
        return;
      }
      this.setData({ saving: true, error: '', lossRows: [], differenceRows: [] });
      try {
        const session: EmployeeSession | null = await requireSession();
        if (!session || session.userId !== this.data.ownerId || session.selectedRole !== role) {
          throw new Error('当前身份已变化，请返回首页重新选择身份');
        }
        await refreshContext(this);
        const document = {
          ...inputFor(this),
          confirmFinal: resource === 'recoveries' && this.data.document.mode === 'FINAL',
        };
        const errors = validateDocument(document, resource, this.data.archives);
        if (resource === 'dispatches') {
          for (const group of this.data.groups) {
            if (!this.data.growers.some((item) => item.id === group.growerId)) {
              errors.push('每户都要选择有效棚户');
            }
            if (!group.lines.length) {
              errors.push(`${group.growerName}至少填写一行包装`);
            }
          }
        }
        if (this.data.batch && this.data.batch.batch.status !== 'OPEN') {
          errors.push('这户任务已经结束，请重新选择');
        }
        if (
          (resource === 'work-records' || resource === 'recoveries') &&
          this.data.batch &&
          !errors.length
        ) {
          for (const line of document.items) {
            const balance = this.data.batch.packaging.find((item) => item.itemId === line.itemId);
            if (!balance) {
              errors.push('只能使用本任务已经派发的包装');
            } else if (
              compareQuantities(lineTotal(document.items, line.itemId), balance.outstanding) > 0
            ) {
              errors.push(`${balance.name}数量超过当前在外量${balance.outstanding}${balance.unit}`);
            }
          }
        }
        if (resource === 'recoveries' && this.data.batch && !errors.length) {
          const check = recoveryPreview(this.data.batch, document);
          this.setData({ lossRows: check.lossRows, differenceRows: check.differenceRows });
          errors.push(...check.errors);
        }
        if (resource === 'outbounds' && !errors.length) {
          for (const line of document.items) {
            const balance = this.data.inventory.find((item) => item.id === line.itemId);
            if (
              compareQuantities(lineTotal(document.items, line.itemId), balance?.quantity ?? '0') >
              0
            ) {
              errors.push('本次出库超过当前库存，请核对数量');
            }
          }
        }
        if (errors.length) {
          throw new Error([...new Set(errors)].join('；'));
        }
        this.setData({
          document,
          summary: summary(this, document),
          confirming: true,
          notice: '请核对日期、姓名、品类和本次数量。下面按钮才会正式记账。',
        });
        wx.pageScrollTo({ selector: '#confirmation', duration: 250 });
      } catch (failure) {
        this.setData({ error: friendlyError(failure) });
      } finally {
        this.setData({ saving: false });
      }
    },
    backToEdit(this: FormHost) {
      if (!this.data.locked) {
        this.setData({ confirming: false, notice: '' });
      }
    },
    async submit(this: FormHost) {
      if (
        this.data.saving ||
        (this.data.locked && !this.data.pending) ||
        (!this.data.confirming && !this.data.pending)
      ) {
        return;
      }
      this.setData({ saving: true, error: '' });
      try {
        const draft = getDraft(this.data.ownerId, resource, this.data.editingId || undefined);
        const result = await submitDocument(
          this.data.ownerId,
          resource,
          inputFor(this),
          draft?.ticket,
          this.data.editingId || undefined,
          this.data.version || undefined,
        );
        if (result.result) {
          showSubmitted(resource, result.result);
        } else {
          this.setData({
            pending: true,
            locked: true,
            confirming: false,
            notice: '还没有确认是否记好。内容已保留，请点“继续确认原提交”，不要另开一笔相同记录。',
          });
        }
      } catch (failure) {
        const draft = getDraft(this.data.ownerId, resource, this.data.editingId || undefined);
        const known = failure instanceof ApiError && failure.status > 0 && failure.status < 500;
        if (known && draft) {
          rememberForm(this.data.ownerId, resource, draft.document, draft.editingId, draft.version);
        }
        this.setData({
          error: friendlyError(failure),
          pending: Boolean(draft?.ticket) && !known,
          locked: Boolean(draft?.ticket) && !known,
          confirming: false,
        });
        if (this.data.editingId && known) {
          const latest = await api.request<DocumentDetail>(
            'GET',
            `/api/${resource}/${this.data.editingId}`,
          );
          this.setData({ version: latest.document.version });
        }
      } finally {
        this.setData({ saving: false });
      }
    },
    saveLater(this: FormHost) {
      if (!this.data.pending) {
        save(this);
      }
      this.setData({
        notice: this.data.pending
          ? '原提交已保留，请联网后继续确认。'
          : '已保存到本机，尚未记账。联网后可以回来继续填写。',
      });
    },
    retryLoad(this: FormHost) {
      wx.redirectTo({
        url: `/pages/${resource === 'work-records' ? 'work' : resource === 'dispatches' ? 'dispatch' : resource === 'recoveries' ? 'recovery' : 'outbound'}/index${this.data.editingId ? `?id=${this.data.editingId}` : this.data.document.batchId ? `?batchId=${this.data.document.batchId}` : ''}`,
      });
    },
    discard(this: FormHost) {
      if (this.data.pending) {
        return;
      }
      wx.showModal({
        title: '放弃本机草稿？',
        content: '不会删除已经保存到后台的草稿。',
        success: (choice) => {
          if (choice.confirm) {
            removeDraft(this.data.ownerId, resource, this.data.editingId || undefined);
            wx.disableAlertBeforeUnload();
            wx.navigateBack();
          }
        },
      });
    },
  };
}
