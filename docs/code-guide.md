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
