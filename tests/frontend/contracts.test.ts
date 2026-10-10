import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  addQuantities,
  compareQuantities,
  confirmSubmission,
  friendlyError,
  makeTicket,
  percentage,
  quantityError,
  signedOutbound,
  summarizeInventory,
  validateDocument,
  type ApiTransport,
  type Archive,
  type InventoryRow,
  type SubmissionResult,
} from '@warehouse/contracts';
const archive: Archive = {
  id: 1,
  kind: 'VEGETABLE',
  name: '番茄',
  unit: '公斤',
  specification: '',
  enabled: true,
};
const result: SubmissionResult = { id: 1, number: 'STOCK-1', status: 'POSTED', version: 2 };
describe('登录错误提示', () => {
  it.each([
    ['INVALID_CREDENTIALS', '账号或密码不正确，或账号已停用'],
    ['ACCOUNT_DISABLED', '账号已停用'],
  ])('保留 %s 的原因，不误报会话过期', (code, message) => {
    expect(friendlyError(new ApiError(401, { code, message }))).toBe(message);
  });
  it('真正的会话过期仍提示重新登录并保留未提交内容', () => {
    expect(
      friendlyError(new ApiError(401, { code: 'SESSION_EXPIRED', message: '登录已过期' })),
    ).toBe('登录已过期，请重新进入；未提交的内容还在');
  });
});
describe('数量与单位', () => {
  it('公斤小数精确相加，避免浮点尾数', () => {
    expect(addQuantities('0.1', '0.2')).toBe('0.3');
    expect(compareQuantities('999999999999999.999', '999999999999999.998')).toBe(1);
  });
  it.each(['0', '-2', 'NaN', '1e3', '0.0001', '1000000000000000'])('拒绝无效量 %s', (value) => {
    expect(quantityError(value, '公斤')).not.toBeNull();
  });
  it('只允许公斤保留小数，包装必须整数', () => {
    expect(quantityError('12.500', '公斤')).toBeNull();
    expect(quantityError('12.5', '个')).not.toBeNull();
    expect(quantityError('12.5', '箱')).not.toBeNull();
  });
  it('手工出库展示负数，实际输入保持正数', () => {
    expect(signedOutbound('3', 'DIRECT')).toBe('-3');
    expect(signedOutbound('3', 'NORMAL')).toBe('3');
  });
  it('库存按单位分别合计，绝不混合箱与公斤', () => {
    const rows = [
      { unit: '箱', quantity: '8' },
      { unit: '公斤', quantity: '0.1' },
      { unit: '公斤', quantity: '0.2' },
    ] as InventoryRow[];
    expect(summarizeInventory(rows)).toEqual([
      { unit: '箱', quantity: '8' },
      { unit: '公斤', quantity: '0.3' },
    ]);
    expect(percentage('0.05')).toBe('5.00%');
  });
});
describe('同一提交结果确认', () => {
  it('保存不可变的原请求，即使表单后来变化也不改提交内容', () => {
    const body = { document: { quantity: '10' } };
    const ticket = makeTicket('STOCK:create', '/api/stock-documents', body);
    body.document.quantity = '20';
    expect(ticket.body).toEqual({ document: { quantity: '10' } });
  });
  it('响应丢失后查询成功才显示成功', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, { code: 'NETWORK_ERROR', message: '超时' }))
      .mockResolvedValueOnce({ status: 'SUCCEEDED', result });
    const ticket = makeTicket('STOCK:create', '/api/stock-documents', {});
    expect(await confirmSubmission({ request } as ApiTransport, ticket)).toEqual({
      state: 'succeeded',
      result,
    });
    expect(request.mock.calls[1][1]).toContain(encodeURIComponent(ticket.key));
    expect(request.mock.calls[0][3]).toEqual({ 'Idempotency-Key': ticket.key });
  });
  it.each(['PENDING', 'NOT_SUBMITTED'])('状态 %s 保留为未确认，不能显示成功', async (status) => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('断网'))
      .mockResolvedValueOnce({ status });
    const outcome = await confirmSubmission(
      { request } as ApiTransport,
      makeTicket('STOCK:create', '/api/stock-documents', {}),
    );
    expect(outcome.state).toBe('pending');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('查询也失败时保留原提交，人工再次确认仍用原 key', async () => {
    const request = vi.fn().mockRejectedValue(new Error('断网'));
    const ticket = makeTicket('STOCK:create', '/api/stock-documents', {});
    expect((await confirmSubmission({ request } as ApiTransport, ticket)).state).toBe('pending');
    request.mockResolvedValue(result);
    expect((await confirmSubmission({ request } as ApiTransport, ticket)).state).toBe('succeeded');
    expect(request.mock.calls[2][3]).toEqual(request.mock.calls[0][3]);
  });
  it('明确权限拒绝不能被当作未知状态重试', async () => {
    const request = vi
      .fn()
      .mockRejectedValue(new ApiError(403, { code: 'FORBIDDEN', message: '没有权限' }));
    await expect(
      confirmSubmission(
        { request } as ApiTransport,
        makeTicket('WORK:create', '/api/work-records', {}),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
describe('输入验证', () => {
  it('空白新单不能记账', () => {
    expect(
      validateDocument({ businessDate: '2026-10-10', items: [], mode: 'NORMAL' }, 'outbounds', [
        archive,
      ]),
    ).toContain('请填写本次的品类和数量');
  });
  it('装菜必须同时有包装消耗与蔬菜产出', () => {
    expect(
      validateDocument({ businessDate: '2026-10-10', items: [], batchId: 1 }, 'work-records', [
        archive,
      ]),
    ).toContain('装菜登记需要填写包装消耗和蔬菜产出');
  });
  it('最终回收要明确结束，保存服务端草稿时仍可稍后确认', () => {
    const document = { businessDate: '2026-10-10', items: [], batchId: 1, mode: 'FINAL' };
    expect(validateDocument(document, 'recoveries', [], true)).toContain(
      '请确认本次结束这个棚户任务',
    );
    expect(validateDocument(document, 'recoveries', [], false)).toEqual([]);
  });
  it('手工出库来源必填', () => {
    expect(
      validateDocument(
        {
          businessDate: '2026-10-10',
          items: [{ itemId: 1, quantity: '1' }],
          customerId: 2,
          mode: 'DIRECT',
        },
        'outbounds',
        [archive],
      ),
    ).toContain('请说明手工出库的蔬菜来源');
  });
});
