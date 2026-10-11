# 后台 API v1

所有业务路径以 `/api` 开头。开发 OpenAPI 为 `/swagger/v1/swagger.json`，静态契约为 docs/openapi.json。API 没有跨域开放；小程序生产使用 wx.cloud.callContainer，浏览器同源调用。

## 身份

- `POST /api/auth/admin-login`：`{"username":"...","password":"..."}`，返回 userId/name/roles/csrfToken；HttpOnly Cookie `warehouse_session`，生产 Secure、SameSite=Strict。所有后台写请求加 `X-CSRF-Token`；会话8小时。
- `POST /api/auth/dev-login`：同结构，仅 Development + DEV_LOGIN_ENABLED=true，返回员工形式 token，测试账号见 README；生产不启用。
- `POST /api/auth/wechat-login`：`{"code":"wx.login获得的code"}`。已绑定员工返回业务 token；未绑定返回15分钟 bindingToken/status，不给业务数据。
- `POST /api/auth/bind-phone`：`{"bindingToken":"...","phoneCode":"getPhoneNumber独立授权code"}`。服务器换取手机号匹配预录员工，返回姓名/角色与 PENDING_CONFIRM，不立即绑定。
- `POST /api/auth/confirm-binding`：`{"bindingToken":"..."}`，只接受本人待确认/管理员已批准，正式绑定并发放业务会话。
- `POST /api/auth/binding-requests`：相同 bindingToken 请求协助，无员工列表或权限；申请凭证续至7天。
- `POST /api/auth/binding-status`：相同 bindingToken 查询审批状态及必要身份摘要；批准后24小时内完成本人确认。
- `GET /api/auth/binding-requests` 管理员分页查询；`POST /api/auth/binding-requests/{id}/approve|reject`：`{"userId":员工ID,"reason":"线下核实理由"}`，候选只能由管理员指定。
- `POST /api/auth/users/{id}/unbind`：管理员 `{"reason":"核实原因"}`，旧会话撤销，旧绑定凭证失效。
- `GET /api/auth/me`：必要身份摘要；`POST /api/auth/select-role`：`{"role":"WORKER"}`，验证数据库角色，记住会话选择。权限仍由实际数据库角色集合判定。
- `POST /api/auth/logout`：注销当前会话。

员工请求 `Authorization: Bearer <token>`；服务端仅存 SHA256 哈希，有效期7天。bindingToken 不是业务会话，不能调用库存或单据。账号停用、角色更改、密码修改或手机号更改撤销旧会话。公网自报 openid/appid/角色一律不采信；未知请求字段拒绝。

## 档案和员工

`GET/POST /api/users`，`PUT /api/users/{id}`；管理员用户字段 username/name/phone/roles/enabled/password（选填，管理员首次必填，12—128字符）。普通员工不设置密码也能通过微信绑定使用。密码和原始令牌不进入审计。

`GET /api/roles` 返回 ADMIN/DRIVER/WORKER/OUTBOUND。

`GET/POST /api/growers|packaging-types|vegetable-types|customers`，`PUT .../{id}`。写入管理员限定。字段 name/unit/specification/contact/phone/enabled。蔬菜单位为“箱”或“公斤”，包装单位可为“个”等。已使用品类不可改变单位，停用而不硬删除。普通人员按角色仅取所需档案名称/单位，隐藏联系人手机号。

## 单据提交、草稿及幂等

资源：`dispatches` 下发、`work-records` 装菜、`recoveries` 回收、`outbounds` 出库、`stock-documents` 期初/补充/外来菜/调整。

- `POST /api/{资源}`：`{"post":true,"document":{...}}` 原子创建提交；post=false 保存草稿。
- `GET /api/{资源}`、`GET /api/{资源}/{id}`：管理员全部，其他业务人员仅本人；明细包含档案快照、actualQuantity、displayQuantity；列表每单displayItems含actualQuantity/displayQuantity，DIRECT展示负数，Input.Items原始quantity保持正数。
- `PUT /api/{资源}/{id}?version=N`：完整 DocumentInput 只改本人草稿，返回新版本；`DELETE .../{id}` 仅删除草稿（留头表状态为REVERSED）。
- `POST /api/{资源}/{id}/post`：`{"version":N}`，当前版本才允许提交。

创建、提交、管理员冲销、修正均须 `Idempotency-Key`，1—100字符。相同用户+操作+key+内容返回原成功结果，改内容返回409。失败事务不永久保留成功幂等行；重试沿用原 key。服务端单号为 kind + UTC日期 + UUID，禁止客户端指定creatorId/driverId/role。

公共 document 字段：businessDate (`YYYY-MM-DD`)、items、vegetables（仅装菜/回收）、batchId、customerId、mode、source、remark、confirmFinal、lossReason、differenceReason。数量只接受十进制字符串，大于0，最多3位小数；包装/箱为整数。最多200行，备注/原因最多500字。零库存不通过零数量单实现。

### 包装下发

```json
{"post":true,"document":{"businessDate":"2026-10-10","items":[{"itemId":5,"growerId":1,"quantity":"100"},{"itemId":6,"growerId":2,"quantity":"20"}]}}
```

相同棚户同包装自动合并。整体库存不足整单失败。同下发×棚户生成独立批次。driverId 来自会话。

### 装菜记录

```json
{"post":true,"document":{"businessDate":"2026-10-10","batchId":1,"items":[{"itemId":5,"quantity":"70"}],"vegetables":[{"itemId":7,"quantity":"70"}]}}
```

WORKER 可选择开放批次，只扣在外包装，不入蔬菜仓库；不能读其他人的完整作业单。

