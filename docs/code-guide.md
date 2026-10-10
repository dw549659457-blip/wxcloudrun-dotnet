# 初学者代码导航

## 从“提交”到数据库

1. 小程序将wx.login code发到AuthController，再带业务Bearer token调用/api/work-records；管理员浏览器Cookie调用时还加X-CSRF-Token。
2. DocumentsController读取DTO，ApiController.Current通过AuthService查Sessions/Users/UserRoles，确认启用账号、实际角色、会话类型及CSRF；客户端creatorId/role是未知字段，拒绝。
3. DocumentService.Create验证业务，TransactionService.Idempotent登记提交状态并获得独立MySQL连接；BeginTransaction后先锁StockTransactionGate（跨副本短事务写入顺序），后续全部SQL使用这个连接及transaction。
4. DocumentRepository创建单号/草稿头；post=true调用业务方法。Work校验开放批次，更新BatchPackagingBalances消耗和剩余，写在外Ledger，再登记BatchVegetableBalances产出（不入仓）。其他业务在对应Dispatch/Recover/Outbound/Stock方法。
5. Repository使用参数化SQL，库存UPDATE包含非负条件并检查affected rows。任何错误回滚整笔交易，包括新增单据、部分库存、流水和成功幂等行。成功结果与单据同事务提交，响应丢失可以查原key。
6. ApiErrors将错误转为中文结构并记录requestId，绝不把SQL、手机号、password、token或微信秘密URL写到日志。

主要文件：Domain/Contracts.cs请求和响应、BusinessConstants.cs状态常量、Configuration/AppSettings.cs环境解析、Services/DocumentService.cs规则、Repositories/InventoryRepository.cs库存SQL、ReportRepository.cs报表/对账、Infrastructure/MigrationRunner.cs显式迁移。先读Contracts与DocumentsController，再读一个业务方法，不必先读所有SQL。

## 修改字段：以出库备注为例

remark已实现。检查DocumentInput.Remark（最多500字）；DocumentService.Validate检查DIRECT必填。前端提交document.remark，不让客户端计算DisplayQuantity。Documents头表Payload JSON保存原始内容，纠错保留旧版本；ReportRepository.outbound查询JSON remark，ExcelService把它作为受防公式注入的文本列。

如果新增“运输备注”字段：在DocumentInput新增明确命名字段和默认值，扩展运行时长度校验；查询/导出选择新增字段；若需要关系型索引，用新的有序迁移增加列，不修改已执行迁移。生成OpenAPI并更新docs/api.md，添加“保存、读取、超长拒绝、纠错后旧版本保留”测试，再让小程序/Web表单接入。

## 新增API

在Controllers加明确路由与DTO，第一步Current及后端Require角色；对象归属必须在Service/查询Repository同时实现。Service负责规则和事务，Repository只写SQL，不另开连接绕过事务。库存变动必须余额+流水同事务并受非负条件保护，不可以直接UPDATE余额绕过单据。不要新增通用泛型Repository、微服务或自行发明框架。

## 排查错误

用返回requestId定位标准输出的路径/状态/耗时；VALIDATION_FAILED检查字符串数量/单位/日期；VERSION_CONFLICT刷新草稿；INSUFFICIENT_STOCK查当前实际库存；BATCH_CLOSED重新选择开放批次；DEPENDENCY_BLOCKS_REVERSAL先按details单号逆序处理。超时显示待确认，查询submissions/status或原key重试，不能换key。

读写数据库异常检查/health/ready、配置名冲突、专用账号权限；勿把连接字符串和秘密复制到日志或聊天。`APP_COMMAND=reconcile`只检测不修复，发现差异保留证据后由管理员受控排查。

## 从小程序表单到同一后台

小程序 `src/app.ts` 恢复员工会话与初始化云环境；`pages/start` 处理微信进入、手机号与本人确认，`services/session.ts` 处理失效恢复与账号草稿隔离。`services/api.ts` 只选择 callContainer 或显式本地 wx.request，不接受客户端自报 openid/角色。

`pages/work/index.wxml` 是原生装菜表单，`index.ts` 调用 `services/document-page.ts` 的普通页面方法；派发/装菜/回收/出库复用校验、保存、确认按钮与请求，不引入表单框架。输入组件 `components/quantity-row` 给出大字品类、单位和本次数量。`preview` 重新核实身份、档案、批次和余额；`submit` 经 `services/forms.ts` 保存原 key/body 再调用 `packages/contracts/src/submission.ts`。成功跳到 `pages/detail`，后端才是最终库存依据。

共享 `types.ts` 定义现有 API 形状，`quantity.ts` 用 decimal.js 计算与校验，`validation.ts` 给出中文字段提示。前端不会把业务量转换为浮点 Number，也不会把“装菜产出”当作仓库入库。

## 从管理页面到同一后台

`apps/admin/src/App.tsx` 管理路由和角色入口，页面在 `pages/`。`api/client.ts` 统一同源 Cookie 请求与 CSRF，不存管理员令牌。`DocumentEditor` 填写业务，`DocumentSummary` 展示核对内容，`hooks/useSubmission.ts` 存储原提交并防双击/恢复结果。

`pages/DocumentsPage.tsx` 使用同一后台完成草稿编辑、提交、冲销与原子重建；依赖单号链接可直接定位详情。`pages/ReportsPage.tsx` 将界面同一筛选对象用于列表和完整 Excel 导出。`pages/BindingsPage.tsx` 在管理员线下核实后调用批准/拒绝，不能代替员工本人确认。

修改出库备注的完整路径：小程序 `pages/outbound/index.wxml` 的 remark → `document-page.ts` 收集 DocumentInput → `forms.ts`/共享 submission → `/api/outbounds` → C# DocumentInput/DocumentService → Documents.Payload → ReportRepository → ExcelService；管理端对应 DocumentEditor/DocumentSummary。加字段时同时更新共享类型、两端表单、C#运行时校验、OpenAPI和必要的业务测试。

## 构建与测试位置

`pnpm build:admin` → Vite dist → `scripts/frontend/copy-admin.mjs` → `aspnetapp/wwwroot/admin` → dotnet publish或Docker。`pnpm build:miniprogram` → esbuild原生页面JS + WXML/WXSS/JSON复制 → 开发者工具。Docker只发布管理端，不上传微信小程序。

`tests/frontend/contracts.test.ts`/`miniprogram.test.ts` 用Vitest检验边界；`tests/frontend/e2e` 用Playwright浏览器和原生控制器访问真实API/MySQL。`scripts/frontend/e2e-server.mjs` 只建/删随机本机测试库。测试文件采用中文场景名和实际数量断言；`out/mini-verification` 是独立本地验证适配包，禁止生产发布。