### 部分回收 / 最终回收

```json
{"post":true,"document":{"businessDate":"2026-10-10","batchId":1,"mode":"FINAL","items":[{"itemId":5,"quantity":"15"}],"vegetables":[{"itemId":7,"quantity":"28"}],"confirmFinal":true,"lossReason":"损坏5个","differenceReason":"产出和累计实收相差2箱"}}
```

PARTIAL 不结清、不计损耗；FINAL 必须明确确认。零回收不用零数量行表示，允许 FINAL 的空明细用于结束剩余包装全部损耗的批次，但须提供损耗/差异原因。司机只操作本人批次。实收超过产出允许有原因地记录。

### 出库与库存单

出库 items 只填蔬菜、customerId必填，mode=NORMAL/DIRECT；DIRECT 需remark说明来源。数据库quantity正，库存Delta负，displayQuantity负。

库存单 source=OPENING/REPLENISHMENT/EXTERNAL/ADJUSTMENT。包装REPLENISHMENT、蔬菜EXTERNAL；调整需remark，明细direction=IN/OUT；其他业务由服务器决定扣增方向。库存单管理员限定，全部生成流水。

## 批次、库存和查询

- `GET /api/batches`：司机自己的开放/关闭批次；选择WORKER身份仅开放作业摘要，可按search棚户名搜索。
- `GET /api/batches/{id}/summary`：driver/admin含D/C/R/L/O、产出/实收；worker只含可用包装，不暴露损耗、完整单据或他人产出。
- `GET /api/inventory/vegetables`：出库员与管理员；`GET /api/inventory/packaging`：仅管理员。
- `GET /api/submissions/status?operation=OUTBOUND:create&key=...`：按当前用户隔离。SUCCEEDED含单号/结果；FAILED为已明确回滚业务失败；PENDING为在途或未知结果；NOT_SUBMITTED为没有提交记录。post操作名为`OUTBOUND:{id}:post`，其他kind见DocumentsController。未知结果用原 key 重试，不创建新单。

列表 page默认1、pageSize默认20/最大100，sort=asc/desc；业务列表/报表from/to为包含端点的业务日期，报表支持itemId/growerId/driverId/source（按报表适用范围）；不支持的筛选会返回400。列表items/page/pageSize，不返回无权限对象。

## 修正与报表

- `POST /api/admin/documents/{资源}/{id}/reverse`：`{"reason":"..."}`；依赖未冲销返回409与对应单号。
- `POST .../correct`：`{"reason":"...","document":{完整新内容}}`，原子冲销和重建，保留原创建者、旧单/新单关系，实际管理员操作者审计。
- `GET /api/reports/{name}`，`GET /api/reports/{name}/excel`：仅管理员，Excel包含全部筛选结果而非当前页，上限50,000行，超限422。
- name：packaging-ledger、vegetable-inbound、vegetable-outbound、external-packaging、monthly-loss、vegetable-differences、inventory-ledger。
- `GET /api/audit-logs`、`GET /api/admin/reconcile`：仅管理员。

Excel MIME为application/vnd.openxmlformats-officedocument.spreadsheetml.sheet，Content-Disposition附件，Cache-Control=no-store。中文表头、冻结首行、筛选、口径页；数量数值型，单位不同分组，单号文本，文本防公式注入。inventory-ledger保留逆转完整审计，其他业务报表排除原冲销效果。

## 健康与错误

`GET /health/live` 进程存活，`GET /health/ready` MySQL连通（失败503），`GET /health`兼容健康入口，`/`只给服务状态。未知API返回JSON404，不被SPA吞掉。

错误：`{"code":"INSUFFICIENT_STOCK","message":"库存不足，整单未入账","details":{...},"requestId":"..."}`。401未登录/失效；403无权限/CSRF；404不暴露他人对象；400输入或单位校验；409版本/幂等冲突/库存不足/关闭/依赖；429登录限频；503临时不可用或结果未知；504超时待确认。日志仅请求ID、路径、状态、耗时及异常类型，不记录密码、令牌、手机号或微信请求URL。

## 前端响应契约补充

单据列表/详情的 document 增加 creatorName、createdAt、postedAt 和 customerName；前两者是记录人名称快照与UTC创建时间，postedAt未提交时为null。详情 context 给出所属批次棚户/司机名称，DocumentItems包含棚户快照。员工自己的已关闭作业详情仍可查看必要名称，不因此授予全局批次余额权限。客户和单位使用后台原有快照。

Web页面由 `/admin/` 提供，只有该前缀使用SPA fallback；未知 `/api/...` 保持JSON404。构建资源见 frontend-setup.md。共享前端类型在 `packages/contracts/src/types.ts`，数量字符串与实际/展示数量仍采用原 API 口径。

## 后台会计权限与操作审计

管理员及会计都使用 `admin-login` 和 Cookie/CSRF；登录和 `me` 返回有效 `permissions`。会计默认可查询、导出全部业务数据和报表，其他业务操作由管理员配置。账号/角色管理、绑定审批、权限配置和审计仍仅限管理员。`GET/PUT /api/backoffice-permissions` 管理会计角色配置；`GET /api/exports/{resource}` 扩展档案、员工、库存、批次及单据导出。`GET /api/backoffice-operation-logs` 与 `/excel` 为管理员操作记录查询/导出，支持角色、操作者、操作、模块、日期、状态和请求 ID。`audit-logs?requestId=...` 查询同一请求的变更前后明细。完整权限键、筛选、升级顺序见 [会计权限和审计说明](backoffice-permissions-audit.md)。
